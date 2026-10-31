-- Reconcile a provider webhook which confirmed the refund before the HTTP acknowledgement.
create or replace function public.finalize_mercadopago_refund(
  p_payment_id uuid,
  p_provider_refund_id text,
  p_requested_by uuid,
  p_refund_amount numeric,
  p_idempotency_key uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment_row public.payments%rowtype;
  refund_row public.payment_refunds%rowtype;
  actor_role public.app_role;
  observed_refund public.payment_refunds%rowtype;
  refunded_total numeric(12,2);
  previous_order_status public.order_status;
begin
  select *
  into payment_row
  from public.payments
  where id = p_payment_id
  for update;

  select *
  into refund_row
  from public.payment_refunds
  where payment_id = p_payment_id
    and idempotency_key = p_idempotency_key
  for update;

  if refund_row.id is not null
    and refund_row.status = 'completed'
    and refund_row.provider_refund_id = p_provider_refund_id
    and refund_row.amount = p_refund_amount
    and refund_row.requested_by is not distinct from p_requested_by
  then
    return true;
  end if;

  -- A webhook can commit the confirmed provider refund before this acknowledgement.
  -- Keep that financial record and release this reservation without duplicating it.
  select * into observed_refund from public.payment_refunds
    where provider_refund_id=p_provider_refund_id and id<>refund_row.id;
  if observed_refund.id is not null then
    if payment_row.id is null or refund_row.id is null or p_refund_amount<=0
      or payment_row.status not in ('approved','refunded')
      or observed_refund.payment_id<>p_payment_id or observed_refund.status<>'completed'
      or observed_refund.amount<>p_refund_amount or observed_refund.currency<>payment_row.currency
      or refund_row.amount<>p_refund_amount or refund_row.requested_by is distinct from p_requested_by
      or not (refund_row.status='pending' or refund_row.status='failed' and refund_row.error_summary='confirmed_by_provider_webhook')
    then raise exception 'refund observation conflict'; end if;
    select role into actor_role from public.user_roles where user_id=p_requested_by and role='manager' limit 1;
    if actor_role is null and exists (
      select 1 from private.customer_order_cancellations c join public.orders o on o.id=c.order_id
        where c.order_id=payment_row.order_id and c.customer_id=p_requested_by
          and c.idempotency_key=p_idempotency_key and o.status='refunded'
          and (select coalesce(sum(r.amount),0) from public.payment_refunds r
            where r.payment_id=p_payment_id and r.status='completed')=payment_row.amount
    ) then actor_role:='customer'; end if;
    if actor_role is null then raise exception 'refund actor is not authorized'; end if;
    update public.payment_refunds set status='failed',error_summary='confirmed_by_provider_webhook',updated_at=now()
      where id=refund_row.id and status='pending';
    if found then
      insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
        values(p_requested_by,actor_role,'payment.refund.reconciled','payment',p_payment_id,
          jsonb_build_object('reservation_id',refund_row.id,'confirmed_refund_id',observed_refund.id));
    end if;
    return true;
  end if;

  if payment_row.id is null
    or payment_row.status not in ('approved','refunded')
    or refund_row.id is null
    or refund_row.status <> 'pending'
    or refund_row.amount <> p_refund_amount
    or refund_row.requested_by is distinct from p_requested_by
    or p_refund_amount <= 0
  then
    raise exception 'refund state mismatch';
  end if;

  select role
  into actor_role
  from public.user_roles
  where user_id = p_requested_by
    and role = 'manager'
  limit 1;

  if actor_role is null and exists (
    select 1 from private.customer_order_cancellations c join public.orders o on o.id = c.order_id
    where c.order_id = payment_row.order_id and c.customer_id = p_requested_by
      and c.idempotency_key = p_idempotency_key and o.status = 'refund_pending'
      and p_refund_amount = payment_row.amount-(select coalesce(sum(r.amount),0)
        from public.payment_refunds r where r.payment_id=payment_row.id and r.status='completed'
          and r.id<>refund_row.id)
  ) then actor_role := 'customer'; end if;

  if actor_role is null then
    raise exception 'refund actor is not authorized';
  end if;

  select coalesce(sum(amount),0)
  into refunded_total
  from public.payment_refunds
  where payment_id = p_payment_id
    and status = 'completed'
    and id <> refund_row.id;

  if refunded_total + p_refund_amount > payment_row.amount then
    raise exception 'refund exceeds payment';
  end if;

  update public.payment_refunds
  set
    status = 'completed',
    provider_refund_id = p_provider_refund_id,
    completed_at = now(),
    updated_at = now(),
    error_summary = null,
    source = case when actor_role = 'customer' then 'customer' else 'manager' end
  where id = refund_row.id;

  refunded_total := refunded_total + p_refund_amount;

  if refunded_total = payment_row.amount then
    select status
    into previous_order_status
    from public.orders
    where id = payment_row.order_id
    for update;

    update public.payments
    set
      status = 'refunded',
      updated_at = now()
    where id = payment_row.id;

    update public.orders
    set
      status = 'refunded',
      payment_status = 'refunded',
      updated_at = now()
    where id = payment_row.order_id;

    insert into public.order_status_history(
      order_id,
      previous_status,
      new_status,
      reason,
      changed_by
    )
    values(
      payment_row.order_id,
      previous_order_status,
      'refunded',
      refund_row.reason,
      p_requested_by
    );
  end if;

  insert into public.audit_logs(
    actor_id,
    actor_role,
    action,
    entity_type,
    entity_id,
    new_data_sanitized,
    reason
  )
  values(
    p_requested_by,
    actor_role,
    'payment.refund',
    'payment',
    payment_row.id,
    jsonb_build_object(
      'refund_id',
      refund_row.id,
      'provider_refund_id',
      p_provider_refund_id,
      'amount',
      p_refund_amount,
      'refunded_total',
      refunded_total,
      'currency',
      refund_row.currency
    ),
    refund_row.reason
  );

  return true;
end;
$$;

revoke all
on function public.finalize_mercadopago_refund(
  uuid,
  text,
  uuid,
  numeric,
  uuid
)
from public, anon, authenticated;

grant execute
on function public.finalize_mercadopago_refund(
  uuid,
  text,
  uuid,
  numeric,
  uuid
)
to service_role;



notify pgrst, 'reload schema';

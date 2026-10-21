-- Cancellation after a confirmed partial refund reserves only the remaining balance.
-- Existing ownership, dispatch, lease, privilege, financial and stock guards remain.
create or replace function public.prepare_customer_order_cancellation(
  p_order_id uuid,
  p_customer_id uuid,
  p_paid boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders%rowtype;
  p public.payments%rowtype;
  c private.customer_order_cancellations%rowtype;
  target_status public.order_status;
  refund_amount numeric(12,2);
  completed_refund_ids jsonb;
begin
  select *
  into o
  from public.orders
  where id = p_order_id
    and customer_id = p_customer_id
  for update;

  select *
  into c
  from private.customer_order_cancellations
  where order_id = o.id
    and customer_id = p_customer_id
  for update;

  if c.order_id is null
    or o.status not in ('cancellation_requested','refund_pending','manual_review')
  then
    raise exception 'cancellation_not_allowed';
  end if;

  if exists (
    select 1
    from public.shipments
    where order_id = o.id
      and (
        dispatched_at is not null
        or status in ('dispatched','in_transit','delivered','returned')
      )
  ) then
    raise exception 'cancellation_not_allowed';
  end if;

  select *
  into p
  from public.payments
  where order_id = o.id
    and provider = 'mercadopago'
  for update;

  target_status := case
    when p_paid then 'refund_pending'::public.order_status
    else 'cancelled'::public.order_status
  end;

  if p_paid then
    update public.payments
    set status = 'approved',
        updated_at = now()
    where id = p.id
      and status not in ('approved','refunded');

    update public.orders
    set status = target_status,
        payment_status = 'approved',
        updated_at = now()
    where id = o.id;

    -- Reuse the immutable reservation after an uncertain write; never change its key/amount.
    select r.amount into refund_amount from public.payment_refunds r
      where r.payment_id=p.id and r.idempotency_key=c.idempotency_key;
    if refund_amount is null then
      select p.amount-coalesce(sum(r.amount),0) into refund_amount
        from public.payment_refunds r where r.payment_id=p.id and r.status='completed';
    end if;
    if refund_amount<=0 then raise exception 'refund_requires_reconciliation'; end if;
    select coalesce(jsonb_agg(r.provider_refund_id),'[]'::jsonb) into completed_refund_ids
      from public.payment_refunds r where r.payment_id=p.id and r.status='completed'
        and r.idempotency_key<>c.idempotency_key;

    perform public.begin_mercadopago_refund(
      p.id,
      p_customer_id,
      refund_amount,
      c.idempotency_key,
      'Cancelamento pelo cliente antes do despacho'
    );
  else
    if p.status in ('approved','refunded')
      or o.payment_status = 'approved'
    then
      raise exception 'payment_requires_refund';
    end if;

    update public.payments
    set status = 'cancelled',
        updated_at = now()
    where id = p.id;

    update public.payment_attempts
    set status = 'cancelled',
        updated_at = now()
    where order_id = o.id
      and status in ('pending','rejected');

    update public.orders
    set status = target_status,
        payment_status = 'cancelled',
        updated_at = now()
    where id = o.id;
  end if;

  if o.status <> target_status then
    insert into public.order_status_history(
      order_id,
      previous_status,
      new_status,
      reason,
      changed_by
    )
    values (
      o.id,
      o.status,
      target_status,
      'Cancelamento confirmado pelo backend',
      p_customer_id
    );
  end if;

  return jsonb_build_object(
    'paymentId', p.id,
    'idempotencyKey', c.idempotency_key,
    'refundAmountInCents', round(coalesce(refund_amount,0)*100),
    'completedRefundIds', coalesce(completed_refund_ids,'[]'::jsonb)
  );
end;
$$;
revoke all on function public.prepare_customer_order_cancellation(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.prepare_customer_order_cancellation(uuid,uuid,boolean) to service_role;

create or replace function public.begin_mercadopago_refund(
  p_payment_id uuid,
  p_requested_by uuid,
  p_refund_amount numeric,
  p_idempotency_key uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment_row public.payments%rowtype;
  refund_row public.payment_refunds%rowtype;
  reserved_total numeric(12,2);
begin
  if p_refund_amount <= 0
    or char_length(trim(p_reason)) not between 3 and 500
    or not (exists (
      select 1 from public.user_roles where user_id = p_requested_by and role = 'manager'
    ) or exists (
      select 1 from private.customer_order_cancellations c
      join public.payments p on p.order_id = c.order_id
      join public.orders o on o.id = c.order_id
      where p.id = p_payment_id and c.customer_id = p_requested_by
        and c.idempotency_key = p_idempotency_key and o.status = 'refund_pending'
        and p_refund_amount = p.amount-(select coalesce(sum(r.amount),0)
          from public.payment_refunds r where r.payment_id=p.id and r.status='completed'
            and r.idempotency_key<>p_idempotency_key)
    ))
  then
    raise exception 'invalid refund request';
  end if;

  select *
  into payment_row
  from public.payments
  where id = p_payment_id
  for update;

  if payment_row.id is null
    or payment_row.provider <> 'mercadopago'
    or payment_row.status not in ('approved','refunded')
  then
    raise exception 'payment not refundable';
  end if;

  select *
  into refund_row
  from public.payment_refunds
  where idempotency_key = p_idempotency_key
  for update;

  if refund_row.id is not null then
    if refund_row.payment_id <> p_payment_id
      or refund_row.amount <> p_refund_amount
      or refund_row.requested_by is distinct from p_requested_by
    then
      raise exception 'refund idempotency conflict';
    end if;

    if refund_row.status = 'failed' then
      update public.payment_refunds
      set
        status = 'pending',
        attempts = attempts + 1,
        error_summary = null,
        updated_at = now()
      where id = refund_row.id;
    end if;

    return refund_row.id;
  end if;

  select coalesce(sum(amount),0)
  into reserved_total
  from public.payment_refunds
  where payment_id = p_payment_id
    and status in ('pending','completed');

  if reserved_total + p_refund_amount > payment_row.amount then
    raise exception 'refund exceeds payment';
  end if;

  insert into public.payment_refunds(
    payment_id,
    order_id,
    amount,
    currency,
    status,
    reason,
    requested_by,
    attempts,
    idempotency_key,
    source
  )
  values (
    payment_row.id,
    payment_row.order_id,
    p_refund_amount,
    payment_row.currency,
    'pending',
    trim(p_reason),
    p_requested_by,
    1,
    p_idempotency_key,
    case when exists(select 1 from private.customer_order_cancellations where order_id = payment_row.order_id and customer_id = p_requested_by and idempotency_key = p_idempotency_key)
      then 'customer' else 'manager' end
  )
  returning * into refund_row;

  return refund_row.id;
end;
$$;

revoke all
on function public.begin_mercadopago_refund(
  uuid,
  uuid,
  numeric,
  uuid,
  text
)
from public, anon, authenticated;

grant execute
on function public.begin_mercadopago_refund(
  uuid,
  uuid,
  numeric,
  uuid,
  text
)
to service_role;


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


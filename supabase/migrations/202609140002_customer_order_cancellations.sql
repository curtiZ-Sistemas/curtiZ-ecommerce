begin;

alter table public.payment_refunds drop constraint if exists payment_refunds_source_check;
alter table public.payment_refunds add constraint payment_refunds_source_check check (source in ('manager','provider','customer'));

create table if not exists private.customer_order_cancellations (
  order_id uuid primary key references public.orders(id),
  customer_id uuid not null references public.profiles(id),
  idempotency_key uuid not null unique default gen_random_uuid(),
  lease_until timestamptz,
  inventory_restored_at timestamptz,
  created_at timestamptz not null default now()
);
revoke all on private.customer_order_cancellations from public, anon, authenticated, service_role;

create or replace function public.begin_customer_order_cancellation(p_order_id uuid, p_customer_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o public.orders%rowtype; p public.payments%rowtype; c private.customer_order_cancellations%rowtype; next_status public.order_status;
begin
  select * into o from public.orders where id = p_order_id and customer_id = p_customer_id for update;
  if o.id is null then raise exception 'order_not_found' using errcode = 'P0002'; end if;
  if o.status in ('shipped','delivered','returned','return_requested') or exists (
    select 1 from public.shipments where order_id = o.id
      and (dispatched_at is not null or status in ('dispatched','in_transit','delivered','returned'))
  ) then raise exception 'cancellation_not_allowed' using errcode = '23514'; end if;
  select * into c from private.customer_order_cancellations where order_id = o.id for update;
  if o.status in ('cancelled','refunded') then return jsonb_build_object('status',o.status); end if;
  if c.order_id is null and o.status not in ('pending_payment','payment_approved','processing','picking','ready_to_ship','cancellation_requested') then
    raise exception 'cancellation_not_allowed' using errcode = '23514';
  end if;
  if c.lease_until > now() then return jsonb_build_object('busy',true,'status',o.status); end if;
  select * into p from public.payments where order_id = o.id and provider = 'mercadopago' for update;
  if p.id is null then raise exception 'payment_not_found'; end if;
  if p.amount <> o.grand_total or p.currency <> o.currency or p.currency <> 'BRL' then raise exception 'payment_mismatch'; end if;
  insert into private.customer_order_cancellations(order_id,customer_id,lease_until)
  values(o.id,p_customer_id,now()+interval '60 seconds')
  on conflict(order_id) do update set lease_until = excluded.lease_until returning * into c;
  next_status := case when o.payment_status = 'approved' or p.status = 'approved' then 'refund_pending' else 'cancellation_requested' end;
  update public.orders set status = next_status, updated_at = now() where id = o.id;
  update public.operational_tasks set status = 'cancelled', updated_at = now(), version = version + 1
    where order_id = o.id and status not in ('completed','cancelled');
  if o.status <> next_status then
    insert into public.order_status_history(order_id,previous_status,new_status,reason,changed_by)
      values(o.id,o.status,next_status,'Cancelamento pelo cliente: execução operacional bloqueada.',p_customer_id);
  end if;
  return jsonb_build_object('status',next_status,'providerPaymentId',p.provider_payment_id,
    'orderCode',o.public_code,'amountInCents',round(p.amount*100),'paid',o.payment_status = 'approved' or p.status = 'approved',
    'paymentInFlight',exists(select 1 from public.payment_attempts where order_id = o.id and status = 'pending'));
end; $$;
revoke all on function public.begin_customer_order_cancellation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.begin_customer_order_cancellation(uuid,uuid) to service_role;

create or replace function public.request_customer_order_cancellation(p_order_id uuid)
returns public.order_status language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'use_customer_cancellation_endpoint' using errcode = '42501';
end; $$;
revoke all on function public.request_customer_order_cancellation(uuid) from public,anon,authenticated;

create or replace function private.guard_customer_cancellation_execution()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target_order uuid;
begin
  if tg_table_name = 'orders' then
    if exists(select 1 from private.customer_order_cancellations where order_id = new.id) then
      if new.status = 'payment_approved' then new.status := 'refund_pending'; end if;
      if new.status in ('processing','picking','ready_to_ship','shipped','delivered','pending_payment') then
        raise exception 'order_cancellation_in_progress' using errcode = '23514';
      end if;
    end if;
    return new;
  end if;
  target_order := new.order_id;
  if target_order is null then return new; end if;
  perform 1 from public.orders where id = target_order for update;
  if exists(select 1 from private.customer_order_cancellations where order_id = target_order) then
    if tg_table_name = 'shipments' then
      if new.dispatched_at is not null or new.status in ('dispatched','in_transit','delivered') then
        raise exception 'order_cancellation_in_progress' using errcode = '23514';
      end if;
    elsif new.status <> 'cancelled' then
      raise exception 'order_cancellation_in_progress' using errcode = '23514';
    end if;
  end if;
  return new;
end; $$;
revoke all on function private.guard_customer_cancellation_execution() from public,anon,authenticated;
drop trigger if exists guard_customer_cancellation on public.orders;
create trigger guard_customer_cancellation before update on public.orders for each row execute function private.guard_customer_cancellation_execution();
drop trigger if exists guard_customer_cancellation on public.shipments;
create trigger guard_customer_cancellation before insert or update on public.shipments for each row execute function private.guard_customer_cancellation_execution();
drop trigger if exists guard_customer_cancellation on public.operational_tasks;
create trigger guard_customer_cancellation before insert or update on public.operational_tasks for each row execute function private.guard_customer_cancellation_execution();

create or replace function private.restore_customer_cancellation_inventory()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r record; previous_quantity integer;
begin
  if new.status not in ('cancelled','refunded') or old.status = new.status then return new; end if;
  perform 1 from private.customer_order_cancellations where order_id = new.id and inventory_restored_at is null for update;
  if not found then return new; end if;
  perform private.release_order_reservations(new.id);
  for r in select * from public.inventory_reservations where order_id = new.id and converted_at is not null and released_at is null for update loop
    select available_quantity into previous_quantity from public.inventory where variant_id = r.variant_id for update;
    update public.inventory set available_quantity = available_quantity + r.quantity, version = version + 1, updated_at = now() where variant_id = r.variant_id;
    insert into public.inventory_movements(variant_id,movement_type,quantity,previous_quantity,new_quantity,reason,reference_type,reference_id)
      values(r.variant_id,'return',r.quantity,previous_quantity,previous_quantity+r.quantity,'Cancelamento antes do despacho','order',new.id);
    -- Converted reservations retain their sale history; the order marker prevents a second restore.
  end loop;
  update private.customer_order_cancellations set inventory_restored_at = now() where order_id = new.id;
  update public.operational_tasks set status = 'cancelled',updated_at = now(),version = version+1 where order_id = new.id and status not in ('completed','cancelled');
  return new;
end; $$;
revoke all on function private.restore_customer_cancellation_inventory() from public,anon,authenticated;
drop trigger if exists restore_customer_cancellation_inventory on public.orders;
create trigger restore_customer_cancellation_inventory after update on public.orders for each row execute function private.restore_customer_cancellation_inventory();

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

    perform public.begin_mercadopago_refund(
      p.id,
      p_customer_id,
      p.amount,
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
    'idempotencyKey', c.idempotency_key
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
        and p_refund_amount = p.amount
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
      and p_refund_amount = payment_row.amount
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
commit;

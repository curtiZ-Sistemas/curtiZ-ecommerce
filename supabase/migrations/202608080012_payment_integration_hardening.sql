-- Idempotencia e reconciliacao transacional da integracao Mercado Pago.

alter table public.payments
  add column if not exists provider_redirect_url text;

create table if not exists public.payment_refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null unique references public.payments(id),
  order_id uuid not null references public.orders(id),
  provider_refund_id text unique,
  amount numeric(12,2) not null check (amount > 0),
  currency char(3) not null,
  status text not null check (status in ('pending','completed','failed')),
  reason text not null check (char_length(reason) between 3 and 500),
  requested_by uuid not null references public.profiles(id),
  attempts integer not null default 1 check (attempts > 0),
  error_summary text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.payment_refunds enable row level security;
alter table public.payment_refunds force row level security;

drop policy if exists "finance reads payment refunds" on public.payment_refunds;
create policy "finance reads payment refunds" on public.payment_refunds
  for select to authenticated
  using (private.has_permission('finance.reconcile'));

grant select on public.payment_refunds to authenticated;
grant all privileges on public.payment_refunds to service_role;

create or replace function public.finalize_mercadopago_payment(
  p_provider_event_id text,
  p_provider_payment_id text,
  p_external_reference text,
  p_amount numeric,
  p_currency text,
  p_status public.payment_status,
  p_paid_at timestamptz default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  local_payment public.payments%rowtype;
begin
  select * into local_payment
  from public.payments
  where external_reference = p_external_reference
  for update;

  if local_payment.id is null
    or local_payment.amount <> p_amount
    or local_payment.currency <> p_currency then
    update public.payment_events
    set processing_status = 'manual_review', processed_at = now(), error_summary = 'payment_mismatch'
    where provider = 'mercadopago' and provider_event_id = p_provider_event_id;
    return 'manual_review';
  end if;

  update public.payments
  set provider_payment_id = p_provider_payment_id,
      status = p_status,
      paid_at = case when p_status = 'approved' then coalesce(p_paid_at, paid_at, now()) else paid_at end,
      updated_at = now()
  where id = local_payment.id;

  if p_status = 'approved' and local_payment.status <> 'approved' then
    perform private.convert_order_reservations(local_payment.order_id);
    update public.orders
    set status = 'payment_approved', payment_status = 'approved', placed_at = coalesce(placed_at, now()), updated_at = now()
    where id = local_payment.order_id and status = 'pending_payment';
  elsif p_status in ('charged_back','in_review') then
    update public.orders
    set status = 'manual_review', payment_status = p_status, updated_at = now()
    where id = local_payment.order_id;
  elsif p_status = 'refunded' then
    update public.orders
    set status = 'refunded', payment_status = 'refunded', updated_at = now()
    where id = local_payment.order_id;
  else
    update public.orders set payment_status = p_status, updated_at = now()
    where id = local_payment.order_id;
  end if;

  update public.payment_events
  set processing_status = 'processed', processed_at = now(), error_summary = null
  where provider = 'mercadopago' and provider_event_id = p_provider_event_id;
  return 'processed';
end;
$$;

create or replace function public.finalize_mercadopago_refund(
  p_payment_id uuid,
  p_provider_refund_id text,
  p_requested_by uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  local_payment public.payments%rowtype;
  local_refund public.payment_refunds%rowtype;
  actor_role public.app_role;
  previous_order_status public.order_status;
begin
  select * into local_payment from public.payments where id = p_payment_id for update;
  select * into local_refund from public.payment_refunds where payment_id = p_payment_id for update;
  if local_payment.id is null or local_payment.status <> 'approved'
    or local_refund.id is null or local_refund.status <> 'pending'
    or local_refund.amount <> local_payment.amount
    or local_refund.requested_by <> p_requested_by then
    raise exception 'refund state mismatch';
  end if;

  select role into actor_role from public.user_roles
  where user_id = p_requested_by and role = 'manager' limit 1;
  if actor_role is null then raise exception 'refund actor is not authorized'; end if;

  update public.payment_refunds
  set status = 'completed', provider_refund_id = p_provider_refund_id,
      completed_at = now(), updated_at = now(), error_summary = null
  where id = local_refund.id;
  select status into previous_order_status
  from public.orders
  where id = local_payment.order_id
  for update;
  update public.payments set status = 'refunded', updated_at = now() where id = local_payment.id;
  update public.orders set status = 'refunded', payment_status = 'refunded', updated_at = now()
  where id = local_payment.order_id;
  insert into public.order_status_history(order_id, previous_status, new_status, reason, changed_by)
  values(local_payment.order_id, previous_order_status, 'refunded', local_refund.reason, p_requested_by);
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized,reason)
  values(p_requested_by,actor_role,'payment.refund','payment',local_payment.id,
    jsonb_build_object('amount',local_refund.amount,'currency',local_refund.currency),local_refund.reason);
  return true;
end;
$$;

revoke all on function public.finalize_mercadopago_payment(text,text,text,numeric,text,public.payment_status,timestamptz) from public, anon, authenticated;
grant execute on function public.finalize_mercadopago_payment(text,text,text,numeric,text,public.payment_status,timestamptz) to service_role;
revoke all on function public.finalize_mercadopago_refund(uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.finalize_mercadopago_refund(uuid,text,uuid) to service_role;

notify pgrst, 'reload schema';

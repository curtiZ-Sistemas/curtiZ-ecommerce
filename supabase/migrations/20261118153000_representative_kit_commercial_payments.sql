alter table private.representative_kit_checkout_approvals
  add column buyer_document text check (buyer_document ~ '^[0-9]{14}$'),
  add column buyer_legal_name text check (length(btrim(buyer_legal_name)) between 2 and 200);

alter table private.representative_kit_orders
  add column payment_expires_at timestamptz,
  add column cancellation_requested_at timestamptz,
  add column payment_checked_at timestamptz not null default now(),
  add column paid_at timestamptz;

create index representative_kit_payment_recovery on private.representative_kit_orders(payment_checked_at)
  where payment_started_at is not null and state in ('reserved','payment_pending');

create table private.representative_kit_provider_refunds (
  provider_refund_id text primary key,
  order_id uuid not null references private.representative_kit_orders(id),
  amount_cents bigint not null check (amount_cents > 0),
  reconciled_at timestamptz not null default now()
);
create index representative_kit_provider_refunds_order on private.representative_kit_provider_refunds(order_id);
alter table private.representative_kit_provider_refunds enable row level security;
alter table private.representative_kit_provider_refunds force row level security;
revoke all on private.representative_kit_provider_refunds from public, anon, authenticated, service_role;

create function private.representative_kit_payment_allowed(o private.representative_kit_orders)
returns boolean language sql stable set search_path = '' as $$
  select coalesce(private.find_representative_kit_checkout_approval(o.actor_id, o.variant_id,
    o.shipping_snapshot ->> 'originPostalCode') = o.rule_version_id, false)
  and exists (
    select 1 from public.profiles p join public.representatives r on r.user_id = p.id
    join public.addresses a on a.user_id = p.id
    where p.id = o.actor_id and p.status = 'active' and r.status in ('approved_waiting_kit','active','unqualified')
      and a.id = o.address_id and a.state = 'MG' and a.country = 'BR'
      and a.updated_at = (o.shipping_snapshot -> 'address' ->> 'version')::timestamptz
      and regexp_replace(a.postal_code, '[^0-9]', '', 'g') = o.shipping_snapshot -> 'address' ->> 'postalCode'
  );
$$;
revoke all on function private.representative_kit_payment_allowed(private.representative_kit_orders)
  from public, anon, authenticated, service_role;

create function public.read_representative_kit_payment(p_actor uuid, p_order uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select private.representative_kit_order_summary(o) ||
    jsonb_build_object('providerPaymentId', o.provider_payment_id, 'startedAt', o.payment_started_at,
      'cancellationRequested', o.cancellation_requested_at is not null,
      'customerCanPay', o.state = 'payment_pending' and private.representative_kit_payment_allowed(o))
  from private.representative_kit_orders o where o.id = p_order and o.actor_id = p_actor;
$$;

-- Exactly one HTTP request is allowed to create a payment. Uncertain writes are
-- recovered by reference and never lead to a second charge attempt.
create function public.claim_representative_kit_pix(p_actor uuid, p_order uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  o private.representative_kit_orders;
  a private.representative_kit_checkout_approvals;
begin
  select * into o from private.representative_kit_orders where id = p_order and actor_id = p_actor for update;
  if not found then raise exception 'kit_access_denied' using errcode = '42501'; end if;
  if o.payment_started_at is not null then return null; end if;
  if o.state <> 'reserved' or o.reserved_until <= clock_timestamp() or not private.representative_kit_payment_allowed(o) then
    raise exception 'resale_payment_blocked' using errcode = '23514';
  end if;
  select * into a from private.representative_kit_checkout_approvals
    where actor_id = o.actor_id and rule_version_id = o.rule_version_id for share;
  if a.buyer_document is null or a.buyer_legal_name is null or a.revoked_at is not null or a.valid_until <= clock_timestamp() then
    raise exception 'resale_payment_blocked' using errcode = '23514';
  end if;
  update private.representative_kit_orders set payment_started_at = clock_timestamp(),
    payment_checked_at = clock_timestamp(), payment_expires_at = clock_timestamp() + interval '30 minutes'
    where id = p_order returning * into o;
  return private.representative_kit_order_summary(o) || jsonb_build_object(
    'buyerDocument', a.buyer_document, 'buyerName', a.buyer_legal_name, 'expiresAt', o.payment_expires_at);
end;
$$;

create function public.request_representative_kit_payment_cancellation(p_actor uuid, p_order uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  o private.representative_kit_orders;
begin
  select * into o from private.representative_kit_orders where actor_id = p_actor and id = p_order for update;
  if not found then return null; end if;
  if o.payment_started_at is null then
    perform public.cancel_unstarted_representative_kit_order(p_actor,p_order);
  elsif o.state in ('reserved','payment_pending') then
    update private.representative_kit_orders set cancellation_requested_at = coalesce(cancellation_requested_at, now())
      where id = p_order;
  end if;
  return public.read_representative_kit_payment(p_actor, p_order);
end;
$$;

create function public.settle_representative_kit_payment(
  p_order uuid, p_payment_id text, p_reference text, p_amount bigint, p_currency text,
  p_status text, p_paid_at timestamptz, p_refunds jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  o private.representative_kit_orders;
  refund jsonb;
  refund_total bigint;
  refunded_now bigint;
  next_state text;
  next_stock text;
  stock_available integer;
  stock_reserved integer;
begin
  select * into o from private.representative_kit_orders where id = p_order for update;
  if not found or o.payment_started_at is null or p_reference is distinct from ('KITMG-' || p_order::text)
    or p_amount is distinct from (o.unit_price_cents * o.quantity + o.shipping_cents)
    or p_currency is distinct from 'BRL' or p_payment_id is null or p_payment_id !~ '^[0-9]{1,30}$'
    or (o.provider_payment_id is not null and o.provider_payment_id <> p_payment_id)
    or p_status is null or jsonb_typeof(p_refunds) is distinct from 'array' or jsonb_array_length(p_refunds) > 100 then
    raise exception 'kit_payment_identity_mismatch' using errcode = '23514';
  end if;

  for refund in select value from jsonb_array_elements(p_refunds) loop
    if coalesce(refund ->> 'id', '') !~ '^[0-9]{1,30}$' or coalesce(refund ->> 'amountInCents','') !~ '^[0-9]{1,15}$' then
      raise exception 'kit_refund_identity_mismatch' using errcode = '23514';
    end if;
    refunded_now := (refund ->> 'amountInCents')::bigint;
    insert into private.representative_kit_provider_refunds(provider_refund_id,order_id,amount_cents)
      values (refund ->> 'id',p_order,refunded_now) on conflict do nothing;
    if not exists (select 1 from private.representative_kit_provider_refunds r
      where r.provider_refund_id = refund ->> 'id' and r.order_id = p_order and r.amount_cents = refunded_now) then
      raise exception 'kit_refund_identity_mismatch' using errcode = '23514';
    end if;
  end loop;
  select coalesce(sum(amount_cents),0) into refund_total from private.representative_kit_provider_refunds where order_id = p_order;
  if refund_total > p_amount then raise exception 'kit_refund_amount_mismatch' using errcode = '23514'; end if;

  next_state := o.state;
  next_stock := o.stock_state;
  if refund_total = p_amount then
    next_state := 'refunded';
    if o.stock_state = 'reserved' then next_stock := 'released'; end if;
  elsif o.state in ('reserved','payment_pending') then
    if p_status = 'approved' and refund_total = 0 and p_paid_at is not null and private.representative_kit_payment_allowed(o) then
      next_state := 'paid';
      next_stock := 'sold';
    elsif p_status in ('cancelled','expired','rejected') and refund_total = 0 then
      next_state := 'cancelled';
      next_stock := 'released';
    elsif p_status in ('pending','in_process') and refund_total = 0 then
      next_state := 'payment_pending';
    else
      next_state := 'manual_review';
    end if;
  elsif (o.state = 'cancelled' and p_status in ('approved','refunded','charged_back'))
    or (o.state = 'paid' and (p_status in ('cancelled','refunded','charged_back','in_mediation') or refund_total > 0)) then
    next_state := 'manual_review';
  end if;

  if o.stock_state = 'reserved' and next_stock <> 'reserved' then
    update public.inventory set reserved_quantity = reserved_quantity - o.quantity,
      available_quantity = available_quantity + case when next_stock = 'released' then o.quantity else 0 end,
      version = version + 1, updated_at = now()
      where variant_id = o.variant_id and reserved_quantity >= o.quantity
      returning available_quantity,reserved_quantity into stock_available,stock_reserved;
    if not found then raise exception 'kit_stock_inconsistent' using errcode = '23514'; end if;
    if next_stock = 'sold' then
      insert into public.inventory_movements(variant_id,movement_type,quantity,previous_quantity,new_quantity,
        reason,reference_type,reference_id,performed_by)
      values (o.variant_id,'sale',-o.quantity,stock_available+stock_reserved+o.quantity,stock_available+stock_reserved,
        'Pagamento confirmado de kit de revenda MG','representative_kit_order',p_order,o.actor_id);
    end if;
  end if;

  update private.representative_kit_orders set state = next_state, stock_state = next_stock,
    provider_payment_id = p_payment_id, payment_checked_at = clock_timestamp(),
    paid_at = coalesce(paid_at, case when p_status = 'approved' then p_paid_at end)
    where id = p_order returning * into o;
  return private.representative_kit_order_summary(o) || jsonb_build_object('refundedInCents',refund_total);
end;
$$;

create function public.due_representative_kit_payments()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(due)),'[]'::jsonb) from (
    select id as "orderId", provider_payment_id as "providerPaymentId", payment_started_at as "startedAt",
      payment_expires_at as "expiresAt", cancellation_requested_at is not null as "cancellationRequested"
    from private.representative_kit_orders
    where (state = 'reserved' and payment_started_at is null and reserved_until <= now())
      or (state in ('reserved','payment_pending') and payment_started_at is not null
        and payment_checked_at < now() - interval '1 minute')
    order by payment_checked_at,id limit 10
  ) due;
$$;

create function public.defer_representative_kit_payment_check(p_order uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update private.representative_kit_orders set payment_checked_at = clock_timestamp()
    where id = p_order and state in ('reserved','payment_pending');
  return found;
end;
$$;

revoke all on function public.read_representative_kit_payment(uuid,uuid),
  public.claim_representative_kit_pix(uuid,uuid), public.request_representative_kit_payment_cancellation(uuid,uuid),
  public.settle_representative_kit_payment(uuid,text,text,bigint,text,text,timestamptz,jsonb),
  public.due_representative_kit_payments(), public.defer_representative_kit_payment_check(uuid)
  from public, anon, authenticated;
grant execute on function public.read_representative_kit_payment(uuid,uuid),
  public.claim_representative_kit_pix(uuid,uuid), public.request_representative_kit_payment_cancellation(uuid,uuid),
  public.settle_representative_kit_payment(uuid,text,text,bigint,text,text,timestamptz,jsonb),
  public.due_representative_kit_payments(), public.defer_representative_kit_payment_check(uuid)
  to service_role;

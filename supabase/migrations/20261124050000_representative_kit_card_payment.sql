-- Credit and debit card for the commercial kit checkout, paid now through Mercado Pago with the
-- same collector account as the kit Pix. The browser only sends the card token; the server claims
-- the payment exactly like the Pix (same lock, same payment_allowed rule, same buyer document).
--
-- A refused card keeps the order reserved so the buyer can try again, while a refused Pix still
-- cancels it. The refused payment ids are remembered so a late notification of an old attempt can
-- never attach itself to the next one.

alter table private.representative_kit_orders
  add column payment_method text check (payment_method in ('card')),
  add column card_attempt_id uuid,
  add column card_rejected_payment_ids text[] not null default '{}'::text[];

-- Card claim: one HTTP request may create each attempt. attemptId is the provider idempotency key.
create function public.claim_representative_kit_card(p_actor uuid, p_order uuid, p_payer_cpf_ready boolean default false)
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
  if a.buyer_legal_name is null or a.revoked_at is not null or a.valid_until <= clock_timestamp() then
    raise exception 'resale_payment_blocked' using errcode = '23514';
  end if;
  if a.buyer_document is null and p_payer_cpf_ready is not true then
    raise exception 'kit_payer_document_required' using errcode = '23514';
  end if;
  update private.representative_kit_orders set payment_started_at = clock_timestamp(),
    payment_checked_at = clock_timestamp(), payment_expires_at = clock_timestamp() + interval '30 minutes',
    payment_method = 'card', card_attempt_id = gen_random_uuid()
    where id = p_order returning * into o;
  return private.representative_kit_order_summary(o) || jsonb_build_object(
    'buyerDocument', a.buyer_document, 'buyerName', a.buyer_legal_name, 'expiresAt', o.payment_expires_at,
    'attemptId', o.card_attempt_id);
end;
$$;
revoke all on function public.claim_representative_kit_card(uuid,uuid,boolean) from public, anon, authenticated;
grant execute on function public.claim_representative_kit_card(uuid,uuid,boolean) to service_role;

-- The provider definitely refused to create the payment (invalid request): no charge exists, so the
-- claim is returned and the buyer can try again. Never used when the outcome is uncertain.
create function public.release_representative_kit_card_claim(p_actor uuid, p_order uuid, p_attempt uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update private.representative_kit_orders set payment_started_at = null, payment_expires_at = null,
    payment_method = null, card_attempt_id = null, payment_checked_at = clock_timestamp()
    where id = p_order and actor_id = p_actor and state = 'reserved' and payment_method = 'card'
      and card_attempt_id = p_attempt and provider_payment_id is null;
  return found;
end;
$$;
revoke all on function public.release_representative_kit_card_claim(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.release_representative_kit_card_claim(uuid,uuid,uuid) to service_role;

-- A claim whose provider call left no payment behind. The worker calls it only after the provider
-- search found nothing and the claim window is over; the order then follows the unstarted rules.
create function public.expire_representative_kit_card_claim(p_order uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update private.representative_kit_orders set payment_started_at = null, payment_expires_at = null,
    payment_method = null, card_attempt_id = null, payment_checked_at = clock_timestamp()
    where id = p_order and state = 'reserved' and payment_method = 'card'
      and provider_payment_id is null and payment_expires_at <= clock_timestamp();
  return found;
end;
$$;
revoke all on function public.expire_representative_kit_card_claim(uuid) from public, anon, authenticated;
grant execute on function public.expire_representative_kit_card_claim(uuid) to service_role;

-- Same body as 20261119143000 plus: a refused card releases the order for another attempt, a stale
-- notification of a refused attempt is ignored, and a card still in review keeps its hold for two days.
create or replace function public.settle_representative_kit_payment(
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
  card_retry boolean := false;
begin
  select * into o from private.representative_kit_orders where id = p_order for update;
  if found and p_payment_id = any(o.card_rejected_payment_ids) and p_reference is not distinct from ('KITMG-' || p_order::text) then
    return private.representative_kit_order_summary(o) || jsonb_build_object('refundedInCents',0);
  end if;
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
    elsif p_status = 'rejected' and refund_total = 0 and o.payment_method = 'card' and o.cancellation_requested_at is null then
      card_retry := true;
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

  if card_retry then
    update private.representative_kit_orders set state = 'reserved', payment_started_at = null, payment_expires_at = null,
      payment_method = null, card_attempt_id = null, provider_payment_id = null, payment_checked_at = clock_timestamp(),
      card_rejected_payment_ids = array_append(card_rejected_payment_ids, p_payment_id)
      where id = p_order returning * into o;
    return private.representative_kit_order_summary(o) || jsonb_build_object('refundedInCents',refund_total);
  end if;

  if o.stock_state = 'reserved' and next_stock <> 'reserved' then
    perform private.transfer_representative_kit_inventory(o,o.quantity,
      case when next_stock='sold' then 'sell' else 'release' end,
      'Pagamento confirmado de kit de revenda MG','representative_kit_order',p_order,o.actor_id);
  end if;

  update private.representative_kit_orders set state = next_state, stock_state = next_stock,
    provider_payment_id = p_payment_id, payment_checked_at = clock_timestamp(),
    payment_expires_at = case when o.payment_method = 'card' and o.provider_payment_id is null
      and p_status in ('pending','in_process') then clock_timestamp() + interval '2 days' else payment_expires_at end,
    paid_at = coalesce(paid_at, case when p_status = 'approved' then p_paid_at end)
    where id = p_order returning * into o;
  return private.representative_kit_order_summary(o) || jsonb_build_object('refundedInCents',refund_total);
end;
$$;

-- Same body as 20261119163000 plus the payment method of the attempt in progress.
create or replace function public.read_representative_kit_payment(p_actor uuid, p_order uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select private.representative_kit_order_summary(o) ||
    jsonb_build_object('providerPaymentId',o.provider_payment_id,'startedAt',o.payment_started_at,
      'paymentMethod',o.payment_method,
      'cancellationRequested',o.cancellation_requested_at is not null,
      'customerCanPay',o.state='payment_pending' and private.representative_kit_payment_allowed(o),
      'canCancelPaid',o.cancellation_requested_at is null and private.can_cancel_unshipped_representative_kit(o),
      'canCancelCollection',o.cancellation_requested_at is null and private.can_cancel_unshipped_kit_collection(o))
  from private.representative_kit_orders o where o.id=p_order and o.actor_id=p_actor;
$$;

-- Same as 20261118153000 plus the payment method, so the worker can tell a card claim apart.
create or replace function public.due_representative_kit_payments()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(due)),'[]'::jsonb) from (
    select id as "orderId", provider_payment_id as "providerPaymentId", payment_started_at as "startedAt",
      payment_expires_at as "expiresAt", cancellation_requested_at is not null as "cancellationRequested",
      payment_method as "paymentMethod"
    from private.representative_kit_orders
    where (state = 'reserved' and payment_started_at is null and reserved_until <= now())
      or (state in ('reserved','payment_pending') and payment_started_at is not null
        and payment_checked_at < now() - interval '1 minute')
    order by payment_checked_at,id limit 10
  ) due;
$$;

-- Same as 20261124021000, but a buyer with neither an approved CNPJ nor a valid CPF gets a specific
-- reason (a fixed message, never the document) instead of the generic payment block.
create or replace function public.claim_representative_kit_pix(p_actor uuid, p_order uuid, p_payer_cpf_ready boolean default false)
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
  if a.buyer_legal_name is null or a.revoked_at is not null or a.valid_until <= clock_timestamp() then
    raise exception 'resale_payment_blocked' using errcode = '23514';
  end if;
  if a.buyer_document is null and p_payer_cpf_ready is not true then
    raise exception 'kit_payer_document_required' using errcode = '23514';
  end if;
  update private.representative_kit_orders set payment_started_at = clock_timestamp(),
    payment_checked_at = clock_timestamp(), payment_expires_at = clock_timestamp() + interval '30 minutes'
    where id = p_order returning * into o;
  return private.representative_kit_order_summary(o) || jsonb_build_object(
    'buyerDocument', a.buyer_document, 'buyerName', a.buyer_legal_name, 'expiresAt', o.payment_expires_at);
end;
$$;

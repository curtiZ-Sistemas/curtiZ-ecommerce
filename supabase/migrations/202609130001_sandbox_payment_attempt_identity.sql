-- Logical checkout identity is independent of a provider payment attempt.
begin;
alter table public.payment_attempts
  add column if not exists request_fingerprint text
    check (request_fingerprint is null or request_fingerprint ~ '^[0-9a-f]{64}$');

create or replace function public.confirm_professional_checkout_order(
  p_idempotency_key uuid, p_customer_id uuid, p_payment_method_id text,
  p_customer_name text, p_customer_email text, p_customer_phone text,
  p_cpf_ciphertext text, p_cpf_last_four text, p_shipping_address jsonb,
  p_lines jsonb, p_coupon_code text default null, p_reservation_minutes integer default 30
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  created jsonb;
  created_order_id uuid;
  normalized_method text := lower(trim(coalesce(p_payment_method_id, '')));
  address_snapshot jsonb;
  effective_ciphertext text := nullif(trim(p_cpf_ciphertext), '');
  effective_last_four text := nullif(trim(p_cpf_last_four), '');
  stored_order public.orders%rowtype;
  requested_line_count integer;
  matching_line_count integer;
begin
  if p_customer_id is null then raise exception 'customer_required' using errcode = '22023'; end if;
  perform pg_catalog.set_config('request.jwt.claims',
    jsonb_build_object('sub', p_customer_id, 'role', 'authenticated')::text, true);
  if auth.uid() is distinct from p_customer_id then
    raise exception 'customer_context_failed' using errcode = '42501';
  end if;
  if normalized_method !~ '^[a-z0-9_-]{2,50}$' then
    raise exception 'invalid_payment_method' using errcode = '22023';
  end if;
  address_snapshot := p_shipping_address || jsonb_build_object(
    'recipient_name', trim(p_customer_name), 'postal_code', p_shipping_address->>'postalCode',
    'street', p_shipping_address->>'street', 'number', p_shipping_address->>'number',
    'complement', coalesce(p_shipping_address->>'complement', ''),
    'district', p_shipping_address->>'district', 'city', p_shipping_address->>'city',
    'state', upper(p_shipping_address->>'state'), 'phone', nullif(trim(p_customer_phone), ''));
  if effective_ciphertext is null or effective_last_four is null then
    select cpf_ciphertext, cpf_last_four into effective_ciphertext, effective_last_four
    from private.customer_checkout_identity where user_id = auth.uid();
  else
    perform public.save_my_checkout_identity(effective_ciphertext, effective_last_four);
  end if;
  if effective_ciphertext is null or effective_last_four !~ '^[0-9]{4}$' then
    raise exception 'customer_identity_required' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('mercadopago.checkout.test:' || p_idempotency_key::text, 0));
  select sale.* into stored_order
  from public.idempotency_keys checkout_key join public.orders sale on sale.id = checkout_key.resource_id
  where checkout_key.scope = 'mercadopago.checkout.test' and checkout_key.key = p_idempotency_key::text
  for update of sale;
  if stored_order.id is not null then
    if stored_order.customer_id <> auth.uid() then
      raise exception 'idempotency_conflict' using errcode = '42501';
    end if;
    -- Replay the saved quote. Do not reapply coupons or creation side effects on HTTP retry.
    created := jsonb_build_object('orderId', stored_order.id, 'orderCode', stored_order.public_code,
      'paymentId', (select id from public.payments where order_id = stored_order.id and provider = 'mercadopago' limit 1),
      'amountInCents', round(stored_order.grand_total * 100)::bigint,
      'discountInCents', round(stored_order.discount_total * 100)::bigint,
      'name', coalesce((select name from public.coupons where id = stored_order.coupon_id), ''), 'reused', true);
  else
    created := public.create_professional_checkout_order(
      p_idempotency_key, p_customer_name, p_customer_email, p_customer_phone,
      effective_ciphertext, effective_last_four, address_snapshot, p_lines,
      p_coupon_code, p_reservation_minutes);
  end if;
  created_order_id := (created->>'orderId')::uuid;
  if coalesce((created->>'reused')::boolean, false) then
    select * into stored_order from public.orders where id = created_order_id and customer_id = auth.uid();
    if stored_order.id is null
      or stored_order.customer_name_snapshot <> trim(p_customer_name)
      or stored_order.customer_email_snapshot::text <> lower(trim(p_customer_email))
      or coalesce(stored_order.customer_phone_snapshot, '') <> coalesce(nullif(trim(p_customer_phone), ''), '')
      or stored_order.shipping_address_snapshot <> address_snapshot
      or stored_order.cpf_last_four is distinct from effective_last_four
      or (stored_order.coupon_id is null and nullif(trim(p_coupon_code), '') is not null)
      or (stored_order.coupon_id is not null and
        (select code from public.coupons where id = stored_order.coupon_id) is distinct from nullif(trim(p_coupon_code), '')) then
      raise exception 'idempotency_conflict' using errcode = '22023';
    end if;
    select jsonb_array_length(p_lines), count(*) into requested_line_count, matching_line_count
    from public.order_items item
    join jsonb_to_recordset(p_lines) requested(product_id uuid, variant_id uuid, quantity integer)
      on requested.product_id = item.product_id and requested.variant_id = item.variant_id and requested.quantity = item.quantity
    where item.order_id = created_order_id;
    if requested_line_count <> matching_line_count
      or requested_line_count <> (select count(*) from public.order_items where order_id = created_order_id) then
      raise exception 'idempotency_conflict' using errcode = '22023';
    end if;
  else
    -- A later payment method belongs to its new attempt, not to checkout identity.
    update public.orders
    set commercial_rules_snapshot = coalesce(commercial_rules_snapshot, '{}'::jsonb)
        || jsonb_build_object('paymentMethodSelected', normalized_method), updated_at = now()
    where id = created_order_id and customer_id = auth.uid();
    update public.payments
    set payment_method_summary = 'selected:' || normalized_method, updated_at = now()
    where order_id = created_order_id and provider = 'mercadopago';
  end if;
  return created;
end;
$$;
revoke all on function public.confirm_professional_checkout_order(uuid,uuid,text,text,text,text,text,text,jsonb,jsonb,text,integer)
  from public, anon, authenticated;
grant execute on function public.confirm_professional_checkout_order(uuid,uuid,text,text,text,text,text,text,jsonb,jsonb,text,integer)
  to service_role;

create or replace function public.begin_mercadopago_payment_attempt(
  p_order_id uuid, p_idempotency_key uuid, p_payment_method text, p_request_fingerprint text
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  local_payment public.payments%rowtype;
  attempt public.payment_attempts%rowtype;
  normalized_method text := lower(trim(coalesce(p_payment_method, '')));
begin
  if p_idempotency_key is null or normalized_method !~ '^[a-z0-9_-]{2,50}$'
    or (p_request_fingerprint is not null and p_request_fingerprint !~ '^[0-9a-f]{64}$') then
    raise exception 'invalid_payment_attempt' using errcode = '22023';
  end if;
  -- All attempts for the order serialize on the same payment row.
  select payment.* into local_payment
  from public.payments payment join public.orders sale on sale.id = payment.order_id
  where payment.order_id = p_order_id and payment.provider = 'mercadopago'
    and sale.status = 'pending_payment' and payment.status in ('pending', 'rejected')
  for update of payment;
  if local_payment.id is null then raise exception 'payment_not_eligible' using errcode = 'P0001'; end if;

  select * into attempt from public.payment_attempts
  where provider = 'mercadopago' and idempotency_key = p_idempotency_key for update;
  if attempt.id is not null then
    if attempt.order_id <> p_order_id then raise exception 'idempotency_conflict' using errcode = '42501'; end if;
    if regexp_replace(attempt.payment_method, '^[a-z_]+:', '') <> normalized_method
      or (attempt.request_fingerprint is not null and p_request_fingerprint is not null
        and attempt.request_fingerprint <> p_request_fingerprint) then
      raise exception 'idempotency_conflict' using errcode = '22023';
    end if;
    -- Old provider_request_failed rows do not distinguish a refusal from a lost response.
    if attempt.status = 'rejected' and attempt.provider_payment_id is null
      and attempt.status_detail = 'provider_request_failed' then
      update public.payment_attempts set status = 'pending', status_detail = 'provider_result_uncertain'
      where id = attempt.id;
      attempt.status := 'pending';
    end if;
    update public.payment_attempts
    set request_fingerprint = coalesce(request_fingerprint, p_request_fingerprint), updated_at = now()
    where id = attempt.id;
    return jsonb_build_object('id', attempt.id, 'providerPaymentId', attempt.provider_payment_id, 'status', attempt.status);
  end if;

  if (local_payment.provider_payment_id is not null and local_payment.status <> 'rejected')
    or exists(select 1 from public.payment_attempts other
      where other.order_id = p_order_id and other.provider = 'mercadopago'
        and (other.status in ('pending', 'in_review', 'approved')
          or (other.status = 'rejected' and other.provider_payment_id is null
            and other.status_detail = 'provider_request_failed'))) then
    raise exception 'payment_in_progress' using errcode = 'P0001';
  end if;
  insert into public.payment_attempts(
    order_id, payment_id, provider, idempotency_key, payment_method, status, amount, currency, request_fingerprint)
  values(p_order_id, local_payment.id, 'mercadopago', p_idempotency_key, normalized_method,
    'pending', local_payment.amount, local_payment.currency, p_request_fingerprint)
  on conflict(provider, idempotency_key) do nothing
  returning * into attempt;
  if attempt.id is null then raise exception 'idempotency_conflict' using errcode = '42501'; end if;
  return jsonb_build_object('id', attempt.id, 'providerPaymentId', attempt.provider_payment_id, 'status', attempt.status);
end;
$$;
revoke all on function public.begin_mercadopago_payment_attempt(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.begin_mercadopago_payment_attempt(uuid,uuid,text,text) to service_role;

-- Preserve trusted callers of the old contract and apply the same order lock.
create or replace function public.begin_mercadopago_payment_attempt(
  p_order_id uuid, p_idempotency_key uuid, p_payment_method text
)
returns jsonb language sql security definer set search_path = ''
as $$
  select public.begin_mercadopago_payment_attempt(p_order_id, p_idempotency_key, p_payment_method, null);
$$;
revoke all on function public.begin_mercadopago_payment_attempt(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.begin_mercadopago_payment_attempt(uuid,uuid,text) to service_role;

commit;
notify pgrst, 'reload schema';

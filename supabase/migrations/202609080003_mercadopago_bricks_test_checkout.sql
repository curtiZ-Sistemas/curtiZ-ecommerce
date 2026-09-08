-- Checkout Bricks em teste: pedido, pagamento e reserva são criados atomicamente.
create or replace function public.create_mercadopago_test_order(
  p_idempotency_key uuid,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_cpf_ciphertext text,
  p_cpf_last_four text,
  p_shipping_address jsonb,
  p_lines jsonb,
  p_reservation_minutes integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_scope constant text := 'mercadopago.checkout.test';
  v_order public.orders%rowtype;
  v_payment public.payments%rowtype;
  v_cart_id uuid;
  v_reservation_id uuid;
  v_requested_count integer;
  v_valid_count integer;
  v_subtotal numeric(12,2);
  v_cost_total numeric(12,2);
  v_line record;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(p_customer_name, ''))) < 3
    or char_length(trim(coalesce(p_customer_email, ''))) < 3
    or p_cpf_last_four !~ '^[0-9]{4}$'
    or nullif(p_cpf_ciphertext, '') is null
    or jsonb_typeof(p_shipping_address) <> 'object'
    or jsonb_typeof(p_lines) <> 'array'
    or jsonb_array_length(p_lines) not between 1 and 50
    or p_reservation_minutes not between 5 and 120 then
    raise exception 'invalid_checkout_payload' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_scope || ':' || p_idempotency_key::text, 0)
  );

  select sale.* into v_order
  from public.idempotency_keys key
  join public.orders sale on sale.id = key.resource_id
  where key.scope = v_scope and key.key = p_idempotency_key::text
  for update of sale;
  if v_order.id is not null then
    if v_order.customer_id <> v_user_id then
      raise exception 'idempotency_conflict' using errcode = '42501';
    end if;
    select * into v_payment from public.payments
    where order_id = v_order.id and provider = 'mercadopago'
    order by created_at limit 1;
    return jsonb_build_object(
      'orderId', v_order.id,
      'orderCode', v_order.public_code,
      'paymentId', v_payment.id,
      'amountInCents', round(v_order.grand_total * 100)::bigint,
      'reused', true
    );
  end if;

  select count(*), count(distinct requested.variant_id)
  into v_requested_count, v_valid_count
  from jsonb_to_recordset(p_lines) as requested(
    product_id uuid,
    variant_id uuid,
    quantity integer
  );
  if v_requested_count <> v_valid_count then
    raise exception 'duplicate_checkout_line' using errcode = '22023';
  end if;

  select
    count(*),
    coalesce(sum(checked.unit_price * checked.quantity), 0),
    coalesce(sum(checked.unit_cost * checked.quantity), 0)
  into v_valid_count, v_subtotal, v_cost_total
  from (
    select
      requested.variant_id,
      requested.quantity,
      coalesce(variant.price_override, product.base_price) as unit_price,
      coalesce(variant.cost_override, product.cost_price, 0) as unit_cost
    from jsonb_to_recordset(p_lines) as requested(
      product_id uuid,
      variant_id uuid,
      quantity integer
    )
    join public.product_variants variant
      on variant.id = requested.variant_id
      and variant.product_id = requested.product_id
      and variant.active
    join public.products product
      on product.id = variant.product_id and product.status = 'active'
    join public.inventory stock
      on stock.variant_id = variant.id
      and stock.available_quantity >= requested.quantity
    where requested.quantity between 1 and 10
  ) checked;
  if v_valid_count <> v_requested_count or v_subtotal <= 0 then
    raise exception 'checkout_line_unavailable' using errcode = 'P0001';
  end if;

  select cart.id into v_cart_id
  from public.carts cart
  where cart.customer_id = v_user_id and cart.status = 'active'
  order by cart.updated_at desc
  limit 1
  for update;
  if v_cart_id is null then
    insert into public.carts(customer_id, status)
    values (v_user_id, 'active')
    returning id into v_cart_id;
  end if;

  insert into public.orders(
    customer_id, customer_email_snapshot, customer_name_snapshot,
    customer_phone_snapshot, cpf_ciphertext, cpf_last_four, status,
    payment_status, currency, subtotal, shipping_total, grand_total, cost_total,
    estimated_profit,
    shipping_address_snapshot, commercial_rules_snapshot
  ) values (
    v_user_id, lower(trim(p_customer_email)), trim(p_customer_name),
    nullif(trim(p_customer_phone), ''), p_cpf_ciphertext, p_cpf_last_four,
    'pending_payment', 'pending', 'BRL', v_subtotal, 0, v_subtotal, v_cost_total,
    v_subtotal - v_cost_total,
    p_shipping_address,
    jsonb_build_object('paymentProvider', 'mercadopago', 'paymentMode', 'test')
  ) returning * into v_order;

  insert into public.order_items(
    order_id, product_id, variant_id, product_name_snapshot, sku_snapshot,
    color_snapshot, size_snapshot, quantity, unit_price, total,
    unit_cost_snapshot
  )
  select
    v_order.id, product.id, variant.id, product.name, variant.sku,
    variant.color_name, variant.size, requested.quantity,
    coalesce(variant.price_override, product.base_price),
    coalesce(variant.price_override, product.base_price) * requested.quantity,
    coalesce(variant.cost_override, product.cost_price, 0)
  from jsonb_to_recordset(p_lines) as requested(
    product_id uuid,
    variant_id uuid,
    quantity integer
  )
  join public.product_variants variant on variant.id = requested.variant_id
  join public.products product on product.id = variant.product_id;

  for v_line in
    select requested.variant_id, requested.quantity
    from jsonb_to_recordset(p_lines) as requested(
      product_id uuid,
      variant_id uuid,
      quantity integer
    )
    order by requested.variant_id
  loop
    v_reservation_id := private.reserve_inventory(
      v_cart_id,
      v_line.variant_id,
      v_line.quantity,
      now() + pg_catalog.make_interval(mins => p_reservation_minutes)
    );
    update public.inventory_reservations
    set order_id = v_order.id
    where id = v_reservation_id;
  end loop;

  insert into public.payments(
    order_id, provider, external_reference, status, amount, currency
  ) values (
    v_order.id, 'mercadopago', v_order.public_code, 'pending', v_order.grand_total, 'BRL'
  ) returning * into v_payment;

  insert into public.idempotency_keys(key, scope, resource_id, expires_at)
  values (p_idempotency_key::text, v_scope, v_order.id, now() + interval '24 hours');

  return jsonb_build_object(
    'orderId', v_order.id,
    'orderCode', v_order.public_code,
    'paymentId', v_payment.id,
    'amountInCents', round(v_order.grand_total * 100)::bigint,
    'reused', false
  );
end;
$$;

revoke all on function public.create_mercadopago_test_order(uuid,text,text,text,text,text,jsonb,jsonb,integer) from public, anon;
grant execute on function public.create_mercadopago_test_order(uuid,text,text,text,text,text,jsonb,jsonb,integer) to authenticated;

create or replace function private.release_order_reservations(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  reservation record;
begin
  for reservation in
    select * from public.inventory_reservations
    where order_id = p_order_id and converted_at is null and released_at is null
    for update
  loop
    update public.inventory
    set available_quantity = available_quantity + reservation.quantity,
        reserved_quantity = reserved_quantity - reservation.quantity,
        version = version + 1,
        updated_at = now()
    where variant_id = reservation.variant_id
      and reserved_quantity >= reservation.quantity;
    update public.inventory_reservations set released_at = now() where id = reservation.id;
  end loop;
end;
$$;

revoke all on function private.release_order_reservations(uuid) from public, anon, authenticated;

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
  previous_order_status public.order_status;
begin
  select * into local_payment from public.payments
  where external_reference = p_external_reference for update;

  if local_payment.id is null or local_payment.amount <> p_amount
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
    set status = 'payment_approved', payment_status = 'approved',
        placed_at = coalesce(placed_at, now()), updated_at = now()
    where id = local_payment.order_id and status = 'pending_payment';
  elsif p_status in ('rejected', 'cancelled') then
    select status into previous_order_status from public.orders
    where id = local_payment.order_id for update;
    perform private.release_order_reservations(local_payment.order_id);
    update public.orders
    set status = 'cancelled', payment_status = p_status, updated_at = now()
    where id = local_payment.order_id and status = 'pending_payment';
    if previous_order_status = 'pending_payment' then
      insert into public.order_status_history(order_id, previous_status, new_status, reason)
      values(local_payment.order_id, previous_order_status, 'cancelled', 'Pagamento não aprovado pelo provedor');
    end if;
  elsif p_status in ('charged_back', 'in_review') then
    update public.orders set status = 'manual_review', payment_status = p_status, updated_at = now()
    where id = local_payment.order_id;
  elsif p_status = 'refunded' then
    update public.orders set status = 'refunded', payment_status = 'refunded', updated_at = now()
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

revoke all on function public.finalize_mercadopago_payment(text,text,text,numeric,text,public.payment_status,timestamptz) from public, anon, authenticated;
grant execute on function public.finalize_mercadopago_payment(text,text,text,numeric,text,public.payment_status,timestamptz) to service_role;

notify pgrst, 'reload schema';

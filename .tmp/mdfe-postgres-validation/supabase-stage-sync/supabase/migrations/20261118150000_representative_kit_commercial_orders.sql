-- Commercial kit orders use shared stock and a private lifecycle.
-- Release evidence is intentionally empty after migration.
create table private.representative_kit_checkout_approvals (
  actor_id uuid not null references public.profiles(id),
  rule_version_id uuid not null references private.representative_resale_fiscal_rule_approvals(rule_version_id),
  buyer_profile text not null check (buyer_profile in ('MG01', 'MG02')),
  buyer_fiscal_state text not null check (buyer_fiscal_state = 'MG'),
  origin_postal_code text not null check (origin_postal_code ~ '^3[0-9]{7}$'),
  buyer_evidence text not null check (length(btrim(buyer_evidence)) >= 10),
  operation_evidence text not null check (length(btrim(operation_evidence)) >= 10),
  stock_evidence text not null check (length(btrim(stock_evidence)) >= 10),
  homologation_evidence text not null check (length(btrim(homologation_evidence)) >= 10),
  valid_until timestamptz not null,
  revoked_at timestamptz,
  primary key (actor_id, rule_version_id)
);

alter table private.representative_kit_shipping_checkout_quotes
  add column origin_postal_code text check (origin_postal_code ~ '^3[0-9]{7}$'),
  add column merchandise_unit_cents bigint check (merchandise_unit_cents > 0),
  add column product_dimensions jsonb check (jsonb_typeof(product_dimensions) = 'array');

create table private.representative_kit_orders (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id),
  variant_id uuid not null references public.product_variants(id),
  quantity integer not null check (quantity between 1 and 99),
  quote_id uuid not null unique,
  address_id uuid not null,
  idempotency_key uuid not null,
  rule_version_id uuid not null,
  sku text not null,
  product_name text not null,
  unit_price_cents bigint not null check (unit_price_cents > 0),
  shipping_cents bigint not null check (shipping_cents >= 0),
  shipping_snapshot jsonb not null,
  state text not null default 'reserved' check (state in ('reserved','payment_pending','paid','cancelled','refunded','manual_review')),
  stock_state text not null default 'reserved' check (stock_state in ('reserved','sold','released')),
  payment_started_at timestamptz,
  provider_payment_id text unique,
  reserved_until timestamptz not null,
  created_at timestamptz not null default now(),
  unique (actor_id, idempotency_key),
  foreign key (actor_id, rule_version_id) references private.representative_kit_checkout_approvals(actor_id, rule_version_id),
  check (private.is_representative_kit_mg_snapshot(shipping_snapshot))
);
create index representative_kit_orders_variant on private.representative_kit_orders(variant_id);
create index representative_kit_orders_rule on private.representative_kit_orders(actor_id, rule_version_id);
create index representative_kit_orders_unstarted on private.representative_kit_orders(reserved_until)
  where state = 'reserved' and payment_started_at is null;
create index representative_kit_checkout_approvals_rule on private.representative_kit_checkout_approvals(rule_version_id);

alter table private.representative_kit_checkout_approvals enable row level security;
alter table private.representative_kit_checkout_approvals force row level security;
alter table private.representative_kit_orders enable row level security;
alter table private.representative_kit_orders force row level security;
revoke all on private.representative_kit_checkout_approvals, private.representative_kit_orders
  from public, anon, authenticated, service_role;

-- These values match the inputs used by resolveShippingProducts, in database units.
create function private.representative_kit_shipping_inputs(p_variant uuid)
returns table (price_cents bigint, dimensions jsonb)
language sql stable set search_path = '' as $$
  select round(coalesce(v.price_override, p.base_price) * 100)::bigint,
    jsonb_build_array(p.weight_grams, p.width_cm, p.height_cm, p.length_cm)
  from public.product_variants v join public.products p on p.id = v.product_id
  where v.id = p_variant and v.active and p.status = 'active';
$$;
revoke all on function private.representative_kit_shipping_inputs(uuid) from public, anon, authenticated, service_role;

-- The server passes the exact inputs used for the carrier call. Compare them
-- under catalog locks so a concurrent price or packing edit invalidates the result.
create function public.confirm_representative_kit_shipping_quote(
  p_actor uuid, p_variant uuid, p_quantity integer, p_address uuid, p_postal_code text,
  p_cart_fingerprint text, p_service_id text, p_service text, p_carrier text,
  p_amount_in_cents integer, p_cost_in_cents integer, p_estimated_days integer,
  p_packages jsonb, p_expires_at timestamptz, p_origin_postal_code text,
  p_unit_price_cents bigint, p_dimensions jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  issued jsonb;
begin
  if p_origin_postal_code is null or p_origin_postal_code !~ '^3[0-9]{7}$' then
    raise exception 'representative_kit_origin_outside_mg' using errcode = '23514';
  end if;
  perform 1 from public.product_variants v join public.products p on p.id = v.product_id
    where v.id = p_variant for share of v, p;
  if not exists (select 1 from private.representative_kit_shipping_inputs(p_variant) s
    where s.price_cents = p_unit_price_cents and s.price_cents > 0 and s.dimensions = p_dimensions) then
    raise exception 'kit_shipping_inputs_changed' using errcode = '23514';
  end if;
  issued := public.issue_representative_kit_shipping_quote(
    p_actor, p_variant, p_quantity, p_address, p_postal_code, p_cart_fingerprint,
    p_service_id, p_service, p_carrier, p_amount_in_cents, p_cost_in_cents,
    p_estimated_days, p_packages, p_expires_at
  );
  update private.representative_kit_shipping_checkout_quotes
    set origin_postal_code = p_origin_postal_code, merchandise_unit_cents = p_unit_price_cents,
      product_dimensions = p_dimensions
    where id = (issued ->> 'id')::uuid;
  return issued;
end;
$$;
revoke all on function public.confirm_representative_kit_shipping_quote(
  uuid,uuid,integer,uuid,text,text,text,text,text,integer,integer,integer,jsonb,timestamptz,text,bigint,jsonb
) from public, anon, authenticated;
grant execute on function public.confirm_representative_kit_shipping_quote(
  uuid,uuid,integer,uuid,text,text,text,text,text,integer,integer,integer,jsonb,timestamptz,text,bigint,jsonb
) to service_role;

create function private.find_representative_kit_checkout_approval(p_actor uuid, p_variant uuid, p_origin text)
returns uuid language sql stable set search_path = '' as $$
  with candidates as (
    select r.id
    from private.representative_kit_checkout_approvals a
    join private.representative_resale_fiscal_rule_versions r on r.id = a.rule_version_id
    join private.representative_resale_fiscal_rule_approvals e on e.rule_version_id = r.id
    left join private.representative_resale_fiscal_rule_revocations v on v.rule_version_id = r.id
    where a.actor_id = p_actor and a.revoked_at is null and a.valid_until > statement_timestamp()
      and a.origin_postal_code = p_origin and a.buyer_fiscal_state = 'MG'
      and e.approved_at <= statement_timestamp() and v.rule_version_id is null
      and r.origin_state = 'MG' and r.destination_state = 'MG' and r.person_type = 'business'
      and r.icms_status = 'taxpayer' and r.purpose = 'resale' and not r.final_consumer
      and r.fiscal_parameters ->> 'buyerProfile' = a.buyer_profile
      and r.valid_from <= statement_timestamp() and statement_timestamp() < r.valid_until
      and r.product_fingerprint = public.read_representative_resale_product_fingerprint(p_variant)
  )
  select case when count(*) = 1 then (array_agg(id))[1] end from candidates;
$$;
revoke all on function private.find_representative_kit_checkout_approval(uuid,uuid,text)
  from public, anon, authenticated, service_role;

create function private.representative_kit_order_summary(o private.representative_kit_orders)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('orderId', o.id, 'state', o.state, 'variantId', o.variant_id,
    'quantity', o.quantity, 'amountInCents', o.unit_price_cents * o.quantity + o.shipping_cents,
    'shippingInCents', o.shipping_cents, 'reservedUntil', o.reserved_until);
$$;
revoke all on function private.representative_kit_order_summary(private.representative_kit_orders)
  from public, anon, authenticated, service_role;

create function public.reserve_representative_kit_order(
  p_actor uuid, p_variant uuid, p_quantity integer, p_quote uuid, p_address uuid, p_key uuid,
  p_origin_postal_code text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  order_row private.representative_kit_orders;
  quote private.representative_kit_shipping_checkout_quotes;
  cart_fingerprint text;
  address_row public.addresses;
  rule_id uuid;
  price_cents bigint;
  current_dimensions jsonb;
  selected_sku text;
  selected_name text;
begin
  if p_actor is null or p_variant is null or p_quote is null or p_address is null or p_key is null
    or p_quantity is null or p_quantity not between 1 and 99 then
    raise exception 'invalid_kit_request' using errcode = '22023';
  end if;

  perform 1 from public.profiles p join public.representatives r on r.user_id = p.id
    where p.id = p_actor and p.status = 'active' and r.status in ('approved_waiting_kit','active','unqualified')
    for share of p, r;
  if not found then raise exception 'kit_access_denied' using errcode = '42501'; end if;

  perform pg_advisory_xact_lock(hashtextextended('representative-kit:' || p_actor::text || ':' || p_key::text, 0));
  select * into order_row from private.representative_kit_orders
    where actor_id = p_actor and idempotency_key = p_key;
  if found then
    if (order_row.variant_id, order_row.quantity, order_row.quote_id, order_row.address_id)
      is distinct from (p_variant, p_quantity, p_quote, p_address) then
      raise exception 'kit_idempotency_conflict' using errcode = '23505';
    end if;
    return private.representative_kit_order_summary(order_row);
  end if;

  select q.cart_fingerprint into cart_fingerprint from private.representative_kit_shipping_checkout_quotes q
    where q.id = p_quote and q.actor_id = p_actor;
  quote := private.consume_representative_kit_shipping_quote(
    p_quote, p_actor, p_variant, p_quantity, p_address, cart_fingerprint);
  if quote.id is null or quote.expires_at <= clock_timestamp() or p_origin_postal_code is null
    or quote.origin_postal_code is distinct from p_origin_postal_code then
    raise exception 'kit_quote_unavailable' using errcode = '23514';
  end if;

  select s.price_cents, s.dimensions, v.sku, p.name
    into price_cents, current_dimensions, selected_sku, selected_name
    from private.representative_kit_shipping_inputs(p_variant) s
    join public.product_variants v on v.id = p_variant join public.products p on p.id = v.product_id;
  if quote.merchandise_unit_cents is null or quote.product_dimensions is null
    or quote.merchandise_unit_cents is distinct from price_cents
    or quote.product_dimensions is distinct from current_dimensions then
    raise exception 'kit_shipping_inputs_changed' using errcode = '23514';
  end if;

  rule_id := private.find_representative_kit_checkout_approval(p_actor, p_variant, p_origin_postal_code);
  if rule_id is null then raise exception 'resale_not_homologated' using errcode = '23514'; end if;

  select * into strict address_row from public.addresses where id = p_address;
  update public.inventory set available_quantity = available_quantity - p_quantity,
    reserved_quantity = reserved_quantity + p_quantity, version = version + 1, updated_at = now()
    where variant_id = p_variant and available_quantity >= p_quantity;
  if not found then raise exception 'kit_stock_unavailable' using errcode = '23514'; end if;

  insert into private.representative_kit_orders (
    actor_id, variant_id, quantity, quote_id, address_id, idempotency_key, rule_version_id,
    sku, product_name, unit_price_cents, shipping_cents, shipping_snapshot, reserved_until
  ) values (
    p_actor, p_variant, p_quantity, p_quote, p_address, p_key, rule_id, selected_sku, selected_name,
    price_cents, quote.amount_in_cents,
    jsonb_build_object('provider', 'melhorenvio', 'originPostalCode', quote.origin_postal_code,
      'serviceId', quote.service_id, 'service', quote.service, 'carrier', quote.carrier,
      'packages', quote.packages, 'costInCents', quote.cost_in_cents, 'estimatedDays', quote.estimated_days,
      'address', jsonb_build_object('state', address_row.state, 'postalCode', quote.postal_code,
        'version', address_row.updated_at)),
    least(quote.expires_at, clock_timestamp() + interval '15 minutes')
  ) returning * into order_row;
  return private.representative_kit_order_summary(order_row);
end;
$$;
revoke all on function public.reserve_representative_kit_order(uuid,uuid,integer,uuid,uuid,uuid,text)
  from public, anon, authenticated;
grant execute on function public.reserve_representative_kit_order(uuid,uuid,integer,uuid,uuid,uuid,text)
  to service_role;

-- Recovery only releases a hold while no provider write could be in flight.
create function public.cancel_unstarted_representative_kit_order(p_actor uuid, p_order uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  order_row private.representative_kit_orders;
begin
  select * into order_row from private.representative_kit_orders where id = p_order for update;
  if not found or (p_actor is not null and order_row.actor_id <> p_actor) then return false; end if;
  if order_row.state = 'cancelled' then return true; end if;
  if order_row.state <> 'reserved' or order_row.stock_state <> 'reserved'
    or order_row.payment_started_at is not null
    or (p_actor is null and order_row.reserved_until > clock_timestamp()) then return false; end if;

  update public.inventory set available_quantity = available_quantity + order_row.quantity,
    reserved_quantity = reserved_quantity - order_row.quantity, version = version + 1, updated_at = now()
    where variant_id = order_row.variant_id and reserved_quantity >= order_row.quantity;
  if not found then raise exception 'kit_stock_inconsistent' using errcode = '23514'; end if;
  update private.representative_kit_orders set state = 'cancelled', stock_state = 'released' where id = p_order;
  return true;
end;
$$;
revoke all on function public.cancel_unstarted_representative_kit_order(uuid,uuid) from public, anon, authenticated;
grant execute on function public.cancel_unstarted_representative_kit_order(uuid,uuid) to service_role;

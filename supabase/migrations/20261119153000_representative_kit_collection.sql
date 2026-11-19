create table private.representative_kit_collection_routes (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 3 and 100),
  origin_postal_code text not null check (origin_postal_code ~ '^3[0-9]{7}$'),
  destination_from text not null check (destination_from ~ '^3[0-9]{7}$'),
  destination_through text not null check (destination_through ~ '^3[0-9]{7}$'),
  delivery_cents integer not null check (delivery_cents >= 0),
  estimated_days integer not null check (estimated_days between 0 and 60),
  bling_method_ids jsonb not null check (
    jsonb_typeof(bling_method_ids)='object'
    and (bling_method_ids ->> 'cash') ~ '^[1-9][0-9]{0,14}$'
    and (bling_method_ids ->> 'pix') ~ '^[1-9][0-9]{0,14}$'
    and (bling_method_ids ->> 'debit_card') ~ '^[1-9][0-9]{0,14}$'
    and (bling_method_ids ->> 'credit_card') ~ '^[1-9][0-9]{0,14}$'
    and bling_method_ids ?& array['cash','pix','debit_card','credit_card']
  ),
  point_terminal_id text not null check (point_terminal_id ~ '^[A-Za-z0-9_]{4,80}$'),
  verified_evidence text not null check (length(btrim(verified_evidence)) between 10 and 500),
  valid_until timestamptz not null,
  closed_at timestamptz,
  check (destination_from <= destination_through)
);
alter table private.representative_kit_collection_routes enable row level security;
alter table private.representative_kit_collection_routes force row level security;
revoke all on private.representative_kit_collection_routes from public, anon, authenticated, service_role;

alter table private.representative_kit_shipping_checkout_quotes
  add column collection_route_id uuid references private.representative_kit_collection_routes(id);
create index representative_kit_quotes_collection_route
  on private.representative_kit_shipping_checkout_quotes(collection_route_id) where collection_route_id is not null;

alter table private.representative_kit_orders
  drop constraint representative_kit_orders_state_check,
  add constraint representative_kit_orders_state_check
    check (state in ('reserved','payment_pending','paid','cancelled','refunded','manual_review','awaiting_receipt')),
  add column collection_route_id uuid references private.representative_kit_collection_routes(id),
  add column collection_method text check (collection_method in ('cash','pix','debit_card','credit_card')),
  add column collection_bling_method bigint check (collection_bling_method > 0),
  add column collection_point_terminal text,
  add column cash_tendered_cents bigint,
  add column cash_change_cents bigint generated always as (cash_tendered_cents-unit_price_cents*quantity-shipping_cents) stored,
  add constraint representative_kit_order_collection_complete check (
    num_nonnulls(collection_route_id,collection_method,collection_bling_method,collection_point_terminal) in (0,4)
    and ((collection_method is not distinct from 'cash') = (cash_tendered_cents is not null))
    and (cash_tendered_cents is null or cash_tendered_cents >= unit_price_cents*quantity+shipping_cents)
    and (state <> 'awaiting_receipt' or collection_route_id is not null)
  );
create index representative_kit_orders_collection_route
  on private.representative_kit_orders(collection_route_id) where collection_route_id is not null;

create function public.quote_representative_kit_collection(
  p_actor uuid,p_selection uuid,p_template text,p_quantity integer,p_address uuid,p_origin text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  route private.representative_kit_collection_routes;
  address_row public.addresses;
  postal text;
  grade_shipping jsonb;
  inserted jsonb;
  price bigint;
  dimensions jsonb;
  expiry timestamptz := clock_timestamp()+interval '15 minutes';
begin
  if p_quantity is null or p_quantity not between 1 and 99 then return null; end if;
  select * into address_row from public.addresses a where a.user_id=p_actor
    and a.id=p_address and a.state='MG' and a.country='BR' for share;
  if not found then return null; end if;
  postal:=regexp_replace(address_row.postal_code,'[^0-9]','','g');
  if postal !~ '^3[0-9]{7}$' then return null; end if;
  select q.* into route from private.representative_kit_collection_routes q
    where q.origin_postal_code=p_origin and postal between q.destination_from and q.destination_through
      and q.valid_until>expiry and q.closed_at is null
      and 1=(select count(*) from private.representative_kit_collection_routes t
        where t.origin_postal_code=p_origin and postal between t.destination_from and t.destination_through
          and t.valid_until>expiry and t.closed_at is null)
    for share;
  if not found then return null; end if;
  if p_template is null then
    if not public.representative_kit_purchase_available(p_actor,p_selection,p_origin) then return null; end if;
    select inputs.price_cents,inputs.dimensions into price,dimensions
      from private.representative_kit_shipping_inputs(p_selection) inputs
      join private.bling_catalog_metadata m on m.product_id=(select product_id from public.product_variants where id=p_selection)
      join public.inventory i on i.variant_id=p_selection
      where m.pairs_per_sku>1 and i.available_quantity>=p_quantity;
    if not found or price<=0 then return null; end if;
    inserted:=public.confirm_representative_kit_shipping_quote(
      p_actor,p_selection,p_quantity,p_address,postal,repeat('0',64),'recebimento',route.name,route.name,
      route.delivery_cents,route.delivery_cents,route.estimated_days,'[]'::jsonb,expiry,p_origin,price,dimensions);
  else
    grade_shipping:=public.read_representative_kit_grade_shipping(p_actor,p_selection,p_template,p_quantity,p_address,p_origin);
    if grade_shipping -> 'purchaseAvailable' is distinct from 'true'::jsonb then return null; end if;
    price:=(grade_shipping ->> 'priceCents')::bigint;
    inserted:=public.confirm_representative_kit_grade_shipping(
      p_actor,p_selection,p_template,p_quantity,p_address,p_origin,grade_shipping ->> 'catalogHash',
      address_row.updated_at,repeat('0',64),'recebimento',route.name,route.name,route.delivery_cents,
      route.delivery_cents,route.estimated_days,'[]'::jsonb,expiry);
  end if;
  if inserted ->> 'id' is null then return null; end if;
  update private.representative_kit_shipping_checkout_quotes set collection_route_id=route.id
    where id=(inserted ->> 'id')::uuid;
  return jsonb_build_object('id',inserted -> 'id','shippingInCents',route.delivery_cents,
    'amountInCents',price*p_quantity+route.delivery_cents,'estimatedDays',route.estimated_days,'service',route.name);
end;
$$;
revoke all on function public.quote_representative_kit_collection(uuid,uuid,text,integer,uuid,text) from public, anon, authenticated;
grant execute on function public.quote_representative_kit_collection(uuid,uuid,text,integer,uuid,text) to service_role;

alter function public.reserve_representative_kit_order(uuid,uuid,integer,uuid,uuid,uuid,text) set schema private;
alter function public.reserve_representative_kit_grade_order(uuid,uuid,text,integer,uuid,uuid,uuid,text) set schema private;
revoke all on function private.reserve_representative_kit_order(uuid,uuid,integer,uuid,uuid,uuid,text),
  private.reserve_representative_kit_grade_order(uuid,uuid,text,integer,uuid,uuid,uuid,text)
  from public, anon, authenticated, service_role;

create function public.reserve_representative_kit_order(
  p_actor uuid,p_variant uuid,p_quantity integer,p_quote uuid,p_address uuid,p_key uuid,p_origin_postal_code text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from private.representative_kit_shipping_checkout_quotes
    where id=p_quote and collection_route_id is not null)
    or exists(select 1 from private.representative_kit_orders
      where actor_id=p_actor and idempotency_key=p_key and collection_route_id is not null) then
    raise exception 'kit_collection_selection_required' using errcode='23514';
  end if;
  return private.reserve_representative_kit_order(p_actor,p_variant,p_quantity,p_quote,p_address,p_key,p_origin_postal_code);
end;
$$;

create function public.reserve_representative_kit_grade_order(
  p_actor uuid,p_kit uuid,p_template text,p_quantity integer,p_quote uuid,p_address uuid,p_key uuid,p_origin text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from private.representative_kit_shipping_checkout_quotes
    where id=p_quote and collection_route_id is not null)
    or exists(select 1 from private.representative_kit_orders
      where actor_id=p_actor and idempotency_key=p_key and collection_route_id is not null) then
    raise exception 'kit_collection_selection_required' using errcode='23514';
  end if;
  return private.reserve_representative_kit_grade_order(p_actor,p_kit,p_template,p_quantity,p_quote,p_address,p_key,p_origin);
end;
$$;
revoke all on function public.reserve_representative_kit_order(uuid,uuid,integer,uuid,uuid,uuid,text),
  public.reserve_representative_kit_grade_order(uuid,uuid,text,integer,uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.reserve_representative_kit_order(uuid,uuid,integer,uuid,uuid,uuid,text),
  public.reserve_representative_kit_grade_order(uuid,uuid,text,integer,uuid,uuid,uuid,text) to service_role;

create or replace function private.representative_kit_order_summary(o private.representative_kit_orders)
returns jsonb language sql stable set search_path = ''
as $$
  select jsonb_build_object('orderId',o.id,'state',o.state,'variantId',o.variant_id,
    'quantity',o.quantity,'amountInCents',o.unit_price_cents*o.quantity+o.shipping_cents,
    'shippingInCents',o.shipping_cents,'reservedUntil',o.reserved_until,
    'collectionMethod',o.collection_method,'cashTenderedInCents',o.cash_tendered_cents,'cashChangeInCents',o.cash_change_cents);
$$;

create function public.reserve_representative_kit_collection_order(
  p_actor uuid,p_selection uuid,p_template text,p_quantity integer,p_quote uuid,p_address uuid,
  p_key uuid,p_origin text,p_method text,p_cash_tendered bigint
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  route private.representative_kit_collection_routes;
  reserved jsonb;
  o private.representative_kit_orders;
  total bigint;
begin
  if p_actor is null or p_key is null or p_method is null
    or p_method not in ('cash','pix','debit_card','credit_card') or (p_method='cash')<>(p_cash_tendered is not null) then
    raise exception 'invalid_kit_collection' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('representative-kit:'||p_actor::text||':'||p_key::text,0));
  select * into o from private.representative_kit_orders where actor_id=p_actor and idempotency_key=p_key;
  if found then
    if (coalesce(o.grade_kit_id,o.variant_id),o.grade_template,o.quantity,o.quote_id,o.address_id,o.collection_method,o.cash_tendered_cents)
      is distinct from (p_selection,p_template,p_quantity,p_quote,p_address,p_method,p_cash_tendered) then
      raise exception 'kit_idempotency_conflict' using errcode='23505';
    end if;
    return private.representative_kit_order_summary(o);
  end if;

  select cr.* into route from private.representative_kit_shipping_checkout_quotes q
    join private.representative_kit_collection_routes cr on cr.id=q.collection_route_id
    where q.id=p_quote and q.actor_id=p_actor and q.address_id=p_address and q.origin_postal_code=p_origin
      and cr.origin_postal_code=p_origin and q.postal_code between cr.destination_from and cr.destination_through
      and cr.delivery_cents=q.amount_in_cents and cr.estimated_days=q.estimated_days
      and cr.valid_until>clock_timestamp() and cr.closed_at is null for share of cr;
  if not found then raise exception 'kit_collection_unavailable' using errcode='23514'; end if;

  if p_template is null then
    reserved:=private.reserve_representative_kit_order(p_actor,p_selection,p_quantity,p_quote,p_address,p_key,p_origin);
  else
    reserved:=private.reserve_representative_kit_grade_order(p_actor,p_selection,p_template,p_quantity,p_quote,p_address,p_key,p_origin);
  end if;
  total:=(reserved ->> 'amountInCents')::bigint;
  if p_method='cash' and (p_cash_tendered<total or p_cash_tendered>9007199254740991) then
    raise exception 'kit_cash_tender_invalid' using errcode='23514';
  end if;
  update private.representative_kit_orders set state='awaiting_receipt',collection_route_id=route.id,
    collection_method=p_method,collection_bling_method=(route.bling_method_ids ->> p_method)::bigint,
    collection_point_terminal=route.point_terminal_id,cash_tendered_cents=p_cash_tendered,
    shipping_snapshot=jsonb_set(shipping_snapshot,'{provider}','"own_delivery"')
    where id=(reserved ->> 'orderId')::uuid returning * into o;
  insert into private.representative_kit_fulfillment(order_id) values (o.id) on conflict do nothing;
  return private.representative_kit_order_summary(o);
end;
$$;
revoke all on function public.reserve_representative_kit_collection_order(uuid,uuid,text,integer,uuid,uuid,uuid,text,text,bigint)
  from public, anon, authenticated;
grant execute on function public.reserve_representative_kit_collection_order(uuid,uuid,text,integer,uuid,uuid,uuid,text,text,bigint)
  to service_role;

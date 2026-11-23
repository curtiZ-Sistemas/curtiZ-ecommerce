create function private.representative_kit_route_methods_valid(p_methods jsonb,p_terminal text)
returns boolean language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(p_methods)='object' then
    not exists(select 1 from jsonb_each_text(p_methods) as method(name,id)
      where name not in ('cash','pix','debit_card','credit_card') or id is null or id !~ '^[1-9][0-9]{0,14}$'
        or (name<>'cash' and p_terminal is null))
    else false end;
$$;
revoke all on function private.representative_kit_route_methods_valid(jsonb,text) from public,anon,authenticated,service_role;

alter table private.representative_kit_collection_routes
  drop constraint representative_kit_collection_routes_bling_method_ids_check,
  drop constraint representative_kit_collection_method_ids_present,
  alter column point_terminal_id drop not null,
  add constraint representative_kit_verified_route_methods check (
    private.representative_kit_route_methods_valid(bling_method_ids,point_terminal_id));

alter table private.representative_kit_orders
  drop constraint representative_kit_order_collection_complete,
  add constraint representative_kit_order_collection_complete check (
    (num_nonnulls(collection_route_id,collection_method,collection_bling_method)=0 and collection_point_terminal is null
      or num_nonnulls(collection_route_id,collection_method,collection_bling_method)=3
        and (collection_method='cash' or collection_point_terminal is not null))
    and ((collection_method is not distinct from 'cash') = (cash_tendered_cents is not null))
    and (cash_tendered_cents is null or cash_tendered_cents>=unit_price_cents*quantity+shipping_cents)
    and (state<>'awaiting_receipt' or collection_route_id is not null));

create or replace function public.reserve_representative_kit_collection_order(
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
  if not found or not (route.bling_method_ids ? p_method) then
    raise exception 'kit_collection_unavailable' using errcode='23514'; end if;

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
    collection_point_terminal=case when p_method<>'cash' then route.point_terminal_id end,cash_tendered_cents=p_cash_tendered,
    shipping_snapshot=jsonb_set(shipping_snapshot,'{provider}','"own_delivery"')
    where id=(reserved ->> 'orderId')::uuid returning * into o;
  insert into private.representative_kit_fulfillment(order_id) values (o.id) on conflict do nothing;
  return private.representative_kit_order_summary(o);
end;
$$;

create or replace function public.quote_representative_kit_own_delivery(
  p_actor uuid,p_selection uuid,p_template text,p_quantity integer,p_address uuid,p_origin text,p_at_receipt boolean
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
    where (p_origin is null or q.origin_postal_code=p_origin) and postal between q.destination_from and q.destination_through
      and q.valid_until>expiry and q.closed_at is null
      and 1=(select count(*) from private.representative_kit_collection_routes t
        where (p_origin is null or t.origin_postal_code=p_origin) and postal between t.destination_from and t.destination_through
          and t.valid_until>expiry and t.closed_at is null)
    for share;
  if not found or (p_at_receipt and route.bling_method_ids='{}'::jsonb) then return null; end if;
  p_origin := route.origin_postal_code;
  if p_template is null then
    if not public.representative_kit_purchase_available(p_actor,p_selection,p_origin) then return null; end if;
    select inputs.price_cents,inputs.dimensions into price,dimensions
      from private.representative_kit_shipping_inputs(p_selection) inputs
      join private.bling_catalog_metadata m on m.product_id=(select product_id from public.product_variants where id=p_selection)
      join public.inventory i on i.variant_id=p_selection
      where m.pairs_per_sku>1 and i.available_quantity>=p_quantity;
    if not found or price<=0 then return null; end if;
    inserted:=public.confirm_representative_kit_shipping_quote(
      p_actor,p_selection,p_quantity,p_address,postal,repeat('0',64),case when p_at_receipt then 'recebimento' else 'entrega_propria' end,route.name,route.name,
      route.delivery_cents,route.delivery_cents,route.estimated_days,'[]'::jsonb,expiry,p_origin,price,dimensions);
  else
    grade_shipping:=public.read_representative_kit_grade_shipping(p_actor,p_selection,p_template,p_quantity,p_address,p_origin);
    if grade_shipping -> 'purchaseAvailable' is distinct from 'true'::jsonb then return null; end if;
    price:=(grade_shipping ->> 'priceCents')::bigint;
    inserted:=public.confirm_representative_kit_grade_shipping(
      p_actor,p_selection,p_template,p_quantity,p_address,p_origin,grade_shipping ->> 'catalogHash',
      address_row.updated_at,repeat('0',64),case when p_at_receipt then 'recebimento' else 'entrega_propria' end,route.name,route.name,route.delivery_cents,
      route.delivery_cents,route.estimated_days,'[]'::jsonb,expiry);
  end if;
  if inserted ->> 'id' is null then return null; end if;
  update private.representative_kit_shipping_checkout_quotes set own_delivery_route_id=route.id, collection_route_id=case when p_at_receipt then route.id end
    where id=(inserted ->> 'id')::uuid;
  return jsonb_build_object('id',inserted -> 'id','shippingInCents',route.delivery_cents,
    'amountInCents',price*p_quantity+route.delivery_cents,'estimatedDays',route.estimated_days,'service',route.name,
    'collectionMethods',(select coalesce(jsonb_agg(m.name order by m.name),'[]'::jsonb)
      from jsonb_object_keys(route.bling_method_ids) m(name) where p_at_receipt));
end;
$$;

create or replace function public.manage_representative_kit_delivery_route(p_close uuid,p_route jsonb)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  route private.representative_kit_collection_routes;
begin
  perform private.require_permission('representatives.rules.manage');
  if p_close is not null then
    update private.representative_kit_collection_routes set closed_at=clock_timestamp()
      where id=p_close and closed_at is null returning * into route;
    if not found then return false; end if;
  else
    select * into route from jsonb_populate_record(null::private.representative_kit_collection_routes,p_route);
    if route.origin_postal_code is null or route.valid_until is null or route.valid_until <= clock_timestamp()
      or route.delivery_cents is distinct from 0
      or route.point_terminal_id is not null or route.bling_method_ids - 'cash' <> '{}'::jsonb
      or not private.representative_kit_route_methods_valid(route.bling_method_ids,route.point_terminal_id) then return false; end if;
    perform pg_advisory_xact_lock(hashtextextended('kit_route:'||route.origin_postal_code,0));
    if exists (select 1 from private.representative_kit_collection_routes r
      where r.origin_postal_code=route.origin_postal_code and r.closed_at is null and r.valid_until>clock_timestamp()
        and route.destination_from<=r.destination_through and route.destination_through>=r.destination_from)
      then return false; end if;
    insert into private.representative_kit_collection_routes(name,origin_postal_code,destination_from,destination_through,
      delivery_cents,estimated_days,bling_method_ids,point_terminal_id,verified_evidence,valid_until)
    values(route.name,route.origin_postal_code,route.destination_from,route.destination_through,route.delivery_cents,
      route.estimated_days,route.bling_method_ids,route.point_terminal_id,route.verified_evidence,route.valid_until)
    returning id into route.id;
  end if;
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
    values(auth.uid(),private.current_app_role(),
      case when p_close is null then 'representative.kit.route.created' else 'representative.kit.route.closed' end,
      'representative_kit_delivery_route',route.id,jsonb_build_object('origin',route.origin_postal_code));
  return true;
end;
$$;

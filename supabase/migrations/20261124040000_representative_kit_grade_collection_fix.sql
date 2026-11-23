-- Follow-up to 20261124020000/21000 (already applied).
-- quote_representative_kit_own_delivery picked the pickup origin from ALL of the buyer's approvals
-- when none was given. Automatic eligibility now adds one approval per kit sheet fingerprint
-- (standard, lower_restock, upper_restock) and per product, possibly with a different origin than a
-- manual approval, so the choice became ambiguous and the quote answered null (cash on receipt
-- without a route, and prepaid quotes without an origin). The origin is now taken only from the
-- approvals of the fingerprint being quoted. Everything else is the same function.

create or replace function public.quote_representative_kit_own_delivery(
  p_actor uuid,p_selection uuid,p_template text,p_quantity integer,p_address uuid,p_origin text,p_at_receipt boolean
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  route private.representative_kit_collection_routes;
  service_id text;
  cash_method bigint;
  cash_rule uuid;
  receipt_by_address boolean := false;
  address_row public.addresses;
  postal text;
  grade_shipping jsonb;
  inserted jsonb;
  price bigint;
  dimensions jsonb;
  expiry timestamptz := clock_timestamp()+interval '15 minutes';
begin
  if p_at_receipt is null or p_quantity is null or p_quantity not between 1 and 99 then return null; end if;
  select * into address_row from public.addresses a where a.user_id=p_actor
    and a.id=p_address and a.state='MG' and a.country='BR' for share;
  if not found then return null; end if;
  postal:=regexp_replace(address_row.postal_code,'[^0-9]','','g');
  if postal is null or postal !~ '^3[0-9]{7}$' then return null; end if;
  if not private.ensure_representative_kit_auto_eligibility(p_actor,address_row.id) then return null; end if;
  if p_origin is null then
    select min(a.origin_postal_code) into p_origin
      from private.representative_kit_checkout_approvals a
      join private.representative_resale_fiscal_rule_versions r on r.id=a.rule_version_id
      where a.actor_id=p_actor and a.revoked_at is null and a.valid_until>expiry
        and r.product_fingerprint is not distinct from case when p_template is null
          then public.read_representative_resale_product_fingerprint(p_selection)
          else public.read_representative_kit_grade_fingerprint(p_selection,p_template) end
      having count(distinct a.origin_postal_code)=1;
  end if;
  if p_at_receipt and p_origin is not null then
    cash_rule := case when p_template is null
      then private.find_representative_kit_checkout_approval(p_actor,p_selection,p_origin)
      else private.find_representative_kit_approval_by_fingerprint(
        p_actor,public.read_representative_kit_grade_fingerprint(p_selection,p_template),p_origin)
    end;
    cash_method := private.representative_kit_direct_cash_method(p_actor,p_origin,cash_rule);
  end if;
  if p_at_receipt and cash_method is null then
    select q.* into route from private.representative_kit_collection_routes q
      where (p_origin is null or q.origin_postal_code=p_origin) and postal between q.destination_from and q.destination_through
        and q.valid_until>expiry and q.closed_at is null
        and 1=(select count(*) from private.representative_kit_collection_routes t
          where (p_origin is null or t.origin_postal_code=p_origin) and postal between t.destination_from and t.destination_through
            and t.valid_until>expiry and t.closed_at is null)
      for share;
    if found and route.bling_method_ids<>'{}'::jsonb then
      p_origin := route.origin_postal_code;
      service_id := 'recebimento';
    elsif cash_rule is not null and private.representative_kit_manual_rule(p_actor,cash_rule) then
      -- No registered route: the buyer's verified MG address is enough for cash on receipt.
      route := null;
      receipt_by_address := true;
      service_id := 'entrega_propria_endereco';
      route.name := 'Entrega própria';
      route.delivery_cents := 0;
    else
      return null;
    end if;
  else
    if p_origin is null then return null; end if;
    service_id := 'entrega_propria_endereco';
    route.name := 'Entrega própria';
    route.delivery_cents := 0;
  end if;
  if p_template is null then
    if not public.representative_kit_purchase_available(p_actor,p_selection,p_origin) then return null; end if;
    select inputs.price_cents,inputs.dimensions into price,dimensions
      from private.representative_kit_shipping_inputs(p_selection) inputs
      join private.bling_catalog_metadata m on m.product_id=(select product_id from public.product_variants where id=p_selection)
      join public.inventory i on i.variant_id=p_selection
      where m.pairs_per_sku>1 and i.available_quantity>=p_quantity;
    if not found or price<=0 then return null; end if;
    inserted:=public.confirm_representative_kit_shipping_quote(
      p_actor,p_selection,p_quantity,p_address,postal,repeat('0',64),service_id,route.name,route.name,
      route.delivery_cents,route.delivery_cents,route.estimated_days,'[]'::jsonb,expiry,p_origin,price,dimensions);
  else
    grade_shipping:=public.read_representative_kit_grade_shipping(p_actor,p_selection,p_template,p_quantity,p_address,p_origin);
    if grade_shipping -> 'purchaseAvailable' is distinct from 'true'::jsonb then return null; end if;
    price:=(grade_shipping ->> 'priceCents')::bigint;
    inserted:=public.confirm_representative_kit_grade_shipping(
      p_actor,p_selection,p_template,p_quantity,p_address,p_origin,grade_shipping ->> 'catalogHash',
      address_row.updated_at,repeat('0',64),service_id,route.name,route.name,route.delivery_cents,
      route.delivery_cents,route.estimated_days,'[]'::jsonb,expiry);
  end if;
  if inserted ->> 'id' is null then return null; end if;
  update private.representative_kit_shipping_checkout_quotes set address_only_delivery=route.id is null,
    address_cash_bling_method=cash_method,own_delivery_route_id=route.id,address_at_receipt=receipt_by_address,
    collection_route_id=case when p_at_receipt then route.id end
    where id=(inserted ->> 'id')::uuid;
  return jsonb_build_object('id',inserted -> 'id','shippingInCents',route.delivery_cents,
    'amountInCents',price*p_quantity+route.delivery_cents,'estimatedDays',route.estimated_days,'service',route.name,
    'collectionMethods',case when cash_method is not null or receipt_by_address then '["cash"]'::jsonb
      else (select coalesce(jsonb_agg(m.name order by m.name),'[]'::jsonb)
      from jsonb_object_keys(route.bling_method_ids) m(name) where p_at_receipt) end);
end;
$$;

revoke all on function public.quote_representative_kit_own_delivery(uuid,uuid,text,integer,uuid,text,boolean)
  from public,anon,authenticated;
grant execute on function public.quote_representative_kit_own_delivery(uuid,uuid,text,integer,uuid,text,boolean)
  to service_role;

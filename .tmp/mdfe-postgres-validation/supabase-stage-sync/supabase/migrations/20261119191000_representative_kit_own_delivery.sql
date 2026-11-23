-- Record physical delivery separately from collection of payment.
create or replace function private.confirm_representative_kit_collection_receipt(
  o private.representative_kit_orders, p_reference text, p_operator uuid
) returns boolean language plpgsql set search_path = ''
as $$
begin
  if o.state='paid' and exists (select 1 from private.representative_kit_collection_payments p
    where p.order_id=o.id and p.receipt_reference=p_reference and p.confirmed_at is not null) then return true; end if;
  if o.state<>'awaiting_receipt' or o.stock_state<>'reserved' or o.cancellation_requested_at is not null
    or not exists (select 1 from private.representative_kit_fulfillment f
      where f.order_id=o.id and f.shipment_status in ('dispatched','delivered') and f.invoice_access_key is not null
        and f.invoice_cancellation_confirmed_at is null) then return false; end if;

  perform private.transfer_representative_kit_inventory(o,o.quantity,'sell',
    'Pagamento no recebimento de kit de revenda MG','representative_kit_order',o.id,p_operator);
  update private.representative_kit_collection_payments set receipt_reference=p_reference,confirmed_at=clock_timestamp()
    where order_id=o.id and confirmed_at is null;
  if not found then raise exception 'kit_collection_receipt_unavailable' using errcode='23514'; end if;
  update private.representative_kit_orders set state='paid',stock_state='sold',paid_at=clock_timestamp() where id=o.id;
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
    values(p_operator,private.current_app_role(),'representative.kit.collection.confirmed','representative_kit_order',o.id,
      jsonb_build_object('method',o.collection_method,'amountInCents',o.unit_price_cents*o.quantity+o.shipping_cents));
  return true;
end;
$$;
revoke all on function private.confirm_representative_kit_collection_receipt(private.representative_kit_orders,text,uuid)
  from public, anon, authenticated, service_role;

alter table private.representative_kit_shipping_checkout_quotes
  add column own_delivery_route_id uuid references private.representative_kit_collection_routes(id);
alter table private.representative_kit_orders
  add column own_delivery_route_id uuid references private.representative_kit_collection_routes(id);
create index representative_kit_quotes_own_route on private.representative_kit_shipping_checkout_quotes(own_delivery_route_id);
create index representative_kit_orders_own_route on private.representative_kit_orders(own_delivery_route_id);

create function private.record_representative_kit_own_delivery()
returns trigger language plpgsql set search_path = ''
as $$
declare
  quote private.representative_kit_shipping_checkout_quotes;
  route private.representative_kit_collection_routes;
  delivery public.addresses;
begin
  select * into quote from private.representative_kit_shipping_checkout_quotes where id=new.quote_id;
  if quote.own_delivery_route_id is null then return new; end if;
  select * into route from private.representative_kit_collection_routes
    where id=quote.own_delivery_route_id for share;
  if not found or route.closed_at is not null or route.valid_until <= clock_timestamp()
    or quote.origin_postal_code <> route.origin_postal_code
    or quote.postal_code not between route.destination_from and route.destination_through
    or route.delivery_cents <> quote.amount_in_cents or route.name <> quote.service
    or route.estimated_days <> quote.estimated_days
    or 1 <> (select count(*) from private.representative_kit_collection_routes r
      where r.origin_postal_code=quote.origin_postal_code and quote.postal_code between r.destination_from and r.destination_through
        and r.closed_at is null and r.valid_until>clock_timestamp()) then
    raise exception 'kit_own_delivery_quote_changed' using errcode='23514';
  end if;
  select * into strict delivery from public.addresses where id=quote.address_id and user_id=new.actor_id;
  new.own_delivery_route_id := route.id;
  new.shipping_snapshot := new.shipping_snapshot || jsonb_build_object(
    'provider','own_delivery','routeId',route.id,'estimatedDays',route.estimated_days,
    'deliveryAddress',jsonb_build_object('name',delivery.recipient_name,'street',delivery.street,
      'number',delivery.number,'complement',delivery.complement,'district',delivery.district,
      'city',delivery.city,'state',delivery.state,'postalCode',quote.postal_code));
  return new;
end;
$$;
revoke all on function private.record_representative_kit_own_delivery() from public,anon,authenticated,service_role;
create trigger kit_own_delivery_before_reservation
  before insert on private.representative_kit_orders for each row execute function private.record_representative_kit_own_delivery();

create function public.reserve_representative_kit_own_delivery(
  p_actor uuid,p_selection uuid,p_template text,p_quantity integer,p_quote uuid,p_address uuid,p_key uuid,p_origin text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  origin text;
begin
  select q.origin_postal_code into origin from private.representative_kit_shipping_checkout_quotes q
    where q.id=p_quote and q.actor_id=p_actor and q.own_delivery_route_id is not null and q.collection_route_id is null;
  if not found or (p_origin is not null and p_origin <> origin)
    then raise exception 'kit_quote_unavailable' using errcode='23514'; end if;
  if p_template is null then
    return public.reserve_representative_kit_order(p_actor,p_selection,p_quantity,p_quote,p_address,p_key,origin);
  end if;
  return public.reserve_representative_kit_grade_order(p_actor,p_selection,p_template,p_quantity,p_quote,p_address,p_key,origin);
end;
$$;
revoke all on function public.reserve_representative_kit_own_delivery(uuid,uuid,text,integer,uuid,uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.reserve_representative_kit_own_delivery(uuid,uuid,text,integer,uuid,uuid,uuid,text)
  to service_role;

create function public.reserve_representative_kit_own_collection(
  p_actor uuid,p_selection uuid,p_template text,p_quantity integer,p_quote uuid,p_address uuid,
  p_key uuid,p_origin text,p_method text,p_cash_tendered bigint
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  origin text;
begin
  select q.origin_postal_code into origin from private.representative_kit_shipping_checkout_quotes q
    where q.id=p_quote and q.actor_id=p_actor and q.own_delivery_route_id is not null and q.collection_route_id is not null;
  if not found or (p_origin is not null and p_origin <> origin)
    then raise exception 'kit_quote_unavailable' using errcode='23514'; end if;
  return public.reserve_representative_kit_collection_order(p_actor,p_selection,p_template,p_quantity,p_quote,
    p_address,p_key,origin,p_method,p_cash_tendered);
end;
$$;
revoke all on function public.reserve_representative_kit_own_collection(uuid,uuid,text,integer,uuid,uuid,uuid,text,text,bigint)
  from public,anon,authenticated;
grant execute on function public.reserve_representative_kit_own_collection(uuid,uuid,text,integer,uuid,uuid,uuid,text,text,bigint)
  to service_role;

create function public.quote_representative_kit_own_delivery(
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
  if not found then return null; end if;
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
    'amountInCents',price*p_quantity+route.delivery_cents,'estimatedDays',route.estimated_days,'service',route.name);
end;
$$;
revoke all on function public.quote_representative_kit_own_delivery(uuid,uuid,text,integer,uuid,text,boolean) from public, anon, authenticated;
grant execute on function public.quote_representative_kit_own_delivery(uuid,uuid,text,integer,uuid,text,boolean) to service_role;


create or replace function public.list_representative_kit_collection_work()
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not private.has_permission('orders.update_operational_status') then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  return (select coalesce(jsonb_agg(rows.summary),'[]'::jsonb) from (
    select private.representative_kit_order_summary(o) || jsonb_build_object(
      'productName',o.product_name,'invoiceAuthorized',f.invoice_confirmed_at is not null,
      'shipmentStatus',f.shipment_status,'pointStarted',p.point_key is not null,'pointLinked',p.point_order_id is not null,
      'deliveryAddress',o.shipping_snapshot -> 'deliveryAddress',
      'pointStatus',p.point_status,
      'receiptConfirmed',p.confirmed_at is not null,'cancellationRequested',o.cancellation_requested_at is not null,
      'invoiceCancelled',f.invoice_cancellation_confirmed_at is not null) as summary
    from private.representative_kit_orders o join private.representative_kit_fulfillment f on f.order_id=o.id
    left join private.representative_kit_collection_payments p on p.order_id=o.id
    where o.collection_route_id is not null or o.own_delivery_route_id is not null
    order by o.created_at desc,o.id limit 50
  ) rows);
end;
$$;
revoke all on function public.list_representative_kit_collection_work() from public, anon;
grant execute on function public.list_representative_kit_collection_work() to authenticated;


create or replace function public.manage_representative_kit_collection(p_order uuid,p_action text,p_evidence text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  o private.representative_kit_orders;
  f private.representative_kit_fulfillment;
begin
  if auth.uid() is null or not private.has_permission('orders.update_operational_status') then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  if length(btrim(coalesce(p_evidence,''))) not between 10 and 200 then return null; end if;
  select * into o from private.representative_kit_orders where id=p_order and (collection_route_id is not null or own_delivery_route_id is not null) for update;
  if not found or o.actor_id=auth.uid() then return null; end if;
  select * into f from private.representative_kit_fulfillment where order_id=p_order for update;
  if not found then return null; end if;
  if p_action='cash_received' and o.collection_method='cash' and (
    o.state='paid' or o.state='awaiting_receipt' and f.shipment_status in ('dispatched','delivered') and o.cancellation_requested_at is null
  ) then
    insert into private.representative_kit_collection_payments(order_id,opened_by) values(o.id,auth.uid()) on conflict do nothing;
    if not private.confirm_representative_kit_collection_receipt(o,btrim(p_evidence),auth.uid()) then return null; end if;
  elsif p_action='confirm_delivery' and f.shipment_status in ('dispatched','delivered')
    and o.state in ('awaiting_receipt','paid') and o.cancellation_requested_at is null
    and f.invoice_access_key is not null and f.invoice_cancellation_confirmed_at is null then
    if f.shipment_status='delivered' then return jsonb_build_object('ok',true); end if;
    update private.representative_kit_fulfillment set shipment_status='delivered',shipment_rank=7 where order_id=o.id;
  elsif p_action='dispatch' and o.state in ('awaiting_receipt','paid') and o.cancellation_requested_at is null
    and private.representative_kit_fiscal_ready(o) and (f.shipment_rank<4 or f.shipment_status='delayed' and o.collection_route_id is null) and f.invoice_access_key is not null
    and f.invoice_confirmed_at>clock_timestamp()-interval '30 minutes' then
    update private.representative_kit_fulfillment set shipment_status='dispatched',shipment_rank=4 where order_id=o.id;
  elsif p_action='cancel_before_dispatch' and o.state='awaiting_receipt' and o.cancellation_requested_at is null
    and f.shipment_rank<4 and f.bling_invoice_id is not null then
    update private.representative_kit_orders set cancellation_requested_at=clock_timestamp() where id=o.id;
    update private.representative_kit_fulfillment set shipment_status='delayed',shipment_rank=5,checked_at=null where order_id=o.id;
  elsif p_action='delivery_failed' and o.state='paid' and o.collection_route_id is null
    and f.shipment_status='dispatched' and o.cancellation_requested_at is null then
    update private.representative_kit_fulfillment set shipment_status='delayed',shipment_rank=5 where order_id=o.id;
  elsif p_action='delivery_failed' and o.state='awaiting_receipt' and f.shipment_status='dispatched'
    and not exists (select 1 from private.representative_kit_collection_payments p where p.order_id=o.id
      and (p.point_status is null or p.point_status not in ('failed','expired','canceled') or p.confirmed_at is not null)) then
    update private.representative_kit_orders set cancellation_requested_at=clock_timestamp() where id=o.id;
    update private.representative_kit_fulfillment set shipment_status='delayed',shipment_rank=5,checked_at=null where order_id=o.id;
  elsif p_action='returned_unpaid' and o.state='awaiting_receipt' and o.cancellation_requested_at is not null
    and f.shipment_status='delayed' and f.invoice_cancellation_confirmed_at is not null
    and not exists (select 1 from private.representative_kit_collection_payments p where p.order_id=o.id
      and (p.point_status is null or p.point_status not in ('failed','expired','canceled') or p.confirmed_at is not null)) then
    perform private.transfer_representative_kit_inventory(o,o.quantity,'release',null,null,null,null);
    update private.representative_kit_orders set state='cancelled',stock_state='released' where id=o.id;
    update private.representative_kit_fulfillment set shipment_status='returned',shipment_rank=8 where order_id=o.id;
  else
    return null;
  end if;
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
    values(auth.uid(),private.current_app_role(),'representative.kit.collection.'||p_action,'representative_kit_order',o.id,
      jsonb_build_object('evidence',btrim(p_evidence)));
  return jsonb_build_object('ok',true);
end;
$$;
revoke all on function public.manage_representative_kit_collection(uuid,text,text) from public, anon;
grant execute on function public.manage_representative_kit_collection(uuid,text,text) to authenticated;

create or replace function public.due_representative_kit_fulfillment()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(due)),'[]'::jsonb) from (
    select f.order_id as "orderId", f.bling_sale_id as "saleId", f.bling_invoice_id as "invoiceId",
      f.shipment_id as "shipmentId", f.shipment_status as "shipmentStatus", o.variant_id as "variantId",
      o.sku, o.product_name as "productName", o.quantity, coalesce(o.paid_at,o.created_at) as "paidAt", o.grade_lines as "gradeLines",
      o.own_delivery_route_id is not null as "ownDelivery", o.collection_method as "collectionMethod", o.collection_bling_method as "collectionBlingMethod", o.created_at as "createdAt",
      o.shipping_snapshot ->> 'estimatedDays' as "deliveryDays",
      o.unit_price_cents as "unitPriceInCents", o.shipping_cents as "shippingInCents",
      o.unit_price_cents * o.quantity + o.shipping_cents as "amountInCents",
      o.shipping_snapshot ->> 'serviceId' as "serviceId",
      o.shipping_snapshot ->> 'originPostalCode' as "originPostalCode",
      o.shipping_snapshot -> 'address' ->> 'postalCode' as "postalCode",
      a.buyer_profile as "buyerProfile", a.buyer_document as "buyerDocument", a.buyer_state_registration as "buyerStateRegistration",
      r.fiscal_parameters as "fiscalParameters"
    from private.representative_kit_fulfillment f
    join private.representative_kit_orders o on o.id = f.order_id
    join private.representative_kit_checkout_approvals a on a.actor_id = o.actor_id and a.rule_version_id = o.rule_version_id
    join private.representative_resale_fiscal_rule_versions r on r.id = o.rule_version_id
    where private.representative_kit_fiscal_ready(o)
      and not exists (
        select 1 from jsonb_array_elements(o.grade_lines) item
        where private.bling_kit_source_hash((item ->> 'variantId')::uuid) is distinct from item ->> 'fiscalHash'
      )
      and coalesce(f.shipment_status,'pending') not in ('returned','cancelled','delivered')
      and (f.checked_at is null or f.checked_at < now() - interval '15 minutes')
      and not exists(select 1 from private.bling_order_links b
        where b.invoice_id = f.bling_invoice_id or b.external_order_id = f.bling_sale_id)
    order by f.checked_at nulls first, f.order_id limit 3
  ) due;
$$;

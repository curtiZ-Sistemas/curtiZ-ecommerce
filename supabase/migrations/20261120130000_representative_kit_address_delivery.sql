-- Prepaid own delivery uses the buyer's verified MG address and the approved origin.
alter table private.representative_kit_shipping_checkout_quotes
  alter column estimated_days drop not null,
  add column address_only_delivery boolean not null default false,
  add constraint kit_quote_address_only_delivery check (
    (estimated_days is not null or service_id='entrega_propria_endereco')
    and (not address_only_delivery or (service_id='entrega_propria_endereco'
      and estimated_days is null and own_delivery_route_id is null and collection_route_id is null
      and amount_in_cents=0 and cost_in_cents=0)));

create function private.representative_kit_is_own_delivery(o private.representative_kit_orders)
returns boolean language sql immutable set search_path = '' as $$
  select o.collection_route_id is not null or o.own_delivery_route_id is not null
    or coalesce(o.shipping_snapshot ->> 'provider'='own_delivery',false);
$$;
revoke all on function private.representative_kit_is_own_delivery(private.representative_kit_orders)
  from public,anon,authenticated,service_role;

create or replace function public.quote_representative_kit_own_delivery(
  p_actor uuid,p_selection uuid,p_template text,p_quantity integer,p_address uuid,p_origin text,p_at_receipt boolean
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  route private.representative_kit_collection_routes;
  service_id text;
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
  if p_at_receipt then
    select q.* into route from private.representative_kit_collection_routes q
      where (p_origin is null or q.origin_postal_code=p_origin) and postal between q.destination_from and q.destination_through
        and q.valid_until>expiry and q.closed_at is null
        and 1=(select count(*) from private.representative_kit_collection_routes t
          where (p_origin is null or t.origin_postal_code=p_origin) and postal between t.destination_from and t.destination_through
            and t.valid_until>expiry and t.closed_at is null)
      for share;
    if not found or route.bling_method_ids='{}'::jsonb then return null; end if;
    p_origin := route.origin_postal_code;
    service_id := 'recebimento';
  else
    if p_origin is null then
      select min(a.origin_postal_code) into p_origin
        from private.representative_kit_checkout_approvals a
        where a.actor_id=p_actor and a.revoked_at is null and a.valid_until>expiry
        having count(distinct a.origin_postal_code)=1;
    end if;
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
  update private.representative_kit_shipping_checkout_quotes set address_only_delivery=not p_at_receipt, own_delivery_route_id=route.id, collection_route_id=case when p_at_receipt then route.id end
    where id=(inserted ->> 'id')::uuid;
  return jsonb_build_object('id',inserted -> 'id','shippingInCents',route.delivery_cents,
    'amountInCents',price*p_quantity+route.delivery_cents,'estimatedDays',route.estimated_days,'service',route.name,
    'collectionMethods',(select coalesce(jsonb_agg(m.name order by m.name),'[]'::jsonb)
      from jsonb_object_keys(route.bling_method_ids) m(name) where p_at_receipt));
end;
$$;

create or replace function private.record_representative_kit_own_delivery()
returns trigger language plpgsql set search_path = ''
as $$
declare
  quote private.representative_kit_shipping_checkout_quotes;
  route private.representative_kit_collection_routes;
  delivery public.addresses;
begin
  select * into quote from private.representative_kit_shipping_checkout_quotes where id=new.quote_id;
  if not coalesce(quote.address_only_delivery,false) then
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
  end if;
  select * into strict delivery from public.addresses where id=quote.address_id and user_id=new.actor_id
    and state='MG' and country='BR' and updated_at=quote.address_updated_at;
  new.own_delivery_route_id := route.id;
  new.shipping_snapshot := new.shipping_snapshot || jsonb_build_object(
    'provider','own_delivery','routeId',route.id,'estimatedDays',route.estimated_days,
    'deliveryAddress',jsonb_build_object('name',delivery.recipient_name,'street',delivery.street,
      'number',delivery.number,'complement',delivery.complement,'district',delivery.district,
      'city',delivery.city,'state',delivery.state,'postalCode',quote.postal_code));
  return new;
end;
$$;

create or replace function public.reserve_representative_kit_own_delivery(
  p_actor uuid,p_selection uuid,p_template text,p_quantity integer,p_quote uuid,p_address uuid,p_key uuid,p_origin text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  origin text;
begin
  select q.origin_postal_code into origin from private.representative_kit_shipping_checkout_quotes q
    where q.id=p_quote and q.actor_id=p_actor and (q.address_only_delivery or q.own_delivery_route_id is not null)
      and q.collection_route_id is null;
  if not found or (p_origin is not null and p_origin <> origin)
    then raise exception 'kit_quote_unavailable' using errcode='23514'; end if;
  if p_template is null then
    return public.reserve_representative_kit_order(p_actor,p_selection,p_quantity,p_quote,p_address,p_key,origin);
  end if;
  return public.reserve_representative_kit_grade_order(p_actor,p_selection,p_template,p_quantity,p_quote,p_address,p_key,origin);
end;
$$;

create or replace function public.due_representative_kit_fulfillment()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(due)),'[]'::jsonb) from (
    select f.order_id as "orderId", f.bling_sale_id as "saleId", f.bling_invoice_id as "invoiceId",
      f.shipment_id as "shipmentId", f.shipment_status as "shipmentStatus", o.variant_id as "variantId",
      o.sku, o.product_name as "productName", o.quantity, coalesce(o.paid_at,o.created_at) as "paidAt", o.grade_lines as "gradeLines",
      private.representative_kit_is_own_delivery(o) as "ownDelivery", o.collection_method as "collectionMethod", o.collection_bling_method as "collectionBlingMethod", o.created_at as "createdAt",
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

create or replace function public.confirm_representative_kit_mdfe(p_order uuid,p_key text,p_protocol text,p_evidence text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  o private.representative_kit_orders;
  f private.representative_kit_fulfillment;
  remainder integer;
begin
  if auth.uid() is null or not private.has_permission('orders.update_operational_status') then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  if coalesce(p_key,'') !~ '^31[0-9]{18}58[0-9]{22}$'
    or coalesce(p_protocol,'') !~ '^[0-9]{15}$' or p_protocol=repeat('0',15)
    or length(btrim(coalesce(p_evidence,''))) not between 10 and 200 then return false; end if;
  select sum(substr(p_key,i,1)::integer * (2+(43-i)%8)) % 11 into remainder
    from generate_series(1,43) as digits(i);
  if right(p_key,1)::integer <> (case when remainder<2 then 0 else 11-remainder end) then return false; end if;

  select * into o from private.representative_kit_orders candidate where id=p_order
    and (private.representative_kit_is_own_delivery(candidate)) for update;
  if not found or o.actor_id=auth.uid() or o.state not in ('awaiting_receipt','paid')
    or o.cancellation_requested_at is not null or not private.representative_kit_requires_mdfe(o.shipping_snapshot) then return false; end if;
  select * into f from private.representative_kit_fulfillment where order_id=p_order for update;
  if not found or f.invoice_access_key is null or f.invoice_confirmed_at is null
    or f.invoice_cancellation_confirmed_at is not null
    or substr(p_key,7,14) <> substr(f.invoice_access_key,7,14)
    or not (f.shipment_rank<4 or f.shipment_status='delayed' and o.collection_route_id is null) then return false; end if;

  insert into private.representative_kit_mdfe_checks as prior
    (order_id,access_key,invoice_access_key,protocol,evidence,verified_by)
    values(p_order,p_key,f.invoice_access_key,p_protocol,btrim(p_evidence),auth.uid())
  on conflict (order_id,access_key) do update set
    evidence=excluded.evidence,verified_by=excluded.verified_by,verified_at=excluded.verified_at
    where prior.used_at is null and prior.invoice_access_key=excluded.invoice_access_key and prior.protocol=excluded.protocol;
  if not found then return false; end if;
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
    values(auth.uid(),private.current_app_role(),'representative.kit.mdfe.verified','representative_kit_order',p_order,
      jsonb_build_object('manifestKeySuffix',right(p_key,8)));
  return true;
end;
$$;

create or replace function public.record_representative_kit_tracking(
  p_order uuid, p_shipment text, p_invoice_key text, p_status text, p_tracking text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  o private.representative_kit_orders;
  next_rank integer;
begin
  select * into o from private.representative_kit_orders where id = p_order for update;
  if not found or o.state <> 'paid' or o.stock_state <> 'sold' or not private.representative_kit_payment_allowed(o)
    or private.representative_kit_is_own_delivery(o)
    or p_invoice_key is null then return false; end if;
  next_rank := case p_status when 'pending' then 0 when 'ready' then 1 when 'label_created' then 2
    when 'dispatched' then 4 when 'in_transit' then 5 when 'delayed' then 5 when 'delivered' then 7
    when 'returned' then 8 when 'cancelled' then 8 else null end;
  if next_rank is null then return false; end if;
  update private.representative_kit_fulfillment set shipment_status = p_status, shipment_rank = next_rank,
    tracking_code = coalesce(nullif(p_tracking,''),tracking_code), checked_at = clock_timestamp()
    where order_id = p_order and shipment_id = p_shipment and invoice_access_key = p_invoice_key
      and invoice_confirmed_at > clock_timestamp() - interval '15 minutes'
      and shipment_rank <= next_rank and (shipment_rank < 8 or shipment_status = p_status);
  return found;
end;
$$;

create or replace function public.register_representative_kit_undelivered_return(p_order uuid,p_invoice bigint,p_key text,
  p_restock_quantity integer,p_evidence text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  o private.representative_kit_orders;
  f private.representative_kit_fulfillment;
  r private.representative_kit_returns;
  rule jsonb;
begin
  perform private.require_permission('returns.inspect');
  if p_invoice is null or p_invoice<=0 or coalesce(p_key,'') !~ '^31[0-9]{20}004[0-9]{19}$'
    or p_restock_quantity is null or length(btrim(coalesce(p_evidence,''))) not between 10 and 200 then return false; end if;
  select * into o from private.representative_kit_orders candidate where id=p_order
    and (private.representative_kit_is_own_delivery(candidate)) for update;
  if not found or o.actor_id=auth.uid() then return false; end if;
  select * into r from private.representative_kit_returns where order_id=p_order and return_kind='undelivered' and state<>'rejected';
  if found then return r.bling_invoice_id=p_invoice and r.invoice_key=p_key
    and r.restock_quantity=p_restock_quantity and r.inspection_reference=btrim(p_evidence); end if;
  if o.cancellation_requested_at is not null or o.returned_kit_count<>0 or p_restock_quantity not between 0 and o.quantity
    or exists (select 1 from private.representative_kit_returns where order_id=p_order and state<>'rejected') then return false; end if;
  select * into f from private.representative_kit_fulfillment where order_id=p_order for update;
  if not found or f.shipment_status is distinct from 'delayed' or f.invoice_access_key is null
    or substr(f.invoice_access_key,23,3)<>'003' or f.invoice_xml_sha256 is null
    or f.invoice_cancellation_confirmed_at is not null or f.bling_invoice_id=p_invoice then return false; end if;
  if not coalesce(o.state='paid' and o.stock_state='sold' or
    o.state='awaiting_receipt' and o.stock_state='reserved' and o.quantity=p_restock_quantity
      and not exists (select 1 from private.representative_kit_collection_payments p where p.order_id=o.id
        and (p.confirmed_at is not null or p.point_status is null or p.point_status not in ('failed','expired','canceled'))),false)
    then return false; end if;
  select fiscal_parameters #> '{returnRules,undelivered_return}' into rule
    from private.representative_resale_fiscal_rule_versions where id=o.rule_version_id;
  if not coalesce(rule->>'cfop'='1202' and rule->>'taxCodeKind'='CSOSN'
    and rule->>'taxCode' ~ '^[0-9]{3}$' and length(btrim(rule->>'homologationEvidence'))>=10,false) then return false; end if;

  insert into private.representative_kit_returns(order_id,request_key,return_kind,quantity,reason,state,inspected_by,
    inspection_reference,restock_quantity,bling_invoice_id,document_origin,invoice_key,refund_cents)
  values(o.id,gen_random_uuid(),'undelivered',o.quantity,'Retorno integral de mercadoria não entregue','received',auth.uid(),
    btrim(p_evidence),p_restock_quantity,p_invoice,'own_inflow',p_key,
    case when o.state='paid' then o.unit_price_cents*o.quantity+o.shipping_cents end);
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
    values(auth.uid(),private.current_app_role(),'representative.kit.undelivered.inspected','representative_kit_order',o.id,
      jsonb_build_object('restockQuantity',p_restock_quantity));
  return true;
end;
$$;

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
      'undeliveredReturnRecorded',exists(select 1 from private.representative_kit_returns r
        where r.order_id=o.id and r.return_kind='undelivered' and r.state<>'rejected'),
      'mdfeRequired',private.representative_kit_requires_mdfe(o.shipping_snapshot),
      'mdfeVerified',private.representative_kit_pending_mdfe(o.id,f.invoice_access_key) is not null,
      'shipmentStatus',f.shipment_status,'pointStarted',p.point_key is not null,'pointLinked',p.point_order_id is not null,
      'deliveryAddress',o.shipping_snapshot -> 'deliveryAddress',
      'pointStatus',p.point_status,
      'receiptConfirmed',p.confirmed_at is not null,'cancellationRequested',o.cancellation_requested_at is not null,
      'invoiceCancelled',f.invoice_cancellation_confirmed_at is not null) as summary
    from private.representative_kit_orders o join private.representative_kit_fulfillment f on f.order_id=o.id
    left join private.representative_kit_collection_payments p on p.order_id=o.id
    where private.representative_kit_is_own_delivery(o)
    order by o.created_at desc,o.id limit 50
  ) rows);
end;
$$;

create or replace function public.manage_representative_kit_collection(p_order uuid,p_action text,p_evidence text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  o private.representative_kit_orders;
  f private.representative_kit_fulfillment;
  mdfe_key text;
begin
  if auth.uid() is null or not private.has_permission('orders.update_operational_status') then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  if length(btrim(coalesce(p_evidence,''))) not between 10 and 200 then return null; end if;
  select * into o from private.representative_kit_orders candidate where id=p_order and (private.representative_kit_is_own_delivery(candidate)) for update;
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
    and not exists(select 1 from private.representative_kit_returns r
      where r.order_id=o.id and r.return_kind='undelivered' and r.state<>'rejected')
    and private.representative_kit_fiscal_ready(o) and (f.shipment_rank<4 or f.shipment_status='delayed' and o.collection_route_id is null) and f.invoice_access_key is not null
    and f.invoice_confirmed_at>clock_timestamp()-interval '30 minutes' then
    if private.representative_kit_requires_mdfe(o.shipping_snapshot) then
      mdfe_key := private.representative_kit_pending_mdfe(o.id,f.invoice_access_key);
      if mdfe_key is null then raise exception 'kit_mdfe_required' using errcode='23514'; end if;
      update private.representative_kit_mdfe_checks set used_at=clock_timestamp()
        where order_id=o.id and access_key=mdfe_key;
    end if;
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
    -- Circulated goods require a verified fiscal return before stock or finance can change.
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

create or replace function public.manage_representative_kit_return(p_return uuid,p_action text,p_details jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  r private.representative_kit_returns;
  o private.representative_kit_orders;
  result jsonb;
  pickup_date date;
  evidence text;
  staff_id uuid := auth.uid();
  own_delivery boolean;
begin
  perform private.require_permission(case
    when p_action in ('receive','schedule_pickup','confirm_pickup') then 'returns.inspect'
    when p_action in ('prepare_refund','refund') then 'returns.refund'
    else 'returns.approve' end);
  select order_id into r.order_id from private.representative_kit_returns where id=p_return;
  if not found then return null; end if;
  select * into o from private.representative_kit_orders where id=r.order_id for update;
  select * into r from private.representative_kit_returns where id=p_return for update;
  if not found or staff_id is null or staff_id=o.actor_id then return null; end if;
  own_delivery := private.representative_kit_is_own_delivery(o);

  if p_action='schedule_pickup' then
    if not own_delivery or r.state<>'approved' or r.picked_up_at is not null
      or coalesce(p_details->>'pickupDate','') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' then return null; end if;
    pickup_date := (p_details->>'pickupDate')::date;
    if pickup_date < (statement_timestamp() at time zone 'America/Sao_Paulo')::date then return null; end if;
    update private.representative_kit_returns set pickup_on=pickup_date where id=p_return returning * into r;
  elsif p_action='confirm_pickup' then
    evidence := btrim(coalesce(p_details->>'pickupReference',''));
    if not own_delivery or r.state<>'approved' or r.pickup_on is null
      or length(evidence) not between 10 and 200 then return null; end if;
    if r.picked_up_at is not null then return private.representative_kit_return_summary(r); end if;
    update private.representative_kit_returns set picked_up_at=clock_timestamp(),
      picked_up_by=staff_id,pickup_reference=evidence where id=p_return returning * into r;
  elsif own_delivery and p_action='receive' and r.picked_up_at is null then
    return null;
  elsif p_action='prepare_refund' then
    if r.state<>'verified' or o.collection_method is not distinct from 'cash'
      or r.refund_cents is null or r.invoice_protocol is null or r.invoice_sha256 is null then return null; end if;
    if r.refund_prepared_by is not null then
      return case when r.refund_prepared_by=staff_id then private.representative_kit_return_summary(r) end;
    end if;
    update private.representative_kit_returns set refund_prepared_by=staff_id where id=p_return returning * into r;
  elsif p_action='refund' and o.collection_method is distinct from 'cash' then
    if r.state='refund_pending' and r.refund_confirmed_by=staff_id then return private.representative_kit_return_summary(r); end if;
    if r.refund_prepared_by is null or r.refund_prepared_by=staff_id or r.state<>'verified' then return null; end if;
    result := private.manage_representative_kit_return(p_return,p_action,p_details);
    if result is null then return null; end if;
    update private.representative_kit_returns set refund_confirmed_by=staff_id where id=p_return returning * into r;
  else
    return private.manage_representative_kit_return(p_return,p_action,p_details);
  end if;
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
    values(staff_id,private.current_app_role(),'representative.kit.return.'||p_action,'representative_kit_return',r.id,
      jsonb_build_object('orderId',r.order_id,'pickupOn',r.pickup_on,'refundInCents',r.refund_cents));
  return private.representative_kit_return_summary(r);
end;
$$;

create or replace function public.list_representative_kit_return_work()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_permission('returns.read');
  return (select coalesce(jsonb_agg(pending.summary),'[]'::jsonb) from (
    select private.representative_kit_return_summary(r) || jsonb_build_object('reason',r.reason,'sku',o.sku,
      'productName',o.product_name,'originalInvoiceKey',f.invoice_access_key,'refundInCents',r.refund_cents,
      'invoiceKey',r.invoice_key,'collectionMethod',o.collection_method,
      'ownDelivery',private.representative_kit_is_own_delivery(o),
      'deliveryAddress',o.shipping_snapshot -> 'deliveryAddress',
      'canConfirmRefund',r.refund_prepared_by is not null and r.refund_prepared_by <> auth.uid()) as summary
    from private.representative_kit_returns r join private.representative_kit_orders o on o.id=r.order_id
    join private.representative_kit_fulfillment f on f.order_id=o.id
    order by r.created_at desc, r.id limit 50
  ) pending);
end;
$$;

create or replace function public.list_representative_kit_fiscal_work()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not (private.has_permission('orders.update_operational_status') or private.has_permission('technical.integrations.manage'))
    then raise exception 'permission_denied' using errcode='42501'; end if;
  return (select coalesce(jsonb_agg(work.summary),'[]'::jsonb) from (
    select jsonb_build_object('orderId',o.id,'state',o.state,'sku',o.sku,'quantity',o.quantity,'productName',o.product_name,
      'invoiceId',f.bling_invoice_id,'saleId',f.bling_sale_id,'draftHash',f.invoice_draft_hash,
      'draftApproved',f.reviewed_draft_hash is not null and f.reviewed_draft_hash=f.invoice_draft_hash,
      'invoiceAuthorized',f.invoice_confirmed_at is not null,'shipmentStatus',f.shipment_status,
      'cancellationRequested',o.cancellation_requested_at is not null,'collectionMethod',o.collection_method,
      'ownDelivery',private.representative_kit_is_own_delivery(o)) as summary
    from private.representative_kit_orders o join private.representative_kit_fulfillment f on f.order_id=o.id
    order by o.created_at desc,o.id limit 50
  ) work);
end;
$$;

create or replace function public.read_representative_kit_dispatch(p_order uuid, p_invoice_key text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('shipmentId',f.shipment_id, 'serviceId',o.shipping_snapshot ->> 'serviceId',
    'originPostalCode',o.shipping_snapshot ->> 'originPostalCode',
    'costInCents',o.shipping_snapshot -> 'costInCents', 'packages',o.shipping_snapshot -> 'packages',
    'address',jsonb_build_object('state',a.state,'street',a.street,'number',a.number,'district',a.district,
      'city',a.city,'complement',a.complement,'postalCode',o.shipping_snapshot -> 'address' ->> 'postalCode'),
    'buyerName',buyer.buyer_legal_name, 'buyerDocument',buyer.buyer_document,
    'buyerRegistration',buyer.buyer_state_registration,'phone',p.phone,'email',u.email,
    'sku',o.sku,'name',o.product_name,'quantity',o.quantity,'unitPriceInCents',o.unit_price_cents,
    'variantId',o.variant_id)
  from private.representative_kit_orders o
  join private.representative_kit_fulfillment f on o.id = f.order_id
  join private.representative_kit_checkout_approvals buyer on buyer.actor_id = o.actor_id and buyer.rule_version_id = o.rule_version_id
  join public.addresses a on a.id = o.address_id and a.user_id = o.actor_id
  join public.profiles p on p.id = o.actor_id join auth.users u on u.id = o.actor_id
  where o.id = p_order and f.invoice_access_key = p_invoice_key
    and f.invoice_confirmed_at > now() - interval '5 minutes'
    and o.state = 'paid' and o.stock_state = 'sold' and private.representative_kit_payment_allowed(o)
    and o.cancellation_requested_at is null
    and not private.representative_kit_is_own_delivery(o)
    and not exists (select 1 from private.representative_kit_refund_requests r where r.order_id = o.id);
$$;

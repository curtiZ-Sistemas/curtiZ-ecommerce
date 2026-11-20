-- A cash order offered through the address-only checkout uses the approved
-- cash method and an operational delivery date, recorded before billing.
alter table private.representative_kit_shipping_checkout_quotes
  add column address_cash_bling_method bigint check (
    address_cash_bling_method is null or (address_only_delivery and address_cash_bling_method between 1 and 999999999999999));

alter table private.representative_kit_orders
  add column collection_due_on date check (
    collection_due_on is null or (collection_method is not distinct from 'cash' and collection_route_id is null)),
  drop constraint representative_kit_order_collection_complete,
  add constraint representative_kit_order_collection_complete check (
    (num_nonnulls(collection_route_id,collection_method,collection_bling_method)=0 and collection_point_terminal is null
      or num_nonnulls(collection_route_id,collection_method,collection_bling_method)=3
        and (collection_method='cash' or collection_point_terminal is not null)
      or collection_route_id is null and collection_method is not distinct from 'cash'
        and collection_bling_method is not null and collection_point_terminal is null
        and shipping_snapshot->>'provider' is not distinct from 'own_delivery' and shipping_cents=0)
    and ((collection_method is not distinct from 'cash') = (cash_tendered_cents is not null))
    and (cash_tendered_cents is null or cash_tendered_cents>=unit_price_cents*quantity+shipping_cents)
    and (state<>'awaiting_receipt' or collection_method is not null));

create function private.representative_kit_direct_cash_method(p_actor uuid,p_origin text,p_rule uuid)
returns bigint language sql stable set search_path = '' as $$
  select min(cash->>'blingPaymentMethodId')::bigint
  from private.representative_kit_checkout_approvals a
  join private.representative_resale_fiscal_rule_versions v on v.id=a.rule_version_id
  cross join lateral (select v.fiscal_parameters->'cashAtDelivery' as cash) config
  where a.actor_id=p_actor and a.origin_postal_code=p_origin
    and v.id=p_rule
    and private.representative_kit_commercial_configuration(a.actor_id,v.id)
    and cash->>'blingPaymentMethodId' ~ '^[1-9][0-9]{0,14}$'
    and length(btrim(cash->>'homologationEvidence'))>=10
  having count(distinct cash->>'blingPaymentMethodId')=1;
$$;
revoke all on function private.representative_kit_direct_cash_method(uuid,text,uuid)
  from public,anon,authenticated,service_role;

create function public.schedule_representative_kit_cash_delivery(p_order uuid,p_day date)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  o private.representative_kit_orders;
  f private.representative_kit_fulfillment;
  operator uuid := auth.uid();
begin
  if operator is null or not private.has_permission('orders.update_operational_status') then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  if p_day is null or not isfinite(p_day) or p_day < (statement_timestamp() at time zone 'America/Sao_Paulo')::date then return false; end if;
  select * into o from private.representative_kit_orders where id=p_order for update;
  if not found or o.actor_id=operator or o.state<>'awaiting_receipt' or o.stock_state<>'reserved'
    or o.collection_method is distinct from 'cash' or o.collection_route_id is not null
    or o.cancellation_requested_at is not null then return false; end if;
  select * into f from private.representative_kit_fulfillment where order_id=p_order for update;
  if not found then return false; end if;
  if o.collection_due_on=p_day then return true; end if;
  if f.bling_sale_id is not null or f.bling_invoice_id is not null or coalesce(f.shipment_rank,0)>=4
    or exists(select 1 from private.representative_kit_fulfillment_writes where order_id=o.id) then return false; end if;
  update private.representative_kit_orders set collection_due_on=p_day where id=o.id;
  update private.representative_kit_fulfillment set checked_at=null where order_id=o.id;
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
    values(operator,private.current_app_role(),'representative.kit.collection.scheduled','representative_kit_order',o.id,
      jsonb_build_object('from',o.collection_due_on,'deliveryOn',p_day));
  return true;
end;
$$;
revoke all on function public.schedule_representative_kit_cash_delivery(uuid,date) from public,anon,service_role;
grant execute on function public.schedule_representative_kit_cash_delivery(uuid,date) to authenticated;

create function public.claim_representative_kit_bling_write_for_delivery(
  p_order uuid,p_operation text,p_expected_hash text,p_collection_due_on date
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  current_day date;
begin
  select collection_due_on into current_day from private.representative_kit_orders where id=p_order for update;
  if not found or current_day is distinct from p_collection_due_on then return false; end if;
  return public.claim_representative_kit_bling_write(p_order,p_operation,p_expected_hash);
end;
$$;
revoke all on function public.claim_representative_kit_bling_write_for_delivery(uuid,text,text,date)
  from public,anon,authenticated;
grant execute on function public.claim_representative_kit_bling_write_for_delivery(uuid,text,text,date) to service_role;

create or replace function public.reserve_representative_kit_own_collection(
  p_actor uuid,p_selection uuid,p_template text,p_quantity integer,p_quote uuid,p_address uuid,
  p_key uuid,p_origin text,p_method text,p_cash_tendered bigint
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  q private.representative_kit_shipping_checkout_quotes;
  o private.representative_kit_orders;
  reserved jsonb;
begin
  select * into q from private.representative_kit_shipping_checkout_quotes
    where id=p_quote and actor_id=p_actor
      and (address_cash_bling_method is not null or (own_delivery_route_id is not null and collection_route_id is not null));
  if not found or (p_origin is not null and p_origin<>q.origin_postal_code)
    then raise exception 'kit_quote_unavailable' using errcode='23514'; end if;
  if q.address_cash_bling_method is null then
    return public.reserve_representative_kit_collection_order(p_actor,p_selection,p_template,p_quantity,p_quote,
      p_address,p_key,q.origin_postal_code,p_method,p_cash_tendered);
  end if;
  if p_actor is null or p_key is null or p_method is distinct from 'cash'
    or p_cash_tendered is null or p_cash_tendered not between 1 and 9007199254740991 then
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

  if p_template is null then
    reserved:=private.reserve_representative_kit_order(p_actor,p_selection,p_quantity,p_quote,p_address,p_key,q.origin_postal_code);
  else
    reserved:=private.reserve_representative_kit_grade_order(p_actor,p_selection,p_template,p_quantity,p_quote,p_address,p_key,q.origin_postal_code);
  end if;
  select * into strict o from private.representative_kit_orders where id=(reserved->>'orderId')::uuid for update;
  if q.address_cash_bling_method is distinct from private.representative_kit_direct_cash_method(o.actor_id,q.origin_postal_code,o.rule_version_id)
    then raise exception 'kit_collection_unavailable' using errcode='23514'; end if;
  if p_cash_tendered<o.unit_price_cents*o.quantity+o.shipping_cents then
    raise exception 'kit_cash_tender_invalid' using errcode='23514';
  end if;
  update private.representative_kit_orders set state='awaiting_receipt',
    collection_method='cash',collection_bling_method=q.address_cash_bling_method,cash_tendered_cents=p_cash_tendered
    where id=o.id returning * into o;
  insert into private.representative_kit_fulfillment(order_id) values(o.id) on conflict do nothing;
  return private.representative_kit_order_summary(o);
end;
$$;

create or replace function public.quote_representative_kit_own_delivery(
  p_actor uuid,p_selection uuid,p_template text,p_quantity integer,p_address uuid,p_origin text,p_at_receipt boolean
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  route private.representative_kit_collection_routes;
  service_id text;
  cash_method bigint;
  cash_rule uuid;
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
  if p_origin is null then
    select min(a.origin_postal_code) into p_origin
      from private.representative_kit_checkout_approvals a
      where a.actor_id=p_actor and a.revoked_at is null and a.valid_until>expiry
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
    if not found or route.bling_method_ids='{}'::jsonb then return null; end if;
    p_origin := route.origin_postal_code;
    service_id := 'recebimento';
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
    address_cash_bling_method=cash_method,own_delivery_route_id=route.id,
    collection_route_id=case when p_at_receipt then route.id end
    where id=(inserted ->> 'id')::uuid;
  return jsonb_build_object('id',inserted -> 'id','shippingInCents',route.delivery_cents,
    'amountInCents',price*p_quantity+route.delivery_cents,'estimatedDays',route.estimated_days,'service',route.name,
    'collectionMethods',case when cash_method is not null then '["cash"]'::jsonb else (select coalesce(jsonb_agg(m.name order by m.name),'[]'::jsonb)
      from jsonb_object_keys(route.bling_method_ids) m(name) where p_at_receipt) end);
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
      and q.collection_route_id is null and q.address_cash_bling_method is null;
  if not found or (p_origin is not null and p_origin <> origin)
    then raise exception 'kit_quote_unavailable' using errcode='23514'; end if;
  if p_template is null then
    return public.reserve_representative_kit_order(p_actor,p_selection,p_quantity,p_quote,p_address,p_key,origin);
  end if;
  return public.reserve_representative_kit_grade_order(p_actor,p_selection,p_template,p_quantity,p_quote,p_address,p_key,origin);
end;
$$;

create or replace function public.reserve_representative_kit_order(
  p_actor uuid,p_variant uuid,p_quantity integer,p_quote uuid,p_address uuid,p_key uuid,p_origin_postal_code text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from private.representative_kit_shipping_checkout_quotes
    where id=p_quote and (collection_route_id is not null or address_cash_bling_method is not null))
    or exists(select 1 from private.representative_kit_orders
      where actor_id=p_actor and idempotency_key=p_key and collection_method is not null) then
    raise exception 'kit_collection_selection_required' using errcode='23514';
  end if;
  return private.reserve_representative_kit_order(p_actor,p_variant,p_quantity,p_quote,p_address,p_key,p_origin_postal_code);
end;
$$;

create or replace function public.reserve_representative_kit_grade_order(
  p_actor uuid,p_kit uuid,p_template text,p_quantity integer,p_quote uuid,p_address uuid,p_key uuid,p_origin text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from private.representative_kit_shipping_checkout_quotes
    where id=p_quote and (collection_route_id is not null or address_cash_bling_method is not null))
    or exists(select 1 from private.representative_kit_orders
      where actor_id=p_actor and idempotency_key=p_key and collection_method is not null) then
    raise exception 'kit_collection_selection_required' using errcode='23514';
  end if;
  return private.reserve_representative_kit_grade_order(p_actor,p_kit,p_template,p_quantity,p_quote,p_address,p_key,p_origin);
end;
$$;

create or replace function private.representative_kit_fiscal_ready(o private.representative_kit_orders)
returns boolean language sql stable set search_path = ''
as $$
  select (o.state='paid' and o.stock_state='sold'
      or o.state='awaiting_receipt' and o.stock_state='reserved' and (o.collection_route_id is not null
        or o.collection_method='cash' and o.collection_due_on is not null
          and o.collection_bling_method=private.representative_kit_direct_cash_method(
            o.actor_id,o.shipping_snapshot->>'originPostalCode',o.rule_version_id)
          and (
          o.collection_due_on >= (statement_timestamp() at time zone 'America/Sao_Paulo')::date
          or exists(select 1 from private.representative_kit_fulfillment f where f.order_id=o.id and f.bling_invoice_id is not null)
        )))
    and private.representative_kit_payment_allowed(o);
$$;

create or replace function private.can_cancel_unshipped_kit_collection(o private.representative_kit_orders)
returns boolean language sql stable set search_path = ''
as $$
  select o.state='awaiting_receipt' and o.stock_state='reserved' and o.collection_method is not null
    and not exists (select 1 from private.representative_kit_fulfillment f where f.order_id=o.id
      and (f.bling_sale_id is not null or f.bling_invoice_id is not null or f.shipment_rank>=4))
    and not exists (select 1 from private.representative_kit_fulfillment_writes w where w.order_id=o.id);
$$;

create or replace function public.due_representative_kit_fulfillment()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(due)),'[]'::jsonb) from (
    select f.order_id as "orderId", f.bling_sale_id as "saleId", f.bling_invoice_id as "invoiceId",
      f.shipment_id as "shipmentId", f.shipment_status as "shipmentStatus", o.variant_id as "variantId",
      o.sku, o.product_name as "productName", o.quantity, coalesce(o.paid_at,o.created_at) as "paidAt", o.grade_lines as "gradeLines",
      private.representative_kit_is_own_delivery(o) as "ownDelivery", o.collection_method as "collectionMethod", o.collection_bling_method as "collectionBlingMethod", o.created_at as "createdAt",
      o.shipping_snapshot ->> 'estimatedDays' as "deliveryDays", o.collection_due_on as "collectionDueOn",
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
      'collectionDueOn',o.collection_due_on,
      'canScheduleCash',o.collection_method='cash' and o.collection_route_id is null and private.can_cancel_unshipped_kit_collection(o),
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

create or replace function public.prepare_representative_kit_collection_refund(p_return uuid,p_cash_evidence text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  o private.representative_kit_orders;
  r private.representative_kit_refund_requests;
  receipt private.representative_kit_collection_payments;
  confirmed_total bigint;
  baseline text[];
  refund_reference text;
begin
  perform private.require_permission('returns.refund');
  select order_id into r.order_id from private.representative_kit_refund_requests where kit_return_id=p_return;
  if not found then return null; end if;
  select * into o from private.representative_kit_orders where id=r.order_id and collection_method is not null for update;
  if not found or o.actor_id=auth.uid() or o.state not in ('paid','manual_review','refunded') then return null; end if;
  select * into r from private.representative_kit_refund_requests where kit_return_id=p_return for update;
  select * into receipt from private.representative_kit_collection_payments where order_id=o.id and confirmed_at is not null for share;
  if not found then return null; end if;
  if r.provider_refund_id is not null then return jsonb_build_object('confirmed',true); end if;
  select coalesce(sum(amount_cents),0),coalesce(array_agg(provider_refund_id order by provider_refund_id),'{}') into confirmed_total,baseline
    from private.representative_kit_provider_refunds where order_id=o.id;
  if confirmed_total+r.amount_cents>o.unit_price_cents*o.quantity+o.shipping_cents or r.reason<>'accepted_return' then return null; end if;
  if o.collection_method='cash' then
    if length(btrim(coalesce(p_cash_evidence,''))) not between 10 and 200 then return null; end if;
    refund_reference:='CASH-'||encode(sha256(convert_to(btrim(p_cash_evidence),'UTF8')),'hex');
    update private.representative_kit_refund_requests set started_at=clock_timestamp(),baseline_refund_ids=baseline where id=r.id;
    insert into private.representative_kit_provider_refunds(provider_refund_id,order_id,amount_cents)
      values(refund_reference,o.id,r.amount_cents);
    update private.representative_kit_refund_requests set provider_refund_id=refund_reference,checked_at=clock_timestamp() where id=r.id;
    if confirmed_total+r.amount_cents=o.unit_price_cents*o.quantity+o.shipping_cents then
      update private.representative_kit_orders set state='refunded' where id=o.id;
    end if;
    insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
      values(auth.uid(),private.current_app_role(),'representative.kit.cash_refund.confirmed','representative_kit_order',o.id,
        jsonb_build_object('refundId',r.id,'evidence',btrim(p_cash_evidence)));
    return jsonb_build_object('confirmed',true);
  end if;
  if p_cash_evidence is not null or receipt.point_order_id is null or receipt.point_key is null then return null; end if;
  if r.started_at is null then
    update private.representative_kit_refund_requests set started_at=clock_timestamp(),
      baseline_refund_ids=baseline where id=r.id returning * into r;
  end if;
  if baseline is distinct from r.baseline_refund_ids then return null; end if;
  return jsonb_build_object('confirmed',false,'refundId',r.id,'refundCents',r.amount_cents,'previousRefundIds',baseline,
    'pointOrderId',receipt.point_order_id,'pointKey',receipt.point_key,'receipt',receipt.receipt_reference,
    'method',o.collection_method,'terminal',o.collection_point_terminal,'amountInCents',o.unit_price_cents*o.quantity+o.shipping_cents,
    'maySend',r.started_at>clock_timestamp()-interval '20 hours');
end;
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
    or not (f.shipment_rank<4 or f.shipment_status='delayed' and o.collection_method is null) then return false; end if;

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
    and private.representative_kit_fiscal_ready(o) and (f.shipment_rank<4 or f.shipment_status='delayed' and o.collection_method is null) and f.invoice_access_key is not null
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
  elsif p_action='delivery_failed' and o.state='paid' and o.collection_method is null
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

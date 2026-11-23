-- Payment on receipt by the buyer's verified MG address, without a registered route.
-- Cash is offered for accounts whose approved rule is the MG02 manual-invoice rule.
-- The delivery team also receives the buyer's phone from the profile.

alter table private.representative_kit_shipping_checkout_quotes
  add column address_at_receipt boolean not null default false,
  add constraint kit_quote_address_at_receipt check (
    not address_at_receipt or (address_only_delivery and address_cash_bling_method is null));

-- A cash order by address may exist without a Bling payment method when the
-- manual invoice rule applies; every other shape keeps the previous constraint.
alter table private.representative_kit_orders
  drop constraint representative_kit_order_collection_complete,
  add constraint representative_kit_order_collection_complete check (
    (num_nonnulls(collection_route_id,collection_method,collection_bling_method)=0 and collection_point_terminal is null
      or num_nonnulls(collection_route_id,collection_method,collection_bling_method)=3
        and (collection_method='cash' or collection_point_terminal is not null)
      or collection_route_id is null and collection_method is not distinct from 'cash'
        and collection_point_terminal is null
        and shipping_snapshot->>'provider' is not distinct from 'own_delivery' and shipping_cents=0)
    and ((collection_method is not distinct from 'cash') = (cash_tendered_cents is not null))
    and (cash_tendered_cents is null or cash_tendered_cents>=unit_price_cents*quantity+shipping_cents)
    and (state<>'awaiting_receipt' or collection_method is not null));

create function private.representative_kit_manual_rule(p_actor uuid,p_rule uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1 from private.representative_resale_fiscal_rule_versions r
    join private.representative_kit_checkout_approvals a on a.rule_version_id=r.id and a.actor_id=p_actor
    where r.id=p_rule and a.buyer_profile='MG02'
      and r.fiscal_parameters->'advancePixWithManualInvoice'='true'::jsonb
      and r.fiscal_parameters->'blingRule'->>'series'='3'
      and r.fiscal_parameters->'creditEligible'='false'::jsonb
      and private.representative_kit_commercial_configuration(p_actor,p_rule)
  );
$$;
revoke all on function private.representative_kit_manual_rule(uuid,uuid)
  from public,anon,authenticated,service_role;

create or replace function private.representative_kit_manual_fiscal(o private.representative_kit_orders)
returns boolean language sql stable set search_path = '' as $$
  select (o.collection_method is null
      or o.collection_method='cash' and o.collection_route_id is null and o.collection_bling_method is null)
    and private.representative_kit_is_own_delivery(o)
    and private.representative_kit_manual_rule(o.actor_id,o.rule_version_id);
$$;

create or replace function public.can_start_representative_kit_manual_pix(p_actor uuid,p_order uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from private.representative_kit_orders o where o.id=p_order and o.actor_id=p_actor
    and o.collection_method is null and private.representative_kit_manual_fiscal(o));
$$;

create or replace function private.representative_kit_fiscal_ready(o private.representative_kit_orders)
returns boolean language sql stable set search_path = ''
as $$
  select (o.state='paid' and o.stock_state='sold'
      or o.state='awaiting_receipt' and o.stock_state='reserved' and (o.collection_route_id is not null
        or o.collection_method='cash' and o.collection_due_on is not null
          and (o.collection_bling_method=private.representative_kit_direct_cash_method(
              o.actor_id,o.shipping_snapshot->>'originPostalCode',o.rule_version_id)
            or o.collection_bling_method is null and private.representative_kit_manual_fiscal(o))
          and (
          o.collection_due_on >= (statement_timestamp() at time zone 'America/Sao_Paulo')::date
          or exists(select 1 from private.representative_kit_fulfillment f where f.order_id=o.id and f.bling_invoice_id is not null)
        )))
    and private.representative_kit_payment_allowed(o);
$$;

create or replace function public.submit_representative_kit_manual_invoice(p_order uuid,p_invoice bigint,p_key text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare o private.representative_kit_orders;
begin
  if auth.uid() is null or not private.internal_mfa_satisfied()
    or not (private.has_permission('orders.update_operational_status') or private.has_permission('technical.integrations.manage'))
    then raise exception 'permission_denied' using errcode='42501'; end if;
  if p_invoice is null or p_invoice <= 0 or p_key is null or p_key !~ '^31[0-9]{18}55003[0-9]{19}$'
    then return false; end if;
  select * into o from private.representative_kit_orders where id=p_order for update;
  if not found or o.state not in ('paid','awaiting_receipt') or o.cancellation_requested_at is not null
    or not private.representative_kit_fiscal_ready(o)
    or not private.representative_kit_manual_fiscal(o) then return false; end if;
  update private.representative_kit_fulfillment f set manual_invoice_id=p_invoice,manual_invoice_key=p_key,checked_at=null
    where f.order_id=o.id and f.invoice_access_key is null and f.bling_invoice_id is null
      and not exists(select 1 from private.representative_kit_fulfillment_writes w where w.order_id=o.id
        and w.operation in ('bling_invoice_draft','bling_invoice_send'))
      and not exists(select 1 from private.representative_kit_fulfillment other where other.order_id<>o.id
        and (other.bling_invoice_id=p_invoice or other.manual_invoice_id=p_invoice
          or other.invoice_access_key=p_key or other.manual_invoice_key=p_key))
      and not exists(select 1 from private.bling_order_links b where b.invoice_id=p_invoice or b.invoice_access_key=p_key);
  if not found then return false; end if;
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
    values(auth.uid(),private.current_app_role(),'representative.kit.manual_invoice_submitted',
      'representative_kit_order',p_order,jsonb_build_object('providerInvoiceId',p_invoice));
  return true;
exception when unique_violation then return false;
end;
$$;

create or replace function public.confirm_representative_kit_manual_invoice(
  p_order uuid,p_invoice bigint,p_key text,p_protocol text,p_sha256 text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare o private.representative_kit_orders;
begin
  select * into o from private.representative_kit_orders where id=p_order for update;
  if not found or o.state not in ('paid','awaiting_receipt') or o.cancellation_requested_at is not null
    or not private.representative_kit_fiscal_ready(o)
    or not private.representative_kit_manual_fiscal(o)
    or p_protocol is null or p_protocol !~ '^[0-9]{15}$'
    or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then return false; end if;
  update private.representative_kit_fulfillment f set bling_invoice_id=p_invoice,invoice_access_key=p_key,
    invoice_protocol=p_protocol,invoice_xml_sha256=p_sha256,invoice_confirmed_at=clock_timestamp()
    where f.order_id=o.id and f.manual_invoice_id=p_invoice and f.manual_invoice_key=p_key
      and f.invoice_cancellation_confirmed_at is null
      and (f.bling_invoice_id is null or f.bling_invoice_id=p_invoice)
      and (f.invoice_access_key is null or (f.invoice_access_key=p_key and f.invoice_protocol=p_protocol and f.invoice_xml_sha256=p_sha256))
      and not exists(select 1 from private.representative_kit_fulfillment other where other.order_id<>o.id
        and (other.bling_invoice_id=p_invoice or other.manual_invoice_id=p_invoice
          or other.invoice_access_key=p_key or other.manual_invoice_key=p_key))
      and not exists(select 1 from private.bling_order_links b where b.invoice_id=p_invoice or b.invoice_access_key=p_key);
  return found;
exception when unique_violation then return false;
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
      and (address_cash_bling_method is not null or address_at_receipt
        or (own_delivery_route_id is not null and collection_route_id is not null));
  if not found or (p_origin is not null and p_origin<>q.origin_postal_code)
    then raise exception 'kit_quote_unavailable' using errcode='23514'; end if;
  if q.address_cash_bling_method is null and not q.address_at_receipt then
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
  if q.address_at_receipt then
    if not private.representative_kit_manual_rule(o.actor_id,o.rule_version_id)
      then raise exception 'kit_collection_unavailable' using errcode='23514'; end if;
  elsif q.address_cash_bling_method is distinct from private.representative_kit_direct_cash_method(o.actor_id,q.origin_postal_code,o.rule_version_id)
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

create or replace function public.reserve_representative_kit_own_delivery(
  p_actor uuid,p_selection uuid,p_template text,p_quantity integer,p_quote uuid,p_address uuid,p_key uuid,p_origin text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  origin text;
begin
  select q.origin_postal_code into origin from private.representative_kit_shipping_checkout_quotes q
    where q.id=p_quote and q.actor_id=p_actor and (q.address_only_delivery or q.own_delivery_route_id is not null)
      and q.collection_route_id is null and q.address_cash_bling_method is null and not q.address_at_receipt;
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
    where id=p_quote and (collection_route_id is not null or address_cash_bling_method is not null or address_at_receipt))
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
    where id=p_quote and (collection_route_id is not null or address_cash_bling_method is not null or address_at_receipt))
    or exists(select 1 from private.representative_kit_orders
      where actor_id=p_actor and idempotency_key=p_key and collection_method is not null) then
    raise exception 'kit_collection_selection_required' using errcode='23514';
  end if;
  return private.reserve_representative_kit_grade_order(p_actor,p_kit,p_template,p_quantity,p_quote,p_address,p_key,p_origin);
end;
$$;

-- The order snapshot keeps the buyer's phone from the profile at purchase time.
create or replace function private.record_representative_kit_own_delivery()
returns trigger language plpgsql set search_path = ''
as $$
declare
  quote private.representative_kit_shipping_checkout_quotes;
  route private.representative_kit_collection_routes;
  delivery public.addresses;
  buyer_phone text;
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
  select nullif(btrim(p.phone),'') into buyer_phone from public.profiles p where p.id=new.actor_id;
  new.own_delivery_route_id := route.id;
  new.shipping_snapshot := new.shipping_snapshot || jsonb_build_object(
    'provider','own_delivery','routeId',route.id,'estimatedDays',route.estimated_days,
    'deliveryAddress',jsonb_strip_nulls(jsonb_build_object('name',delivery.recipient_name,'street',delivery.street,
      'number',delivery.number,'complement',delivery.complement,'district',delivery.district,
      'city',delivery.city,'state',delivery.state,'postalCode',quote.postal_code,'phone',buyer_phone)));
  return new;
end;
$$;

-- Only operators with the operational permission read this queue; older orders
-- fall back to the buyer's current profile phone.
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
      'deliveryAddress',case when o.shipping_snapshot -> 'deliveryAddress' is null then null
        else (o.shipping_snapshot -> 'deliveryAddress') || jsonb_strip_nulls(jsonb_build_object('phone',
          coalesce(nullif(btrim(o.shipping_snapshot -> 'deliveryAddress' ->> 'phone'),''),nullif(btrim(buyer.phone),'')))) end,
      'collectionDueOn',o.collection_due_on,
      'canScheduleCash',o.collection_method='cash' and o.collection_route_id is null and private.can_cancel_unshipped_kit_collection(o),
      'pointStatus',p.point_status,
      'receiptConfirmed',p.confirmed_at is not null,'cancellationRequested',o.cancellation_requested_at is not null,
      'invoiceCancelled',f.invoice_cancellation_confirmed_at is not null) as summary
    from private.representative_kit_orders o join private.representative_kit_fulfillment f on f.order_id=o.id
    left join private.representative_kit_collection_payments p on p.order_id=o.id
    left join public.profiles buyer on buyer.id=o.actor_id
    where private.representative_kit_is_own_delivery(o)
    order by o.created_at desc,o.id limit 50
  ) rows);
end;
$$;

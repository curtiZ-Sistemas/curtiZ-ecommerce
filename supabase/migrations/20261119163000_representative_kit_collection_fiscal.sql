create or replace function public.due_representative_kit_fulfillment()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(due)),'[]'::jsonb) from (
    select f.order_id as "orderId", f.bling_sale_id as "saleId", f.bling_invoice_id as "invoiceId",
      f.shipment_id as "shipmentId", f.shipment_status as "shipmentStatus", o.variant_id as "variantId",
      o.sku, o.product_name as "productName", o.quantity, coalesce(o.paid_at,o.created_at) as "paidAt", o.grade_lines as "gradeLines",
      o.collection_method as "collectionMethod", o.collection_bling_method as "collectionBlingMethod", o.created_at as "createdAt",
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

create or replace function public.record_representative_kit_authorized_invoice(
  p_order uuid, p_sale bigint, p_invoice bigint, p_key text, p_protocol text, p_sha256 text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  o private.representative_kit_orders;
begin
  select * into o from private.representative_kit_orders where id = p_order for update;
  if not found or not private.representative_kit_fiscal_ready(o)
    or p_key is null or p_key !~ '^31[0-9]{42}$' or substr(p_key,21,5) <> '55002'
    or p_protocol is null or p_protocol !~ '^[0-9]{15}$'
    or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then return false; end if;
  update private.representative_kit_fulfillment set invoice_access_key = p_key, invoice_protocol = p_protocol,
    invoice_xml_sha256 = p_sha256, invoice_confirmed_at = clock_timestamp()
    where order_id = p_order and bling_sale_id = p_sale and bling_invoice_id = p_invoice
      and (invoice_access_key is null or (invoice_access_key = p_key and invoice_protocol = p_protocol and invoice_xml_sha256 = p_sha256))
      and not exists (select 1 from private.bling_order_links b
        where b.invoice_id = p_invoice or b.external_order_id = p_sale or b.invoice_access_key = p_key);
  return found;
end;
$$;

create or replace function public.read_representative_kit_bling_order(p_order uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('saleId',f.bling_sale_id,'invoiceId',f.bling_invoice_id,
    'buyerName',o.buyer_snapshot -> 'name','buyerDocument',o.buyer_snapshot -> 'document',
    'buyerRegistration',o.buyer_snapshot -> 'registration','fiscalAddress',o.buyer_snapshot -> 'address',
    'reviewedDraftHash',f.reviewed_draft_hash,'draftHash',f.invoice_draft_hash,
    'address',jsonb_build_object('street',d.street,'number',d.number,'district',d.district,'city',d.city,
      'complement',d.complement,'state',d.state,'postal_code',o.shipping_snapshot -> 'address' ->> 'postalCode'))
  from private.representative_kit_orders o
  join private.representative_kit_fulfillment f on f.order_id=o.id
  join public.addresses d on d.id=o.address_id and d.user_id=o.actor_id
  where o.id=p_order and private.representative_kit_fiscal_ready(o)
    and o.cancellation_requested_at is null
    and private.representative_kit_commercial_configuration(o.actor_id,o.rule_version_id)
    and not exists(select 1 from private.representative_kit_refund_requests r where r.order_id=o.id);
$$;

create or replace function public.read_representative_kit_payment(p_actor uuid, p_order uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select private.representative_kit_order_summary(o) ||
    jsonb_build_object('providerPaymentId',o.provider_payment_id,'startedAt',o.payment_started_at,
      'cancellationRequested',o.cancellation_requested_at is not null,
      'customerCanPay',o.state='payment_pending' and private.representative_kit_payment_allowed(o),
      'canCancelPaid',o.cancellation_requested_at is null and private.can_cancel_unshipped_representative_kit(o),
      'canCancelCollection',o.cancellation_requested_at is null and private.can_cancel_unshipped_kit_collection(o))
  from private.representative_kit_orders o where o.id=p_order and o.actor_id=p_actor;
$$;

create or replace function public.request_representative_kit_payment_cancellation(p_actor uuid, p_order uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  o private.representative_kit_orders;
begin
  select * into o from private.representative_kit_orders where actor_id=p_actor and id=p_order for update;
  if not found then return null; end if;
  if o.state='awaiting_receipt' then
    if not private.can_cancel_unshipped_kit_collection(o) then
      raise exception 'kit_requires_cancellation_review' using errcode='23514';
    end if;
    perform private.transfer_representative_kit_inventory(o,o.quantity,'release',null,null,null,null);
    update private.representative_kit_orders set state='cancelled',stock_state='released' where id=o.id;
    update private.representative_kit_fulfillment set shipment_status='cancelled',shipment_rank=8 where order_id=o.id;
    return public.read_representative_kit_payment(p_actor,p_order);
  end if;
  if o.state='paid' and o.cancellation_requested_at is null and not private.can_cancel_unshipped_representative_kit(o) then
    raise exception 'kit_requires_cancellation_review' using errcode='23514';
  end if;
  if o.payment_started_at is null then
    perform public.cancel_unstarted_representative_kit_order(p_actor,p_order);
  elsif o.state in ('reserved','payment_pending','paid') then
    update private.representative_kit_orders set cancellation_requested_at=coalesce(cancellation_requested_at,now()) where id=p_order;
    if o.state = 'paid' then perform private.queue_unshipped_representative_kit_refund(p_order); end if;
  end if;
  return public.read_representative_kit_payment(p_actor,p_order);
end;
$$;

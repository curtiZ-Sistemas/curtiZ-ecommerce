alter table private.representative_kit_checkout_approvals
  add column buyer_state_registration text check (buyer_state_registration ~ '^[0-9]{2,14}$');

-- An operator links the Bling sale and NF-e IDs after the paid order enters
-- fulfillment. Provider readback is the only path to fiscal clearance.
create table private.representative_kit_fulfillment (
  order_id uuid primary key references private.representative_kit_orders(id),
  bling_sale_id bigint not null unique check (bling_sale_id > 0),
  bling_invoice_id bigint not null unique check (bling_invoice_id > 0),
  invoice_access_key text unique check (invoice_access_key ~ '^31[0-9]{42}$'),
  invoice_protocol text unique check (invoice_protocol ~ '^[0-9]{15}$'),
  invoice_xml_sha256 text check (invoice_xml_sha256 ~ '^[0-9a-f]{64}$'),
  invoice_confirmed_at timestamptz,
  shipment_id text unique check (shipment_id ~ '^[A-Za-z0-9-]{1,100}$'),
  shipment_status text check (shipment_status in ('pending','ready','label_created','dispatched','in_transit','delayed','delivered','returned','cancelled')),
  shipment_rank integer not null default 0,
  tracking_code text check (tracking_code ~ '^[A-Za-z0-9-]{1,80}$'),
  checked_at timestamptz,
  check ((invoice_access_key is null and invoice_protocol is null and invoice_xml_sha256 is null)
    or (invoice_access_key is not null and invoice_protocol is not null and invoice_xml_sha256 is not null))
);
create index representative_kit_fulfillment_due on private.representative_kit_fulfillment(checked_at nulls first);
alter table private.representative_kit_fulfillment enable row level security;
alter table private.representative_kit_fulfillment force row level security;
revoke all on private.representative_kit_fulfillment from public, anon, authenticated, service_role;

create function public.due_representative_kit_fulfillment()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(due)),'[]'::jsonb) from (
    select f.order_id as "orderId", f.bling_sale_id as "saleId", f.bling_invoice_id as "invoiceId",
      f.shipment_id as "shipmentId", f.shipment_status as "shipmentStatus", o.variant_id as "variantId",
      o.sku, o.product_name as "productName", o.quantity, o.paid_at as "paidAt",
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
    where o.state = 'paid' and o.stock_state = 'sold' and private.representative_kit_payment_allowed(o)
      and coalesce(f.shipment_status,'pending') not in ('returned','cancelled','delivered')
      and (f.checked_at is null or f.checked_at < now() - interval '15 minutes')
      and not exists(select 1 from private.bling_order_links b
        where b.invoice_id = f.bling_invoice_id or b.external_order_id = f.bling_sale_id)
    order by f.checked_at nulls first, f.order_id limit 3
  ) due;
$$;

create function public.record_representative_kit_authorized_invoice(
  p_order uuid, p_sale bigint, p_invoice bigint, p_key text, p_protocol text, p_sha256 text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  o private.representative_kit_orders;
begin
  select * into o from private.representative_kit_orders where id = p_order for update;
  if not found or o.state <> 'paid' or o.stock_state <> 'sold' or not private.representative_kit_payment_allowed(o)
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

create function public.record_representative_kit_tracking(
  p_order uuid, p_shipment text, p_invoice_key text, p_status text, p_tracking text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  o private.representative_kit_orders;
  next_rank integer;
begin
  select * into o from private.representative_kit_orders where id = p_order for update;
  if not found or o.state <> 'paid' or o.stock_state <> 'sold' or not private.representative_kit_payment_allowed(o)
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

create function public.finish_representative_kit_fulfillment_check(p_order uuid, p_clearance_current boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update private.representative_kit_fulfillment set checked_at = clock_timestamp(),
    invoice_confirmed_at = case when p_clearance_current is true then invoice_confirmed_at else null end
    where order_id = p_order;
  return found;
end;
$$;

create function public.read_representative_kit_tracking(p_actor uuid, p_order uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('status',f.shipment_status,'trackingCode',f.tracking_code)
  from private.representative_kit_orders o join private.representative_kit_fulfillment f on f.order_id = o.id
  where o.id = p_order and o.actor_id = p_actor and f.shipment_status is not null;
$$;

revoke all on function public.due_representative_kit_fulfillment(),
  public.record_representative_kit_authorized_invoice(uuid,bigint,bigint,text,text,text),
  public.record_representative_kit_tracking(uuid,text,text,text,text),
  public.finish_representative_kit_fulfillment_check(uuid,boolean), public.read_representative_kit_tracking(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.due_representative_kit_fulfillment(),
  public.record_representative_kit_authorized_invoice(uuid,bigint,bigint,text,text,text),
  public.record_representative_kit_tracking(uuid,text,text,text,text),
  public.finish_representative_kit_fulfillment_check(uuid,boolean), public.read_representative_kit_tracking(uuid,uuid)
  to service_role;

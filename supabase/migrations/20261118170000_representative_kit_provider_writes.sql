-- Durable one-write claims per external operation. An uncertain provider
-- mutation is recovered by readback or an operator with the original identity.
create table private.representative_kit_fulfillment_writes (
  order_id uuid not null references private.representative_kit_fulfillment(order_id),
  operation text not null check (operation in ('shipment_cart','shipment_purchase','shipment_generate',
    'bling_sale','bling_invoice_draft','bling_invoice_send')),
  started_at timestamptz not null default now(),
  primary key (order_id, operation)
);
alter table private.representative_kit_fulfillment_writes enable row level security;
alter table private.representative_kit_fulfillment_writes force row level security;
revoke all on private.representative_kit_fulfillment_writes from public, anon, authenticated, service_role;

create function public.read_representative_kit_dispatch(p_order uuid, p_invoice_key text)
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
    and not exists (select 1 from private.representative_kit_refund_requests r where r.order_id = o.id);
$$;

create function public.claim_representative_kit_shipping_write(p_order uuid, p_invoice_key text, p_operation text, p_shipment text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  f private.representative_kit_fulfillment;
begin
  perform 1 from private.representative_kit_orders where id = p_order for update;
  if not found then return false; end if;
  select * into f from private.representative_kit_fulfillment where order_id = p_order for update;
  if not found or public.read_representative_kit_dispatch(p_order,p_invoice_key) is null or p_operation is null then return false; end if;
  if not (case p_operation
    when 'shipment_cart' then f.shipment_id is null and p_shipment is null
    when 'shipment_purchase' then f.shipment_id is not null and f.shipment_id = p_shipment and f.shipment_status = 'pending'
    when 'shipment_generate' then f.shipment_id is not null and f.shipment_id = p_shipment and f.shipment_status = 'ready'
    else false end) then return false; end if;
  insert into private.representative_kit_fulfillment_writes(order_id,operation) values (p_order,p_operation)
    on conflict do nothing;
  return found;
end;
$$;

-- Always record the returned carrier identity, even if payment entered manual
-- review while the request was in flight. This preserves recovery without
-- authorizing another mutation or purchasing the label.
create function public.link_representative_kit_shipment(p_order uuid,p_shipment text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_shipment is null or p_shipment !~ '^[A-Za-z0-9-]{1,100}$' then return false; end if;
  update private.representative_kit_fulfillment f
    set shipment_id=p_shipment, shipment_status=coalesce(shipment_status,'pending')
    where f.order_id=p_order and (f.shipment_id is null or f.shipment_id=p_shipment)
      and exists (select 1 from private.representative_kit_fulfillment_writes w
        where w.order_id=f.order_id and w.operation='shipment_cart')
      and not exists (select 1 from public.shipments s where s.provider='melhorenvio' and s.external_id=p_shipment);
  return found;
end;
$$;

revoke all on function public.read_representative_kit_dispatch(uuid,text),
  public.claim_representative_kit_shipping_write(uuid,text,text,text), public.link_representative_kit_shipment(uuid,text)
  from public, anon, authenticated;
grant execute on function public.read_representative_kit_dispatch(uuid,text),
  public.claim_representative_kit_shipping_write(uuid,text,text,text), public.link_representative_kit_shipment(uuid,text)
  to service_role;

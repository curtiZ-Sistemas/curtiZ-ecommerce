create table private.representative_kit_mdfe_checks (
  order_id uuid not null references private.representative_kit_orders(id),
  access_key text not null check (access_key ~ '^31[0-9]{18}58[0-9]{22}$'),
  invoice_access_key text not null check (invoice_access_key ~ '^31[0-9]{42}$'),
  protocol text not null check (protocol ~ '^[0-9]{15}$' and protocol <> repeat('0',15)),
  evidence text not null check (length(btrim(evidence)) between 10 and 200),
  verified_by uuid not null references auth.users(id),
  verified_at timestamptz not null default clock_timestamp(),
  used_at timestamptz,
  primary key (order_id,access_key)
);
alter table private.representative_kit_mdfe_checks enable row level security;
alter table private.representative_kit_mdfe_checks force row level security;
revoke all on private.representative_kit_mdfe_checks from public,anon,authenticated,service_role;

create function private.representative_kit_requires_mdfe(p_shipping jsonb)
returns boolean language sql immutable set search_path = '' as $$
  -- Only exempt a delivery when both CEPs and the delivery municipality
  -- identify the documented Nova Serrana route. Unknown locations require proof.
  -- https://www.novaserrana.mg.gov.br/portal/noticias/0/3/3120/novos-ceps-ja-estao-valendo-em-nova-serrana/novaserrana.mg.gov.br
  select not coalesce(
    (p_shipping ->> 'originPostalCode' between '35520000' and '35528999'
      or p_shipping ->> 'originPostalCode' = '35529000')
    and p_shipping ->> 'originPostalCode' ~ '^[0-9]{8}$'
    and (p_shipping #>> '{address,postalCode}' between '35520000' and '35528999'
      or p_shipping #>> '{address,postalCode}' = '35529000')
    and p_shipping #>> '{address,postalCode}' ~ '^[0-9]{8}$'
    and p_shipping #>> '{deliveryAddress,postalCode}' = p_shipping #>> '{address,postalCode}'
    and p_shipping #>> '{deliveryAddress,state}' = 'MG'
    and lower(btrim(p_shipping #>> '{deliveryAddress,city}')) = 'nova serrana', false);
$$;

create function private.representative_kit_pending_mdfe(p_order uuid,p_invoice_key text)
returns text language sql stable set search_path = '' as $$
  select c.access_key
  from private.representative_kit_mdfe_checks c
  where c.order_id=p_order and c.invoice_access_key=p_invoice_key and c.used_at is null
    and not exists (select 1 from private.representative_kit_mdfe_checks sent
      where sent.order_id=c.order_id and sent.used_at>=c.verified_at)
  order by c.verified_at desc,c.access_key limit 1;
$$;
revoke all on function private.representative_kit_requires_mdfe(jsonb),
  private.representative_kit_pending_mdfe(uuid,text) from public,anon,authenticated,service_role;

create function public.confirm_representative_kit_mdfe(p_order uuid,p_key text,p_protocol text,p_evidence text)
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

  select * into o from private.representative_kit_orders where id=p_order
    and (collection_route_id is not null or own_delivery_route_id is not null) for update;
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
revoke all on function public.confirm_representative_kit_mdfe(uuid,text,text,text) from public,anon,service_role;
grant execute on function public.confirm_representative_kit_mdfe(uuid,text,text,text) to authenticated;

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
      'mdfeRequired',private.representative_kit_requires_mdfe(o.shipping_snapshot),
      'mdfeVerified',private.representative_kit_pending_mdfe(o.id,f.invoice_access_key) is not null,
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

create or replace function public.record_representative_kit_tracking(
  p_order uuid, p_shipment text, p_invoice_key text, p_status text, p_tracking text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  o private.representative_kit_orders;
  next_rank integer;
begin
  select * into o from private.representative_kit_orders where id = p_order for update;
  if not found or o.state <> 'paid' or o.stock_state <> 'sold' or not private.representative_kit_payment_allowed(o)
    or o.own_delivery_route_id is not null or o.collection_route_id is not null
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

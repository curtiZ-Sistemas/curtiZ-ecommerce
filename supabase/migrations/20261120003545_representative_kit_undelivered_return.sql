alter table private.representative_kit_returns
  add column return_kind text not null default 'delivered' check (return_kind in ('delivered','undelivered'));

create function public.register_representative_kit_undelivered_return(p_order uuid,p_invoice bigint,p_key text,
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
  select * into o from private.representative_kit_orders where id=p_order
    and (own_delivery_route_id is not null or collection_route_id is not null) for update;
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
revoke all on function public.register_representative_kit_undelivered_return(uuid,bigint,text,integer,text) from public,anon,service_role;
grant execute on function public.register_representative_kit_undelivered_return(uuid,bigint,text,integer,text) to authenticated;

create or replace function public.record_representative_kit_return_invoice(p_return uuid,p_key text,p_protocol text,p_hash text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  r private.representative_kit_returns;
  o private.representative_kit_orders;
  f private.representative_kit_fulfillment;
begin
  if coalesce(p_protocol,'') !~ '^[0-9]{15}$' or coalesce(p_hash,'') !~ '^[0-9a-f]{64}$' then return false; end if;
  select order_id into r.order_id from private.representative_kit_returns where id=p_return;
  if not found then return false; end if;
  select * into o from private.representative_kit_orders where id=r.order_id for update;
  select * into r from private.representative_kit_returns where id=p_return for update;
  if not found or r.invoice_key is distinct from p_key then return false; end if;
  if r.state<>'received' then return r.invoice_protocol is not distinct from p_protocol
    and r.invoice_sha256 is not distinct from p_hash; end if;

  if r.return_kind='undelivered' then
    select * into f from private.representative_kit_fulfillment where order_id=o.id for update;
    if not found or f.shipment_status is distinct from 'delayed' or f.invoice_cancellation_confirmed_at is not null
      or o.cancellation_requested_at is not null or r.inspected_by is null or r.quantity<>o.quantity then return false; end if;
    if o.state='awaiting_receipt' and o.stock_state='reserved' and r.refund_cents is null and r.restock_quantity=o.quantity
      and not exists (select 1 from private.representative_kit_collection_payments p where p.order_id=o.id
        and (p.confirmed_at is not null or p.point_status is null or p.point_status not in ('failed','expired','canceled'))) then
      perform private.transfer_representative_kit_inventory(o,o.quantity,'release',null,null,null,null);
      update private.representative_kit_orders set state='cancelled',stock_state='released',returned_kit_count=o.quantity where id=o.id;
      r.state:='completed';
    elsif o.state='paid' and o.stock_state='sold' and r.refund_cents is not null then
      r.state:='verified';
    else return false;
    end if;
    update private.representative_kit_fulfillment set shipment_status='returned',shipment_rank=8 where order_id=o.id;
  else
    r.state:='verified';
  end if;
  update private.representative_kit_returns set state=r.state,invoice_protocol=p_protocol,invoice_sha256=p_hash,checked_at=clock_timestamp()
    where id=p_return;
  return found;
end;
$$;

create or replace function public.due_representative_kit_return_invoices()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(due)),'[]'::jsonb) from (
    select r.id as "returnId",r.quantity as "returnQuantity",r.document_origin as "documentOrigin",
      r.bling_invoice_id as "invoiceId",r.invoice_key as "invoiceKey",coalesce(r.refund_cents,o.unit_price_cents*o.quantity+o.shipping_cents) as "fiscalTotalInCents",
      o.quantity as "originalQuantity",o.buyer_snapshot ->> 'document' as "buyerDocument",
      rule.fiscal_parameters ->> 'issuerDocument' as "issuerDocument",
      rule.fiscal_parameters -> 'returnRules' -> case when r.return_kind='undelivered' then 'undelivered_return' else r.document_origin end as "returnRule",
      f.invoice_access_key as "originalKey",f.invoice_xml_sha256 as "originalHash",f.bling_invoice_id as "originalInvoiceId"
    from private.representative_kit_returns r join private.representative_kit_orders o on o.id=r.order_id
    join private.representative_kit_fulfillment f on f.order_id=o.id
    join private.representative_resale_fiscal_rule_versions rule on rule.id=o.rule_version_id
    where r.state='received' and f.invoice_cancellation_confirmed_at is null
      and (r.checked_at is null or r.checked_at<now()-interval '15 minutes')
    order by r.checked_at nulls first,r.id limit 3
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

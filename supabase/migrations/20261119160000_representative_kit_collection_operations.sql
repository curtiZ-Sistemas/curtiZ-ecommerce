alter table private.representative_kit_collection_routes
  add constraint representative_kit_collection_method_ids_present check (coalesce(
    (bling_method_ids ->> 'cash') ~ '^[1-9][0-9]{0,14}$'
    and (bling_method_ids ->> 'pix') ~ '^[1-9][0-9]{0,14}$'
    and (bling_method_ids ->> 'debit_card') ~ '^[1-9][0-9]{0,14}$'
    and (bling_method_ids ->> 'credit_card') ~ '^[1-9][0-9]{0,14}$', false));

create table private.representative_kit_collection_payments (
  order_id uuid primary key references private.representative_kit_orders(id),
  point_key uuid unique,
  point_order_id text unique check (point_order_id ~ '^ORD[A-Za-z0-9]{12,62}$'),
  point_status text check (point_status in ('created','at_terminal','processed','failed','expired','canceled','action_required','refunded')),
  opened_at timestamptz not null default clock_timestamp(),
  opened_by uuid not null references public.profiles(id),
  receipt_reference text check (length(btrim(receipt_reference)) between 10 and 200),
  confirmed_at timestamptz,
  check ((receipt_reference is not null) = (confirmed_at is not null))
);
alter table private.representative_kit_collection_payments enable row level security;
alter table private.representative_kit_collection_payments force row level security;
revoke all on private.representative_kit_collection_payments from public, anon, authenticated, service_role;

create function private.representative_kit_fiscal_ready(o private.representative_kit_orders)
returns boolean language sql stable set search_path = ''
as $$
  select (o.state='paid' and o.stock_state='sold'
      or o.state='awaiting_receipt' and o.stock_state='reserved' and o.collection_route_id is not null)
    and private.representative_kit_payment_allowed(o);
$$;
revoke all on function private.representative_kit_fiscal_ready(private.representative_kit_orders)
  from public, anon, authenticated, service_role;

create function private.can_cancel_unshipped_kit_collection(o private.representative_kit_orders)
returns boolean language sql stable set search_path = ''
as $$
  select o.state='awaiting_receipt' and o.stock_state='reserved' and o.collection_route_id is not null
    and not exists (select 1 from private.representative_kit_fulfillment f where f.order_id=o.id
      and (f.bling_sale_id is not null or f.bling_invoice_id is not null or f.shipment_rank>=4))
    and not exists (select 1 from private.representative_kit_fulfillment_writes w where w.order_id=o.id);
$$;
revoke all on function private.can_cancel_unshipped_kit_collection(private.representative_kit_orders)
  from public, anon, authenticated, service_role;

create function public.list_representative_kit_collection_work()
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
      'pointStatus',p.point_status,
      'receiptConfirmed',p.confirmed_at is not null,'cancellationRequested',o.cancellation_requested_at is not null,
      'invoiceCancelled',f.invoice_cancellation_confirmed_at is not null) as summary
    from private.representative_kit_orders o join private.representative_kit_fulfillment f on f.order_id=o.id
    left join private.representative_kit_collection_payments p on p.order_id=o.id
    where o.collection_route_id is not null
    order by o.created_at desc,o.id limit 50
  ) rows);
end;
$$;
revoke all on function public.list_representative_kit_collection_work() from public, anon;
grant execute on function public.list_representative_kit_collection_work() to authenticated;

create function private.confirm_representative_kit_collection_receipt(
  o private.representative_kit_orders, p_reference text, p_operator uuid
) returns boolean language plpgsql set search_path = ''
as $$
begin
  if o.state='paid' and exists (select 1 from private.representative_kit_collection_payments p
    where p.order_id=o.id and p.receipt_reference=p_reference and p.confirmed_at is not null) then return true; end if;
  if o.state<>'awaiting_receipt' or o.stock_state<>'reserved' or o.cancellation_requested_at is not null
    or not exists (select 1 from private.representative_kit_fulfillment f
      where f.order_id=o.id and f.shipment_status='dispatched' and f.invoice_access_key is not null
        and f.invoice_cancellation_confirmed_at is null) then return false; end if;

  perform private.transfer_representative_kit_inventory(o,o.quantity,'sell',
    'Pagamento no recebimento de kit de revenda MG','representative_kit_order',o.id,p_operator);
  update private.representative_kit_collection_payments set receipt_reference=p_reference,confirmed_at=clock_timestamp()
    where order_id=o.id and confirmed_at is null;
  if not found then raise exception 'kit_collection_receipt_unavailable' using errcode='23514'; end if;
  update private.representative_kit_orders set state='paid',stock_state='sold',paid_at=clock_timestamp() where id=o.id;
  update private.representative_kit_fulfillment set shipment_status='delivered',shipment_rank=7 where order_id=o.id;
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
    values(p_operator,private.current_app_role(),'representative.kit.collection.confirmed','representative_kit_order',o.id,
      jsonb_build_object('method',o.collection_method,'amountInCents',o.unit_price_cents*o.quantity+o.shipping_cents));
  return true;
end;
$$;
revoke all on function private.confirm_representative_kit_collection_receipt(private.representative_kit_orders,text,uuid)
  from public, anon, authenticated, service_role;

create function public.manage_representative_kit_collection(p_order uuid,p_action text,p_evidence text)
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
  select * into o from private.representative_kit_orders where id=p_order and collection_route_id is not null for update;
  if not found or o.actor_id=auth.uid() then return null; end if;
  select * into f from private.representative_kit_fulfillment where order_id=p_order for update;
  if not found then return null; end if;
  if p_action='cash_received' and o.collection_method='cash' and (
    o.state='paid' or o.state='awaiting_receipt' and f.shipment_status='dispatched' and o.cancellation_requested_at is null
  ) then
    insert into private.representative_kit_collection_payments(order_id,opened_by) values(o.id,auth.uid()) on conflict do nothing;
    if not private.confirm_representative_kit_collection_receipt(o,btrim(p_evidence),auth.uid()) then return null; end if;
  elsif p_action='dispatch' and o.state='awaiting_receipt' and o.cancellation_requested_at is null
    and private.representative_kit_fiscal_ready(o) and f.shipment_rank<4 and f.invoice_access_key is not null
    and f.invoice_confirmed_at>clock_timestamp()-interval '30 minutes' then
    update private.representative_kit_fulfillment set shipment_status='dispatched',shipment_rank=4 where order_id=o.id;
  elsif p_action='cancel_before_dispatch' and o.state='awaiting_receipt' and o.cancellation_requested_at is null
    and f.shipment_rank<4 and f.bling_invoice_id is not null then
    update private.representative_kit_orders set cancellation_requested_at=clock_timestamp() where id=o.id;
    update private.representative_kit_fulfillment set shipment_status='delayed',shipment_rank=5,checked_at=null where order_id=o.id;
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

create function public.open_representative_kit_point(p_order uuid,p_begin boolean)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  o private.representative_kit_orders;
  payment private.representative_kit_collection_payments;
begin
  if auth.uid() is null or not private.has_permission('orders.update_operational_status') then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  select * into o from private.representative_kit_orders where id=p_order and collection_method in ('pix','debit_card','credit_card') for update;
  if not found or o.actor_id=auth.uid() or o.cancellation_requested_at is not null or o.state not in ('awaiting_receipt','paid')
    or not exists (select 1 from private.representative_kit_fulfillment f where f.order_id=o.id
      and f.shipment_status in ('dispatched','delivered') and f.invoice_access_key is not null
      and f.invoice_cancellation_confirmed_at is null) then return null; end if;
  if p_begin then
    insert into private.representative_kit_collection_payments(order_id,point_key,opened_by)
      values(o.id,gen_random_uuid(),auth.uid()) on conflict(order_id) do nothing;
  end if;
  select * into payment from private.representative_kit_collection_payments where order_id=o.id for update;
  if not found then return null; end if;
  if p_begin and payment.point_status in ('failed','expired','canceled') and payment.confirmed_at is null then
    insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
      values(auth.uid(),private.current_app_role(),'representative.kit.point.retry','representative_kit_order',o.id,
        jsonb_build_object('previousPointOrder',payment.point_order_id,'previousPointStatus',payment.point_status));
    update private.representative_kit_collection_payments set point_key=gen_random_uuid(),
      point_order_id=null,point_status=null,opened_by=auth.uid(),opened_at=clock_timestamp()
      where order_id=o.id returning * into payment;
  end if;
  if payment.point_order_id is null and payment.opened_at<=clock_timestamp()-interval '20 hours' then return null; end if;
  return jsonb_build_object('pointOrderId',payment.point_order_id,'pointKey',payment.point_key,
    'method',o.collection_method,'terminal',o.collection_point_terminal,'amountInCents',o.unit_price_cents*o.quantity+o.shipping_cents,
    'confirmed',payment.confirmed_at is not null);
end;
$$;
revoke all on function public.open_representative_kit_point(uuid,boolean) from public, anon;
grant execute on function public.open_representative_kit_point(uuid,boolean) to authenticated;

create function public.record_representative_kit_point(
  p_order uuid,p_key uuid,p_point_order text,p_status text,p_receipt text
) returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  o private.representative_kit_orders;
  payment private.representative_kit_collection_payments;
begin
  select * into o from private.representative_kit_orders where id=p_order for update;
  if not found or o.collection_method not in ('pix','debit_card','credit_card')
    or p_status is null or ((p_status='processed')<>(p_receipt is not null)) then return false; end if;
  update private.representative_kit_collection_payments set point_order_id=p_point_order,point_status=p_status
    where order_id=p_order and point_key=p_key and (point_order_id is null or point_order_id=p_point_order)
      and (point_status is null or point_status not in ('processed','failed','expired','canceled','refunded')
        or point_status=p_status or (point_status='processed' and p_status='refunded'))
    returning * into payment;
  if not found then return false; end if;
  if p_receipt is null then return true; end if;
  return private.confirm_representative_kit_collection_receipt(o,p_receipt,payment.opened_by);
end;
$$;
revoke all on function public.record_representative_kit_point(uuid,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.record_representative_kit_point(uuid,uuid,text,text,text) to service_role;

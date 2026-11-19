alter table private.representative_kit_returns
  add column pickup_on date,
  add column picked_up_at timestamptz,
  add column picked_up_by uuid references public.profiles(id),
  add column pickup_reference text,
  add column refund_prepared_by uuid references public.profiles(id),
  add column refund_confirmed_by uuid references public.profiles(id),
  add constraint kit_return_pickup_record check (
    num_nonnulls(picked_up_at,picked_up_by,pickup_reference) in (0,3)
    and (picked_up_at is null or pickup_on is not null)
  ),
  add constraint kit_return_refund_reviewers check (
    refund_confirmed_by is null or (refund_prepared_by is not null and refund_confirmed_by <> refund_prepared_by)
  );

create or replace function private.representative_kit_return_summary(r private.representative_kit_returns)
returns jsonb language sql stable set search_path = ''
as $$
  select jsonb_build_object('id',r.id,'orderId',r.order_id,'quantity',r.quantity,'state',r.state,
    'instructions',r.instructions,'createdAt',r.created_at,'pickupOn',r.pickup_on,
    'pickedUp',r.picked_up_at is not null,'refundPrepared',r.refund_prepared_by is not null);
$$;

alter function public.manage_representative_kit_return(uuid,text,jsonb) set schema private;
revoke all on function private.manage_representative_kit_return(uuid,text,jsonb) from public,anon,authenticated,service_role;

create function public.manage_representative_kit_return(p_return uuid,p_action text,p_details jsonb)
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
  own_delivery := o.own_delivery_route_id is not null or o.collection_route_id is not null;

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
revoke all on function public.manage_representative_kit_return(uuid,text,jsonb) from public,anon,service_role;
grant execute on function public.manage_representative_kit_return(uuid,text,jsonb) to authenticated;

create or replace function public.list_representative_kit_return_work()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_permission('returns.read');
  return (select coalesce(jsonb_agg(pending.summary),'[]'::jsonb) from (
    select private.representative_kit_return_summary(r) || jsonb_build_object('reason',r.reason,'sku',o.sku,
      'productName',o.product_name,'originalInvoiceKey',f.invoice_access_key,'refundInCents',r.refund_cents,
      'invoiceKey',r.invoice_key,'collectionMethod',o.collection_method,
      'ownDelivery',o.own_delivery_route_id is not null or o.collection_route_id is not null,
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
      'ownDelivery',o.own_delivery_route_id is not null or o.collection_route_id is not null) as summary
    from private.representative_kit_orders o join private.representative_kit_fulfillment f on f.order_id=o.id
    order by o.created_at desc,o.id limit 50
  ) work);
end;
$$;

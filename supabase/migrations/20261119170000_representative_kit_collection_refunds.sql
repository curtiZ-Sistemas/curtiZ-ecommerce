create function public.prepare_representative_kit_collection_refund(p_return uuid,p_cash_evidence text default null)
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
  select * into o from private.representative_kit_orders where id=r.order_id and collection_route_id is not null for update;
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
revoke all on function public.prepare_representative_kit_collection_refund(uuid,text) from public,anon;
grant execute on function public.prepare_representative_kit_collection_refund(uuid,text) to authenticated;

create function public.record_representative_kit_collection_refund(p_refund uuid,p_provider_refund text)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  o private.representative_kit_orders;
  r private.representative_kit_refund_requests;
  prior bigint;
begin
  if p_provider_refund is null or p_provider_refund !~ '^REF[A-Za-z0-9]{12,62}$' then return false; end if;
  select order_id into r.order_id from private.representative_kit_refund_requests where id=p_refund;
  if not found then return false; end if;
  select * into o from private.representative_kit_orders where id=r.order_id
    and collection_method in ('pix','credit_card','debit_card') for update;
  if not found then return false; end if;
  select * into r from private.representative_kit_refund_requests where id=p_refund for update;
  if r.provider_refund_id is not null then return r.provider_refund_id=p_provider_refund; end if;
  if r.started_at is null or r.reason<>'accepted_return' then return false; end if;
  select coalesce(sum(amount_cents),0) into prior from private.representative_kit_provider_refunds where order_id=o.id;
  if prior+r.amount_cents>o.unit_price_cents*o.quantity+o.shipping_cents then return false; end if;
  insert into private.representative_kit_provider_refunds(provider_refund_id,order_id,amount_cents)
    values(p_provider_refund,o.id,r.amount_cents);
  update private.representative_kit_refund_requests set provider_refund_id=p_provider_refund,
    checked_at=clock_timestamp() where id=r.id;
  if prior+r.amount_cents=o.unit_price_cents*o.quantity+o.shipping_cents then
    update private.representative_kit_orders set state='refunded' where id=o.id;
  end if;
  return true;
end;
$$;
revoke all on function public.record_representative_kit_collection_refund(uuid,text) from public,anon,authenticated;
grant execute on function public.record_representative_kit_collection_refund(uuid,text) to service_role;

create or replace function public.list_representative_kit_return_work()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_permission('returns.read');
  return (select coalesce(jsonb_agg(pending.summary),'[]'::jsonb) from (
    select private.representative_kit_return_summary(r) || jsonb_build_object('reason',r.reason,'sku',o.sku,
      'productName',o.product_name,'originalInvoiceKey',f.invoice_access_key,'refundInCents',r.refund_cents,
      'invoiceKey',r.invoice_key,'collectionMethod',o.collection_method) as summary
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
      'cancellationRequested',o.cancellation_requested_at is not null,'collectionMethod',o.collection_method) as summary
    from private.representative_kit_orders o join private.representative_kit_fulfillment f on f.order_id=o.id
    order by o.created_at desc,o.id limit 50
  ) work);
end;
$$;

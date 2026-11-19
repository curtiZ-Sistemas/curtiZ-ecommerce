create function public.list_representative_kit_fiscal_work()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not (private.has_permission('orders.update_operational_status') or private.has_permission('technical.integrations.manage'))
    then raise exception 'permission_denied' using errcode='42501'; end if;
  return (select coalesce(jsonb_agg(work.summary),'[]'::jsonb) from (
    select jsonb_build_object('orderId',o.id,'state',o.state,'sku',o.sku,'quantity',o.quantity,'productName',o.product_name,
      'invoiceId',f.bling_invoice_id,'saleId',f.bling_sale_id,'draftHash',f.invoice_draft_hash,
      'draftApproved',f.reviewed_draft_hash is not null and f.reviewed_draft_hash=f.invoice_draft_hash,
      'invoiceAuthorized',f.invoice_confirmed_at is not null,'shipmentStatus',f.shipment_status,
      'cancellationRequested',o.cancellation_requested_at is not null) as summary
    from private.representative_kit_orders o join private.representative_kit_fulfillment f on f.order_id=o.id
    order by o.created_at desc,o.id limit 50
  ) work);
end;
$$;

create function public.approve_representative_kit_bling_draft(p_order uuid,p_hash text,p_evidence text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not (private.has_permission('orders.update_operational_status') or private.has_permission('technical.integrations.manage'))
    then raise exception 'permission_denied' using errcode='42501'; end if;
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$'
    or length(btrim(coalesce(p_evidence,''))) not between 10 and 200 then return false; end if;
  perform 1 from private.representative_kit_orders where id=p_order for update;
  if not found or public.read_representative_kit_bling_order(p_order) is null then return false; end if;
  update private.representative_kit_fulfillment set reviewed_draft_hash=p_hash,reviewed_draft_evidence=btrim(p_evidence),checked_at=null
    where order_id=p_order and bling_invoice_id is not null and invoice_access_key is null and invoice_draft_hash=p_hash
      and not exists(select 1 from private.representative_kit_fulfillment_writes w
        where w.order_id=p_order and w.operation='bling_invoice_send');
  if not found then return false; end if;
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
    values(auth.uid(),private.current_app_role(),'integration.bling.kit_draft_approved','representative_kit_order',p_order,
      jsonb_build_object('draftHash',p_hash));
  return true;
end;
$$;

revoke all on function public.list_representative_kit_fiscal_work(),public.approve_representative_kit_bling_draft(uuid,text,text)
  from public,anon,service_role;
grant execute on function public.list_representative_kit_fiscal_work(),public.approve_representative_kit_bling_draft(uuid,text,text)
  to authenticated;

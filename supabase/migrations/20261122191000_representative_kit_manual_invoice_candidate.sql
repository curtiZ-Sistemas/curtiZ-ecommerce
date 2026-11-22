alter table private.representative_kit_fulfillment
  add column manual_invoice_id bigint unique check (manual_invoice_id > 0),
  add column manual_invoice_key text unique check (manual_invoice_key ~ '^31[0-9]{18}55003[0-9]{19}$'),
  add constraint representative_kit_manual_invoice_identity
    check ((manual_invoice_id is null) = (manual_invoice_key is null));

create function private.representative_kit_manual_fiscal(o private.representative_kit_orders)
returns boolean language sql stable set search_path = '' as $$
  select o.collection_method is null and private.representative_kit_is_own_delivery(o) and exists (
    select 1 from private.representative_resale_fiscal_rule_versions r
    join private.representative_kit_checkout_approvals a on a.rule_version_id=r.id and a.actor_id=o.actor_id
    where r.id=o.rule_version_id and a.buyer_profile='MG02'
      and r.fiscal_parameters->'advancePixWithManualInvoice'='true'::jsonb
      and r.fiscal_parameters->'blingRule'->>'series'='3'
      and r.fiscal_parameters->'creditEligible'='false'::jsonb
  );
$$;
revoke all on function private.representative_kit_manual_fiscal(private.representative_kit_orders)
  from public,anon,authenticated,service_role;

create function public.reserve_representative_kit_manual_pix(
  p_actor uuid,p_selection uuid,p_template text,p_quantity integer,p_quote uuid,p_address uuid,p_key uuid,p_origin text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare order_summary jsonb;
begin
  order_summary := public.reserve_representative_kit_own_delivery(
    p_actor,p_selection,p_template,p_quantity,p_quote,p_address,p_key,p_origin);
  if not exists(select 1 from private.representative_kit_orders o where o.id=(order_summary->>'orderId')::uuid
    and o.actor_id=p_actor and private.representative_kit_manual_fiscal(o))
    then raise exception 'kit_manual_pix_not_approved' using errcode='23514'; end if;
  return order_summary;
end;
$$;

create function public.can_start_representative_kit_manual_pix(p_actor uuid,p_order uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from private.representative_kit_orders o where o.id=p_order and o.actor_id=p_actor
    and private.representative_kit_manual_fiscal(o));
$$;

revoke all on function public.reserve_representative_kit_manual_pix(uuid,uuid,text,integer,uuid,uuid,uuid,text),
  public.can_start_representative_kit_manual_pix(uuid,uuid) from public,anon,authenticated;
grant execute on function public.reserve_representative_kit_manual_pix(uuid,uuid,text,integer,uuid,uuid,uuid,text),
  public.can_start_representative_kit_manual_pix(uuid,uuid) to service_role;

create or replace function private.can_cancel_unshipped_representative_kit(o private.representative_kit_orders)
returns boolean language sql stable set search_path = '' as $$
  select o.state='paid' and o.stock_state='sold'
    and not exists(select 1 from private.representative_kit_fulfillment f where f.order_id=o.id
      and (f.bling_sale_id is not null or f.bling_invoice_id is not null or f.manual_invoice_id is not null or f.shipment_id is not null))
    and not exists(select 1 from private.representative_kit_fulfillment_writes w where w.order_id=o.id)
    and not exists(select 1 from private.representative_kit_refund_requests r where r.order_id=o.id)
    and not exists(select 1 from private.representative_kit_provider_refunds r where r.order_id=o.id);
$$;

create function public.submit_representative_kit_manual_invoice(p_order uuid,p_invoice bigint,p_key text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare o private.representative_kit_orders;
begin
  if auth.uid() is null or not private.internal_mfa_satisfied()
    or not (private.has_permission('orders.update_operational_status') or private.has_permission('technical.integrations.manage'))
    then raise exception 'permission_denied' using errcode='42501'; end if;
  if p_invoice is null or p_invoice <= 0 or p_key is null or p_key !~ '^31[0-9]{18}55003[0-9]{19}$'
    then return false; end if;
  select * into o from private.representative_kit_orders where id=p_order for update;
  if not found or o.state <> 'paid' or o.cancellation_requested_at is not null
    or not private.representative_kit_fiscal_ready(o)
    or not private.representative_kit_manual_fiscal(o) then return false; end if;
  update private.representative_kit_fulfillment f set manual_invoice_id=p_invoice,manual_invoice_key=p_key,checked_at=null
    where f.order_id=o.id and f.invoice_access_key is null and f.bling_invoice_id is null
      and not exists(select 1 from private.representative_kit_fulfillment_writes w where w.order_id=o.id
        and w.operation in ('bling_invoice_draft','bling_invoice_send'))
      and not exists(select 1 from private.bling_order_links b where b.invoice_id=p_invoice or b.invoice_access_key=p_key);
  if not found then return false; end if;
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
    values(auth.uid(),private.current_app_role(),'representative.kit.manual_invoice_submitted',
      'representative_kit_order',p_order,jsonb_build_object('providerInvoiceId',p_invoice));
  return true;
exception when unique_violation then return false;
end;
$$;
revoke all on function public.submit_representative_kit_manual_invoice(uuid,bigint,text) from public,anon,service_role;
grant execute on function public.submit_representative_kit_manual_invoice(uuid,bigint,text) to authenticated;

create function public.read_representative_kit_manual_invoice(p_order uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('manual',private.representative_kit_manual_fiscal(o),'invoiceId',f.manual_invoice_id,'key',f.manual_invoice_key)
  from private.representative_kit_orders o join private.representative_kit_fulfillment f on f.order_id=o.id
  where o.id=p_order;
$$;

-- Only the worker calls this after obtaining the authorized XML from Bling and
-- matching the fiscal document to the paid order.
create function public.confirm_representative_kit_manual_invoice(
  p_order uuid,p_invoice bigint,p_key text,p_protocol text,p_sha256 text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare o private.representative_kit_orders;
begin
  select * into o from private.representative_kit_orders where id=p_order for update;
  if not found or o.state <> 'paid' or o.cancellation_requested_at is not null
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
      and not exists(select 1 from private.bling_order_links b where b.invoice_id=p_invoice or b.invoice_access_key=p_key);
  return found;
exception when unique_violation then return false;
end;
$$;
revoke all on function public.read_representative_kit_manual_invoice(uuid),
  public.confirm_representative_kit_manual_invoice(uuid,bigint,text,text,text) from public,anon,authenticated;
grant execute on function public.read_representative_kit_manual_invoice(uuid),
  public.confirm_representative_kit_manual_invoice(uuid,bigint,text,text,text) to service_role;

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
      'ownDelivery',private.representative_kit_is_own_delivery(o),'manualFiscal',private.representative_kit_manual_fiscal(o),
      'manualInvoiceId',f.manual_invoice_id) as summary
    from private.representative_kit_orders o join private.representative_kit_fulfillment f on f.order_id=o.id
    order by o.created_at desc,o.id limit 50
  ) work);
end;
$$;

create or replace function public.read_representative_kit_tracking(p_actor uuid,p_order uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('status',f.shipment_status,'trackingCode',f.tracking_code) ||
    case when o.state='paid' and private.representative_kit_manual_fiscal(o) and f.invoice_confirmed_at is null
      then jsonb_build_object('fiscalStatus','awaiting_fiscal_issuance') else '{}'::jsonb end
  from private.representative_kit_orders o join private.representative_kit_fulfillment f on f.order_id=o.id
  where o.id=p_order and o.actor_id=p_actor and (f.shipment_status is not null
    or (o.state='paid' and private.representative_kit_manual_fiscal(o) and f.invoice_confirmed_at is null));
$$;

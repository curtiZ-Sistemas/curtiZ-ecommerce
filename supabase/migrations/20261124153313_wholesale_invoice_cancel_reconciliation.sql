-- Cancellation is a separately locked, recoverable operation. Never release stock before
-- the integration confirms removal of the exact untransmitted draft and sale.
alter table private.wholesale_kit_invoices add column cancel_requested_at timestamptz;
alter table private.wholesale_kit_invoices add column cancel_reconciled_at timestamptz;

create or replace function private.wholesale_kit_invoice_summary(i private.wholesale_kit_invoices)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', i.id, 'status', i.status,
    'stage', case
      when i.status = 'authorized' then 'authorized'
      when exists (select 1 from private.wholesale_kit_invoice_writes w
        where w.invoice_id = i.id and w.operation = 'bling_invoice_send') then 'sent'
      when i.bling_invoice_id is not null then 'draft_in_bling'
      when i.bling_sale_id is not null then 'sale_created'
      else 'pending' end,
    'kitId', i.kit_id, 'kitName', i.grade_snapshot ->> 'kitName', 'template', i.template,
    'templateLabel', case when i.grade_snapshot ? 'selections' then (select string_agg(distinct t.label, ', ' order by t.label) from jsonb_array_elements(i.grade_snapshot->'selections') s join private.representative_kit_grade_templates() t on t.code=s->>'template') else (select t.label from private.representative_kit_grade_templates() t where t.code=i.template limit 1) end,
    'quantity', case when i.grade_snapshot ? 'selections' then (select sum((s->>'quantity')::integer) from jsonb_array_elements(i.grade_snapshot->'selections') s) else i.quantity end, 'unitPriceInCents', i.unit_price_cents, 'totalInCents', i.total_cents,
    'paymentMethod', i.payment_method,
    'buyerName', i.buyer_snapshot ->> 'name', 'buyerDocument', i.buyer_snapshot ->> 'document',
    'invoiceId', i.bling_invoice_id, 'invoiceNumber', i.invoice_number, 'invoiceKey', i.invoice_access_key,
    'authorized', i.status = 'authorized', 'errorCode', i.error_code, 'attempts', i.attempts,
    'cancelPending', i.cancel_requested_at is not null and i.cancel_reconciled_at is null,
    'canCancel', i.cancel_reconciled_at is null
      and (i.status in ('draft','error') or (i.status='cancelled' and (i.bling_sale_id is not null or exists
        (select 1 from private.wholesale_kit_invoice_writes w where w.invoice_id=i.id))))
      and not exists (select 1 from private.wholesale_kit_invoice_writes w where w.invoice_id=i.id and w.operation='bling_invoice_send'),
    'createdAt', i.created_at);
$$;

create or replace function private.wholesale_kit_invoice_job(i private.wholesale_kit_invoices)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'wholesaleId', i.id, 'status', i.status, 'attempts', i.attempts,
    'saleId', i.bling_sale_id, 'invoiceId', i.bling_invoice_id, 'draftHash', i.draft_hash,
    'saleClaimed', exists(select 1 from private.wholesale_kit_invoice_writes w where w.invoice_id=i.id and w.operation='bling_sale'),
    'draftClaimed', exists(select 1 from private.wholesale_kit_invoice_writes w where w.invoice_id=i.id and w.operation='bling_invoice_draft'),
    'sendClaimed', exists(select 1 from private.wholesale_kit_invoice_writes w where w.invoice_id=i.id and w.operation='bling_invoice_send'),
    'draftClaimedAt', (select claimed_at from private.wholesale_kit_invoice_writes w where w.invoice_id=i.id and w.operation='bling_invoice_draft'),
    'sku', i.grade_snapshot -> 'lines' -> 0 ->> 'sku', 'productName', i.grade_snapshot ->> 'kitName',
    'quantity', i.quantity, 'gradeLines', i.grade_snapshot -> 'lines', 'gradeSelections', i.grade_snapshot -> 'selections',
    'unitPriceInCents', i.unit_price_cents, 'shippingInCents', 0, 'amountInCents', i.total_cents,
    'paymentMethod', i.payment_method, 'createdAt', i.created_at,
    'originPostalCode', '35524168', 'postalCode', i.buyer_snapshot -> 'address' ->> 'postal_code',
    'buyerProfile', 'MG02', 'buyerName', i.buyer_snapshot ->> 'name', 'buyerDocument', i.buyer_snapshot ->> 'document',
    'buyerStateRegistration', coalesce(i.buyer_snapshot ->> 'registration', ''),
    'fiscalAddress', i.buyer_snapshot -> 'address',
    'fiscalParameters', r.fiscal_parameters,
    'fiscalCurrent', not exists (
      select 1 from jsonb_array_elements(i.grade_snapshot -> 'lines') line
      where private.bling_kit_source_hash((line ->> 'variantId')::uuid) is distinct from line ->> 'fiscalHash')
  )
  from private.representative_resale_fiscal_rule_versions r where r.id = i.rule_version_id;
$$;

create or replace function public.request_wholesale_kit_invoice_retry(p_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_wholesale_invoice_access();
  update private.wholesale_kit_invoices set status = 'draft', error_code = null, updated_at = now()
    where id = p_id and (status in ('draft', 'error') or (status = 'issuing' and updated_at < now() - interval '3 minutes'))
      and stock_state = 'reserved' and cancel_requested_at is null;
  return found;
end;
$$;

create or replace function public.begin_wholesale_kit_invoice_issue(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare i private.wholesale_kit_invoices;
begin
  select * into i from private.wholesale_kit_invoices where id = p_id for update;
  if not found or i.cancel_requested_at is not null or i.stock_state <> 'reserved' or i.status = 'authorized'
    or (i.status = 'issuing' and i.updated_at > now() - interval '3 minutes')
    or i.status = 'cancelled' then return null; end if;
  update private.wholesale_kit_invoices set status = 'issuing', error_code = null, attempts = attempts + 1, updated_at = now()
    where id = i.id returning * into i;
  return private.wholesale_kit_invoice_job(i);
end;
$$;

create or replace function public.cancel_wholesale_kit_invoice(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare i private.wholesale_kit_invoices; s record;
begin
  perform private.require_wholesale_invoice_access();
  select * into i from private.wholesale_kit_invoices where id = p_id for update;
  if not found then return jsonb_build_object('ok', false); end if;
  if i.status = 'cancelled' then return jsonb_build_object('ok', i.cancel_reconciled_at is not null or (i.bling_sale_id is null and not exists (select 1 from private.wholesale_kit_invoice_writes w where w.invoice_id=i.id)), 'blingResidue', i.bling_sale_id is not null and i.cancel_reconciled_at is null); end if;
  if i.status not in ('draft', 'error') or i.stock_state <> 'reserved'
    or i.cancel_requested_at is not null or i.bling_sale_id is not null or i.bling_invoice_id is not null
    or exists (select 1 from private.wholesale_kit_invoice_writes w where w.invoice_id = i.id) then
    return jsonb_build_object('ok', false);
  end if;
  for s in select * from jsonb_to_recordset(coalesce(i.grade_snapshot->'selections',
    jsonb_build_array(jsonb_build_object('kitId',i.kit_id,'template',i.template,'quantity',i.quantity))))
    x("kitId" uuid,template text,quantity integer) order by x."kitId" loop
    update public.kits k set
      grade_standard_stock = k.grade_standard_stock + case when s.template='standard' then s.quantity else 0 end,
      grade_lower_restock_stock = k.grade_lower_restock_stock + case when s.template='lower_restock' then s.quantity else 0 end,
      grade_upper_restock_stock = k.grade_upper_restock_stock + case when s.template='upper_restock' then s.quantity else 0 end
      where k.id=s."kitId";
    if not found then raise exception 'kit_stock_inconsistent' using errcode='23514'; end if;
  end loop;
  update private.wholesale_kit_invoices set status = 'cancelled', stock_state = 'released',
    cancelled_at = now(), cancel_reconciled_at=now(), updated_at = now() where id = i.id;
  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, new_data_sanitized)
    values (auth.uid(), private.current_app_role(), 'fiscal.wholesale_invoice.cancelled', 'wholesale_kit_invoice', i.id,
      jsonb_build_object('quantity', i.quantity, 'blingResidue', i.bling_sale_id is not null));
  return jsonb_build_object('ok', true, 'blingResidue', i.bling_sale_id is not null);
end;
$$;

create function public.begin_wholesale_kit_invoice_cancel(p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i private.wholesale_kit_invoices;
begin
  perform private.require_wholesale_invoice_access();
  select * into i from private.wholesale_kit_invoices where id=p_id for update;
  if not found or i.status='authorized' or i.cancel_reconciled_at is not null
    or exists(select 1 from private.wholesale_kit_invoice_writes w where w.invoice_id=i.id and w.operation='bling_invoice_send')
    or (i.status='issuing' and i.cancel_requested_at is null)
    or (i.error_code='cancel_in_progress' and i.updated_at>now()-interval '3 minutes') then return null; end if;
  update private.wholesale_kit_invoices set cancel_requested_at=coalesce(cancel_requested_at,now()),
    status=case when stock_state='released' then 'cancelled' else 'issuing' end,
    error_code='cancel_in_progress',updated_at=now() where id=p_id returning * into i;
  return private.wholesale_kit_invoice_job(i);
end;
$$;

create function public.record_wholesale_cancel_remote(p_id uuid,p_sale bigint,p_invoice bigint)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if (p_sale is not null and p_sale<=0) or (p_invoice is not null and p_invoice<=0) then return false; end if;
  update private.wholesale_kit_invoices set bling_sale_id=coalesce(bling_sale_id,p_sale),
    bling_invoice_id=coalesce(bling_invoice_id,p_invoice),updated_at=now()
    where id=p_id and cancel_requested_at is not null and cancel_reconciled_at is null and error_code='cancel_in_progress'
      and (bling_sale_id is null or p_sale is null or bling_sale_id=p_sale)
      and (bling_invoice_id is null or p_invoice is null or bling_invoice_id=p_invoice);
  return found;
end;
$$;

create function public.record_wholesale_cancel_pending(p_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  update private.wholesale_kit_invoices set status=case when stock_state='released' then 'cancelled' else 'error' end,
    error_code='cancel_reconciliation_pending',updated_at=now()
    where id=p_id and cancel_requested_at is not null and cancel_reconciled_at is null and error_code='cancel_in_progress';
  return found;
end;
$$;

create function public.finish_wholesale_kit_invoice_cancel(p_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare i private.wholesale_kit_invoices; s record;
begin
  select * into i from private.wholesale_kit_invoices where id=p_id for update;
  if not found then return false; end if;
  if i.cancel_reconciled_at is not null then return true; end if;
  if i.cancel_requested_at is null or i.error_code is distinct from 'cancel_in_progress' or i.status='authorized'
    or exists(select 1 from private.wholesale_kit_invoice_writes w where w.invoice_id=i.id and w.operation='bling_invoice_send') then return false; end if;
  if i.stock_state='reserved' then
  for s in select * from jsonb_to_recordset(coalesce(i.grade_snapshot->'selections',
    jsonb_build_array(jsonb_build_object('kitId',i.kit_id,'template',i.template,'quantity',i.quantity))))
    x("kitId" uuid,template text,quantity integer) order by x."kitId" loop
    update public.kits k set
      grade_standard_stock = k.grade_standard_stock + case when s.template='standard' then s.quantity else 0 end,
      grade_lower_restock_stock = k.grade_lower_restock_stock + case when s.template='lower_restock' then s.quantity else 0 end,
      grade_upper_restock_stock = k.grade_upper_restock_stock + case when s.template='upper_restock' then s.quantity else 0 end
      where k.id=s."kitId";
    if not found then raise exception 'kit_stock_inconsistent' using errcode='23514'; end if;
  end loop;
  end if;
  update private.wholesale_kit_invoices set status='cancelled',stock_state='released',
    cancelled_at=coalesce(cancelled_at,now()),cancel_reconciled_at=now(),updated_at=now(),error_code=null where id=i.id;
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
    values(null,null,'fiscal.wholesale_invoice.cancel_reconciled','wholesale_kit_invoice',i.id,
      jsonb_build_object('externalSale',i.bling_sale_id is not null,'externalDraft',i.bling_invoice_id is not null));
  return true;
end;
$$;

-- Persist the exact linked draft before preparation, so later retries cannot lose it.
create function public.link_wholesale_kit_invoice_draft(p_id uuid,p_sale bigint,p_invoice bigint)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if p_sale is null or p_sale<=0 or p_invoice is null or p_invoice<=0 then return false; end if;
  update private.wholesale_kit_invoices set bling_invoice_id=p_invoice,updated_at=now()
    where id=p_id and status='issuing' and cancel_requested_at is null and bling_sale_id=p_sale
      and (bling_invoice_id is null or bling_invoice_id=p_invoice);
  return found;
end;
$$;

revoke all on function public.begin_wholesale_kit_invoice_cancel(uuid) from public,anon,service_role;
grant execute on function public.begin_wholesale_kit_invoice_cancel(uuid) to authenticated;
revoke all on function public.record_wholesale_cancel_remote(uuid,bigint,bigint),public.record_wholesale_cancel_pending(uuid),
  public.finish_wholesale_kit_invoice_cancel(uuid),public.link_wholesale_kit_invoice_draft(uuid,bigint,bigint) from public,anon,authenticated;
grant execute on function public.record_wholesale_cancel_remote(uuid,bigint,bigint),public.record_wholesale_cancel_pending(uuid),
  public.finish_wholesale_kit_invoice_cancel(uuid),public.link_wholesale_kit_invoice_draft(uuid,bigint,bigint) to service_role;
notify pgrst,'reload schema';

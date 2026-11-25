-- Keep audit and inventory history; hide only reconciled cancellations.
alter table private.wholesale_kit_invoices add column archived_at timestamptz,
  add column external_reported_at timestamptz, add column external_reported_key text,
  add column external_reported_protocol text, add column external_reported_sha256 text;
alter table private.wholesale_kit_invoices add constraint wholesale_external_report_complete check (
  (external_reported_at is null and external_reported_key is null and external_reported_protocol is null and external_reported_sha256 is null)
  or (external_reported_at is not null and external_reported_key ~ '^31[0-9]{42}$' and external_reported_protocol ~ '^[0-9]{15}$' and external_reported_sha256 ~ '^[0-9a-f]{64}$'
      and external_reported_key is not null and external_reported_protocol is not null and external_reported_sha256 is not null));
create unique index wholesale_external_report_key_unique on private.wholesale_kit_invoices(external_reported_key) where external_reported_key is not null;
create function public.archive_wholesale_kit_invoice(p_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_wholesale_invoice_access();
  update private.wholesale_kit_invoices i set archived_at=now()
    where i.id=p_id and i.archived_at is null and i.status='cancelled' and i.stock_state='released'
      and i.external_reported_at is null and (i.cancel_reconciled_at is not null or
        (i.bling_sale_id is null and i.bling_invoice_id is null and not exists(select 1 from private.wholesale_kit_invoice_writes w where w.invoice_id=i.id)));
  if not found then return false; end if;
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
    values(auth.uid(),private.current_app_role(),'fiscal.wholesale_invoice.archived','wholesale_kit_invoice',p_id,'{}'::jsonb);
  return true;
end;
$$;
revoke all on function public.archive_wholesale_kit_invoice(uuid) from public,anon,authenticated;
grant execute on function public.archive_wholesale_kit_invoice(uuid) to authenticated;
-- A reported external authorization is evidence, not automatic clearance.
CREATE OR REPLACE FUNCTION public.list_wholesale_kit_invoices(p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r private.wholesale_kit_invoices; result jsonb := '[]'::jsonb;
begin
  perform private.require_wholesale_invoice_access();
  for r in select * from private.wholesale_kit_invoices
    where archived_at is null order by created_at desc, id limit least(greatest(coalesce(p_limit, 50), 1), 100)
  loop
    result := result || jsonb_build_array(private.wholesale_kit_invoice_summary(r));
  end loop;
  return result;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.wholesale_kit_invoice_summary(i private.wholesale_kit_invoices)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    'externalReported', i.external_reported_at is not null, 'externalNumber', case when i.external_reported_at is not null then substr(i.external_reported_key,26,9) end, 'externalSeries', case when i.external_reported_at is not null then substr(i.external_reported_key,23,3) end, 'authorized', i.status = 'authorized', 'errorCode', i.error_code, 'attempts', i.attempts,
    'cancelPending', i.cancel_requested_at is not null and i.cancel_reconciled_at is null,
    'canCancel', i.external_reported_at is null and i.cancel_reconciled_at is null
      and (i.status in ('draft','error') or (i.status='cancelled' and (i.bling_sale_id is not null or exists
        (select 1 from private.wholesale_kit_invoice_writes w where w.invoice_id=i.id))))
      and not exists (select 1 from private.wholesale_kit_invoice_writes w where w.invoice_id=i.id and w.operation='bling_invoice_send'),
    'createdAt', i.created_at);
$function$
;
CREATE OR REPLACE FUNCTION public.request_wholesale_kit_invoice_retry(p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_wholesale_invoice_access();
  update private.wholesale_kit_invoices set status = 'draft', error_code = null, updated_at = now()
    where id = p_id and (status in ('draft', 'error') or (status = 'issuing' and updated_at < now() - interval '3 minutes'))
      and external_reported_at is null and archived_at is null and stock_state = 'reserved' and cancel_requested_at is null;
  return found;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.begin_wholesale_kit_invoice_issue(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare i private.wholesale_kit_invoices;
begin
  select * into i from private.wholesale_kit_invoices where id = p_id for update;
  if not found or i.external_reported_at is not null or i.archived_at is not null or i.cancel_requested_at is not null or i.stock_state <> 'reserved' or i.status = 'authorized'
    or (i.status = 'issuing' and i.updated_at > now() - interval '3 minutes')
    or i.status = 'cancelled' then return null; end if;
  update private.wholesale_kit_invoices set status = 'issuing', error_code = null, attempts = attempts + 1, updated_at = now()
    where id = i.id returning * into i;
  return private.wholesale_kit_invoice_job(i);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.begin_wholesale_kit_invoice_cancel(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare i private.wholesale_kit_invoices;
begin
  perform private.require_wholesale_invoice_access();
  select * into i from private.wholesale_kit_invoices where id=p_id for update;
  if not found or i.external_reported_at is not null or i.archived_at is not null or i.status='authorized' or i.cancel_reconciled_at is not null
    or exists(select 1 from private.wholesale_kit_invoice_writes w where w.invoice_id=i.id and w.operation='bling_invoice_send')
    or (i.status='issuing' and i.cancel_requested_at is null)
    or (i.error_code='cancel_in_progress' and i.updated_at>now()-interval '3 minutes') then return null; end if;
  update private.wholesale_kit_invoices set cancel_requested_at=coalesce(cancel_requested_at,now()),
    status=case when stock_state='released' then 'cancelled' else 'issuing' end,
    error_code='cancel_in_progress',updated_at=now() where id=p_id returning * into i;
  return private.wholesale_kit_invoice_job(i);
end;
$function$
;
notify pgrst,'reload schema';

-- Preserve a read-only copy before removing an unsent Bling draft.
alter table private.wholesale_kit_invoices add column cancel_preview jsonb;
alter table private.wholesale_kit_invoices add constraint wholesale_cancel_preview_shape check
  (cancel_preview is null or (jsonb_typeof(cancel_preview)='object' and octet_length(cancel_preview::text)<=262144));

create function public.save_wholesale_cancel_preview(p_id uuid,p_preview jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  if p_preview is null or jsonb_typeof(p_preview)<>'object' or octet_length(p_preview::text)>262144
    or coalesce(p_preview->>'hash','x')<>'' or jsonb_typeof(p_preview->'items') is distinct from 'array' then return false; end if;
  update private.wholesale_kit_invoices set cancel_preview=coalesce(cancel_preview,p_preview)
    where id=p_id and cancel_requested_at is not null and cancel_reconciled_at is null
      and error_code='cancel_in_progress' and external_reported_at is null and status<>'authorized'
      and not exists(select 1 from private.wholesale_kit_invoice_writes w where w.invoice_id=p_id and w.operation='bling_invoice_send');
  return found;
end;
$$;

create function public.read_wholesale_cancelled_history(p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('buyer',i.buyer_snapshot,'paymentMethod',i.payment_method,
    'selections',coalesce(i.grade_snapshot->'selections',jsonb_build_array(jsonb_build_object(
      'kitId',i.kit_id,'template',i.template,'quantity',i.quantity,'unitPriceInCents',i.unit_price_cents))),
    'review',i.cancel_preview,'job',private.wholesale_kit_invoice_job(i))
  from private.wholesale_kit_invoices i
  where i.id=p_id and i.status='cancelled' and i.stock_state='released'
    and i.cancel_reconciled_at is not null and i.external_reported_at is null and i.archived_at is null;
$$;

-- Check the actual version bound to every kit, not just whether the catalog hash still matches.
-- Never use this to prevent reconciliation of an already transmitted document.
create function public.wholesale_kit_invoice_rule_current(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce((select not exists (
    select 1 from (
      select i.rule_version_id as id
      union
      select (s->>'ruleVersionId')::uuid from jsonb_array_elements(coalesce(i.grade_snapshot->'selections','[]'::jsonb)) s
    ) selected
    where selected.id is null or not exists (
      select 1 from private.representative_resale_fiscal_rule_versions v
      join private.representative_resale_fiscal_rule_approvals a on a.rule_version_id=v.id
      where v.id=selected.id and v.valid_from<=now() and v.valid_until>now()
        and not exists(select 1 from private.representative_resale_fiscal_rule_revocations r where r.rule_version_id=v.id)
    )
  ) from private.wholesale_kit_invoices i where i.id=p_id),false);
$$;

revoke all on function public.save_wholesale_cancel_preview(uuid,jsonb),public.read_wholesale_cancelled_history(uuid),public.wholesale_kit_invoice_rule_current(uuid) from public,anon,authenticated;
grant execute on function public.save_wholesale_cancel_preview(uuid,jsonb),public.read_wholesale_cancelled_history(uuid),public.wholesale_kit_invoice_rule_current(uuid) to service_role;
notify pgrst,'reload schema';

-- A rejected write can be retried only after the server has checked both
-- the sale link and the NF-e search. Unknown outcomes are never unlocked.
create function public.reopen_rejected_wholesale_draft(p_id uuid,p_sale bigint)
returns boolean language plpgsql security definer set search_path='' as $$
declare i private.wholesale_kit_invoices; w private.wholesale_kit_invoice_writes; reason text;
begin
  select * into i from private.wholesale_kit_invoices where id=p_id for update;
  if not found or i.status<>'issuing' or i.cancel_requested_at is not null
    or i.stock_state<>'reserved' or i.bling_sale_id is distinct from p_sale or p_sale is null
    or i.bling_invoice_id is not null or i.invoice_access_key is not null or i.draft_hash is not null
    or exists(select 1 from private.wholesale_kit_invoice_writes where invoice_id=p_id and operation='bling_invoice_send')
    then return false; end if;
  select * into w from private.wholesale_kit_invoice_writes where invoice_id=p_id and operation='bling_invoice_draft';
  if not found or w.claimed_at>now()-interval '3 minutes' then return false; end if;
  select a.new_data_sanitized->>'reason' into reason from public.audit_logs a
    where a.entity_id::text=p_id::text and a.action='fiscal.wholesale_invoice.error' and a.created_at>=w.claimed_at
    order by a.created_at desc limit 1;
  -- The legacy implementation persisted validation_error rather than the
  -- generation-specific code. Require both remote lookups for either case.
  if reason is null or reason not in ('draft_generation_rejected','validation_error') then return false; end if;
  delete from private.wholesale_kit_invoice_writes where invoice_id=p_id and operation='bling_invoice_draft';
  if not found then return false; end if;
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
    values(null,null,'fiscal.wholesale_invoice.draft_retry_reconciled','wholesale_kit_invoice',p_id,jsonb_build_object('reason',reason));
  return true;
end;
$$;
revoke all on function public.reopen_rejected_wholesale_draft(uuid,bigint) from public,anon,authenticated;
grant execute on function public.reopen_rejected_wholesale_draft(uuid,bigint) to service_role;
notify pgrst,'reload schema';

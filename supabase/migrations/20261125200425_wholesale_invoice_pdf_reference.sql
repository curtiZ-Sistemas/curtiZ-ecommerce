-- Resolve a single fiscal document using the same permission and MFA as issuance.
-- External evidence may be viewed only after the server verifies the live Bling key/status.
create or replace function public.read_wholesale_invoice_pdf_reference(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform private.require_wholesale_invoice_access();
  return (select jsonb_build_object('invoiceId',i.bling_invoice_id,
    'invoiceKey',case when i.status='authorized' then i.invoice_access_key else i.external_reported_key end,
    'invoiceNumber',case when i.status='authorized' then i.invoice_number else substr(i.external_reported_key,26,9) end)
    from private.wholesale_kit_invoices i
    where i.id=p_id and i.archived_at is null and i.status<>'cancelled' and i.bling_invoice_id>0
      and (i.status='authorized' or i.external_reported_at is not null));
end;
$$;
revoke all on function public.read_wholesale_invoice_pdf_reference(uuid) from public,anon,authenticated;
grant execute on function public.read_wholesale_invoice_pdf_reference(uuid) to authenticated;
notify pgrst,'reload schema';

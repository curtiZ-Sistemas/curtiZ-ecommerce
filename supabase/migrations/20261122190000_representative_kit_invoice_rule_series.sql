-- Record a verified wholesale invoice only for the series fixed by its fiscal rule.
create or replace function public.record_representative_kit_authorized_invoice(
  p_order uuid, p_sale bigint, p_invoice bigint, p_key text, p_protocol text, p_sha256 text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  o private.representative_kit_orders;
  expected_series text;
begin
  select * into o from private.representative_kit_orders where id = p_order for update;
  if not found or not private.representative_kit_fiscal_ready(o)
    or p_key is null or p_key !~ '^31[0-9]{42}$'
    or p_protocol is null or p_protocol !~ '^[0-9]{15}$'
    or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then return false; end if;

  select r.fiscal_parameters -> 'blingRule' ->> 'series' into expected_series
    from private.representative_resale_fiscal_rule_versions r where r.id = o.rule_version_id;
  if expected_series is null or expected_series not in ('2', '3')
    or substr(p_key,21,5) <> '55' || lpad(expected_series,3,'0') then return false; end if;

  update private.representative_kit_fulfillment set invoice_access_key = p_key, invoice_protocol = p_protocol,
    invoice_xml_sha256 = p_sha256, invoice_confirmed_at = clock_timestamp()
    where order_id = p_order and bling_sale_id = p_sale and bling_invoice_id = p_invoice
      and (invoice_access_key is null or (invoice_access_key = p_key and invoice_protocol = p_protocol and invoice_xml_sha256 = p_sha256))
      and not exists (select 1 from private.bling_order_links b
        where b.invoice_id = p_invoice or b.external_order_id = p_sale or b.invoice_access_key = p_key);
  return found;
end;
$$;

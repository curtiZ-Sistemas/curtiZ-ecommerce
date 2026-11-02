-- Resolve only existing, unambiguous links. No fiscal document is created.
create function public.read_bling_invoice_order(p_invoice_id bigint,p_order_code text default '')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; matches integer;
begin
  if p_invoice_id is null or p_invoice_id<=0 or length(coalesce(p_order_code,''))>120 then
    raise exception 'invalid_invoice_reference' using errcode='22023';
  end if;
  select count(*),jsonb_agg(jsonb_build_object('orderCode',o.public_code,
    'externalOrderId',l.external_order_id,'invoiceId',l.invoice_id))->0
  into matches,result
  from private.bling_order_links l join public.orders o on o.id=l.order_id
  where l.external_order_id is not null and
    (l.invoice_id=p_invoice_id or (nullif(p_order_code,'') is not null and o.public_code=p_order_code));
  if matches>1 then raise exception 'invoice_link_conflict' using errcode='23514'; end if;
  return result;
end;
$$;
revoke all on function public.read_bling_invoice_order(bigint,text) from public,anon,authenticated;
grant execute on function public.read_bling_invoice_order(bigint,text) to service_role;

-- Keep failed historical events for review. A retry must go through the same
-- signed-event reconciliation and exact mapping; no bulk retry is performed.

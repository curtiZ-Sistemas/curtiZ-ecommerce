CREATE OR REPLACE FUNCTION public.search_wholesale_invoice_clients(p_query text, p_invoice_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare term text := btrim(coalesce(p_query,'')); normalized text;
begin
  perform private.require_wholesale_invoice_access();
  if p_invoice_id is not null then
    return (select jsonb_build_object(
      'buyer',jsonb_build_object('document',i.buyer_snapshot->>'document','name',i.buyer_snapshot->>'name',
        'registration',i.buyer_snapshot->>'registration','regime',i.buyer_snapshot->>'regime',
        'address',i.buyer_snapshot->'address'),
      'selections',coalesce(i.grade_snapshot->'selections',
        jsonb_build_array(jsonb_build_object('kitId',i.kit_id,'template',i.template,'quantity',i.quantity))))
      from private.wholesale_kit_invoices i where i.id=p_invoice_id
      and (i.status='authorized' or i.external_reported_at is not null));
  end if;
  if char_length(term)<2 or char_length(term)>100 then return '[]'::jsonb; end if;
  normalized := translate(lower(term),'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc');
  return coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'document',s.document,'city',s.city) order by s.name,s.document)
    from (select distinct on (i.buyer_snapshot->>'document') i.id, i.buyer_snapshot->>'document' as document,
      i.buyer_snapshot->>'name' as name,i.buyer_snapshot#>>'{address,city}' as city
      from private.wholesale_kit_invoices i
      where (i.status='authorized' or i.external_reported_at is not null)
        and i.buyer_snapshot->>'document' ~ '^[0-9]{14}$'
        and (strpos(translate(lower(i.buyer_snapshot->>'name'),'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc'),normalized)>0
          or (term ~ '^[0-9./ -]+$' and char_length(regexp_replace(term,'[^0-9]','','g'))>=4
            and strpos(i.buyer_snapshot->>'document',regexp_replace(term,'[^0-9]','','g'))>0))
      order by i.buyer_snapshot->>'document', i.created_at desc,i.id desc limit 10) s),'[]'::jsonb);
end;
$function$
;
revoke all on function public.search_wholesale_invoice_clients(text,uuid) from public,anon,authenticated;
grant execute on function public.search_wholesale_invoice_clients(text,uuid) to authenticated;
notify pgrst,'reload schema';

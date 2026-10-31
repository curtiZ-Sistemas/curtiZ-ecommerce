-- Read existing commercial kits directly. No offer, SKU, composition, price,
-- inventory, approval, order or shared execution flag is inserted/updated.
create function private.representative_catalog_access()
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.representatives r join public.profiles p on p.id=r.user_id
    where r.user_id=auth.uid() and p.status='active'
      and r.status in('approved_waiting_kit','active','unqualified'));
$$;
revoke all on function private.representative_catalog_access() from public,anon,authenticated,service_role;

create function public.list_representative_catalog_kits(p_offset integer default 0)
returns jsonb language sql stable security definer set search_path='' as $$
  with candidates as (
    select v.id as "variantId",p.name,v.sku,v.color_name as color,v.size,
      round(coalesce(v.price_override,p.base_price)*100)::bigint as "unitPriceInCents",
      m.pairs_per_sku as "pairsPerSku",i.available_quantity as available
    from public.product_variants v join public.products p on p.id=v.product_id
      join private.bling_catalog_metadata m on m.product_id=p.id
      left join public.inventory i on i.variant_id=v.id
    where v.active and p.status='active' and m.pairs_per_sku>1
      and private.representative_catalog_access() and p_offset between 0 and 10000
    order by p.name,v.color_name,v.size,v.id limit 25 offset greatest(p_offset,0)
  ) select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(page) order by name,color,size,"variantId")
      from(select * from candidates order by name,color,size,"variantId" limit 24)page),'[]'::jsonb),
    'nextOffset',case when (select count(*) from candidates)>24 then p_offset+24 else null end)
    where private.representative_catalog_access() and p_offset between 0 and 10000;
$$;
revoke all on function public.list_representative_catalog_kits(integer) from public,anon,service_role;
grant execute on function public.list_representative_catalog_kits(integer) to authenticated;

create function public.read_representative_catalog_kit_context(p_variant_id uuid,p_quantity integer)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('source','catalog','kitId',null,'variantId',v.id,'name',p.name,
    'merchandiseTotalInCents',round(coalesce(v.price_override,p.base_price)*100)::bigint*p_quantity,
    'items',jsonb_build_array(jsonb_build_object('variantId',v.id,'sku',v.sku,'description',p.name,
      'quantity',p_quantity,'active',true,'available',i.available_quantity,'allocationWeight',null,
      'metadata',jsonb_build_object('commercial_unit',m.commercial_unit,'pairs_per_sku',m.pairs_per_sku,
        'ncm',m.ncm,'origin',m.origin,'cest',m.cest),
      'composition',public.read_bling_catalog_variant(v.id)->'kit_components')))
  from public.product_variants v join public.products p on p.id=v.product_id
    join private.bling_catalog_metadata m on m.product_id=p.id
    left join public.inventory i on i.variant_id=v.id
  where v.id=p_variant_id and v.active and p.status='active' and m.pairs_per_sku>1
    and p_quantity between 1 and 99 and private.representative_catalog_access();
$$;
revoke all on function public.read_representative_catalog_kit_context(uuid,integer) from public,anon,service_role;
grant execute on function public.read_representative_catalog_kit_context(uuid,integer) to authenticated;

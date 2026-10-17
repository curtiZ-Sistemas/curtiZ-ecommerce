-- Orders must use the reviewed commercial unit of the linked product.
-- No fiscal approval or commercial synchronization is enabled here.
create or replace function public.read_bling_product_links(p_variant_ids uuid[])
returns jsonb language sql security definer set search_path = '' stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('variantId',link.variant_id,'externalProductId',link.external_product_id,
    'sku',link.sku,'externalSku',link.external_sku,'status',link.sync_status,'commercialUnit',metadata.commercial_unit)), '[]'::jsonb)
  from private.bling_product_links link
  left join public.product_variants variant on variant.id=link.variant_id
  left join private.bling_catalog_metadata metadata on metadata.product_id=variant.product_id
  where link.variant_id=any(p_variant_ids);
$$;
revoke all on function public.read_bling_product_links(uuid[]) from public,anon,authenticated;
grant execute on function public.read_bling_product_links(uuid[]) to service_role;

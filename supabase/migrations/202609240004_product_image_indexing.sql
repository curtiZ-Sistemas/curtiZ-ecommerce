-- Public image discovery uses the same commercial projection as the storefront.
-- Only product_images are included; CMS media, banners, and video thumbnails are
-- stored elsewhere and cannot enter this result.
create index if not exists product_images_product_seo_idx
  on public.product_images(product_id, is_primary desc, sort_order, created_at);

create or replace function public.get_storefront_product_image_seo_entries(
  p_limit integer default 50000
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with active_products as (
    select item.product_id, item.slug, product.name, max(product.updated_at) as updated_at
    from private.storefront_catalog_items() item
    join public.products product on product.id = item.product_id
    group by item.product_id, item.slug, product.name
    order by item.slug
    limit greatest(1, least(coalesce(p_limit, 50000), 50000))
  ),
  product_images as (
    select
      active.product_id,
      active.slug,
      active.updated_at,
      images.items
    from active_products active
    cross join lateral (
      select coalesce(jsonb_agg(jsonb_build_object(
        'path', image.storage_path,
        'alt_text', image.alt_text,
        'is_primary', image.is_primary,
        'sort_order', image.sort_order,
        'variant_id', image.variant_id,
        'width', image.width,
        'height', image.height,
        'media_type', 'image'
      ) order by image.is_primary desc, image.sort_order, image.created_at), '[]'::jsonb) as items
      from (
        select product_image.*
        from public.product_images product_image
        where product_image.product_id = active.product_id
          and product_image.width > 0
          and product_image.height > 0
          and lower(product_image.storage_path) ~ '^products(/[a-z0-9_-]+)+\.(avif|jpe?g|png|webp)$'
        order by product_image.is_primary desc, product_image.sort_order, product_image.created_at
        limit 60
      ) image
    ) images
    where jsonb_array_length(images.items) > 0
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'slug', entry.slug,
    'name', entry.name,
    'updatedAt', entry.updated_at,
    'images', entry.items
  ) order by entry.slug), '[]'::jsonb)
  from product_images entry;
$$;

revoke all on function public.get_storefront_product_image_seo_entries(integer) from public;
grant execute on function public.get_storefront_product_image_seo_entries(integer) to anon, authenticated;

notify pgrst, 'reload schema';

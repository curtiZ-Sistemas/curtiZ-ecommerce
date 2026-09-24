-- Keep one card per product and real image, with a selectable variant for a single-color card.
create or replace function private.storefront_catalog_items()
returns table (
  product_id uuid, variant_id uuid, storefront_key text, slug text,
  display_name text, base_name text, category_id uuid, category text, category_slug text,
  collection text, collection_slug text, model_slug text, description text,
  price_cents integer, compare_at_price_cents integer, featured boolean, created_at timestamptz,
  colors text[], sizes text[], stock integer, rating numeric, reviews integer,
  sold_count integer, image_path text, sku text, variant_color text, variant_size text
)
language sql stable security definer set search_path = '' as $$
  with valid as (
    select item.*
    from private.storefront_catalog_variant_items() item
    where item.image_path is not null
      and item.image_path !~ '(^/|icon[.]svg$)'
      and exists (
        select 1 from public.product_images image
        where image.product_id = item.product_id and image.storage_path = item.image_path
          and image.width > 0 and image.height > 0
      )
  ), grouped as (
    select item.product_id, item.image_path,
      count(*)::integer as member_count,
      min(item.price_cents) as price_cents,
      max(item.compare_at_price_cents) as compare_at_price_cents,
      sum(item.stock)::integer as stock,
      array(select distinct color.value from valid member
        cross join lateral unnest(member.colors) color(value)
        where member.product_id = item.product_id and member.image_path = item.image_path
          and color.value <> '' order by color.value) as colors,
      array(select distinct size.value from valid member
        cross join lateral unnest(member.sizes) size(value)
        where member.product_id = item.product_id and member.image_path = item.image_path
          and size.value <> '' order by size.value) as sizes
    from valid item
    group by item.product_id, item.image_path
  ), representative as (
    select item.*,
      row_number() over(partition by item.product_id, item.image_path
        order by (item.stock > 0) desc, item.price_cents, item.variant_id nulls last) as position
    from valid item
  )
  select item.product_id,
    case when cardinality(grouped.colors) = 1 then color_variant.id else null::uuid end,
    item.product_id::text || ':' || md5(item.image_path), item.slug,
    case when cardinality(grouped.colors) = 1 then item.base_name || ' — ' || grouped.colors[1]
      else item.base_name end,
    item.base_name, item.category_id, item.category, item.category_slug,
    item.collection, item.collection_slug, item.model_slug, item.description,
    grouped.price_cents, grouped.compare_at_price_cents, item.featured, item.created_at,
    coalesce(grouped.colors, '{}'::text[]), coalesce(grouped.sizes, '{}'::text[]),
    grouped.stock, item.rating, item.reviews, item.sold_count, item.image_path,
    case when grouped.member_count = 1 and color_variant.id = item.variant_id then item.sku else null::text end,
    case when cardinality(grouped.colors) = 1 then grouped.colors[1] else null::text end,
    case when grouped.member_count = 1 and color_variant.id = item.variant_id then item.variant_size else null::text end
  from representative item
  join grouped on grouped.product_id = item.product_id and grouped.image_path = item.image_path
  left join lateral (
    select variant.id
    from public.product_variants variant
    left join public.inventory inventory on inventory.variant_id = variant.id
    where variant.product_id = grouped.product_id
      and variant.active
      and variant.color_name = grouped.colors[1]
    order by (coalesce(inventory.available_quantity, 0) - coalesce(inventory.reserved_quantity, 0) > 0) desc,
      exists (
      select 1 from public.product_images image
      where image.product_id = grouped.product_id
        and image.variant_id = variant.id
        and image.storage_path = grouped.image_path
        and image.width > 0 and image.height > 0
    ) desc,
      variant.id
    limit 1
  ) color_variant on cardinality(grouped.colors) = 1
  where item.position = 1;
$$;

revoke all on function private.storefront_catalog_items() from public, anon, authenticated;
notify pgrst, 'reload schema';

-- Keep the variant-level source for Merchant and product detail; expose one card per real visual.
alter function private.storefront_catalog_items() rename to storefront_catalog_variant_items;

create function private.storefront_catalog_items()
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
    case when grouped.member_count = 1 then item.variant_id else null::uuid end,
    item.product_id::text || ':' || md5(item.image_path), item.slug,
    case when cardinality(grouped.colors) = 1 then item.base_name || ' — ' || grouped.colors[1]
      else item.base_name end,
    item.base_name, item.category_id, item.category, item.category_slug,
    item.collection, item.collection_slug, item.model_slug, item.description,
    grouped.price_cents, grouped.compare_at_price_cents, item.featured, item.created_at,
    coalesce(grouped.colors, '{}'::text[]), coalesce(grouped.sizes, '{}'::text[]),
    grouped.stock, item.rating, item.reviews, item.sold_count, item.image_path,
    case when grouped.member_count = 1 then item.sku else null::text end,
    case when cardinality(grouped.colors) = 1 then grouped.colors[1] else null::text end,
    case when grouped.member_count = 1 then item.variant_size else null::text end
  from representative item
  join grouped on grouped.product_id = item.product_id and grouped.image_path = item.image_path
  where item.position = 1;
$$;

revoke all on function private.storefront_catalog_items() from public, anon, authenticated;

-- Rebind the existing search function to the grouped source. Its source is copied from
-- the immediately preceding catalog migration, with membership tested by color+size.
create or replace function public.search_catalog(
  p_query text default null, p_category text default null, p_collection text default null,
  p_colors text[] default '{}'::text[], p_sizes text[] default '{}'::text[],
  p_price_min integer default null, p_price_max integer default null,
  p_promotion boolean default false, p_in_stock boolean default false,
  p_featured boolean default false, p_min_rating numeric default null,
  p_sort text default 'relevant', p_page integer default 1, p_page_size integer default 12
) returns jsonb language sql stable security definer set search_path = '' as $$
  with product_data as (
    select item.* from private.storefront_catalog_items() item
    where (
      nullif(pg_catalog.btrim(p_query), '') is null
      or pg_catalog.to_tsvector('simple', pg_catalog.concat_ws(' ', item.base_name,
          item.description, item.category, item.variant_color, item.variant_size, item.sku))
        @@ pg_catalog.websearch_to_tsquery('simple', pg_catalog.btrim(p_query))
      or pg_catalog.concat_ws(' ', item.base_name, item.variant_color, item.variant_size, item.sku)
        ilike ('%' || pg_catalog.btrim(p_query) || '%')
    )
    and (nullif(pg_catalog.btrim(p_category), '') is null or exists (
      select 1 from public.product_categories link
      join public.categories category on category.id = link.category_id and category.active
      where link.product_id = item.product_id
        and (pg_catalog.lower(category.slug) = pg_catalog.lower(pg_catalog.btrim(p_category))
          or pg_catalog.lower(category.name) = pg_catalog.lower(pg_catalog.btrim(p_category)))
    ))
    and (nullif(pg_catalog.btrim(p_collection), '') is null
      or pg_catalog.lower(item.collection_slug) = pg_catalog.lower(pg_catalog.btrim(p_collection)))
  ), scoped as (
    select * from product_data item
    where (p_price_min is null or item.price_cents >= p_price_min)
      and (p_price_max is null or item.price_cents <= p_price_max)
      and (not p_promotion or item.compare_at_price_cents is not null)
      and (not p_in_stock or item.stock > 0)
      and (not p_featured or item.featured)
      and (p_min_rating is null or item.rating >= p_min_rating)
  ), filtered as (
    select * from scoped item
    where (pg_catalog.cardinality(p_colors) = 0 and pg_catalog.cardinality(p_sizes) = 0)
      or exists (
        select 1 from public.product_variants variant
        join public.inventory inventory on inventory.variant_id = variant.id
        where variant.product_id = item.product_id and variant.active
          and (pg_catalog.cardinality(item.colors) = 0 or variant.color_name = any(item.colors))
          and inventory.available_quantity - inventory.reserved_quantity > 0
          and (pg_catalog.cardinality(p_colors) = 0 or exists (
            select 1 from pg_catalog.unnest(p_colors) requested(color)
            where pg_catalog.lower(pg_catalog.btrim(pg_catalog.regexp_replace(variant.color_name, '[[:space:]]+', ' ', 'g')))
              = pg_catalog.lower(pg_catalog.btrim(pg_catalog.regexp_replace(requested.color, '[[:space:]]+', ' ', 'g')))
          ))
          and (pg_catalog.cardinality(p_sizes) = 0 or variant.size = any(p_sizes))
      )
  ), ordered as (
    select item.*, pg_catalog.row_number() over(order by
      case when p_sort = 'price_asc' then item.price_cents end asc,
      case when p_sort = 'price_desc' then item.price_cents end desc,
      case when p_sort = 'newest' then item.created_at end desc,
      case when p_sort = 'best_sellers' then item.sold_count end desc,
      case when p_sort = 'rating' then item.rating end desc,
      case when p_sort = 'discount' and item.compare_at_price_cents is not null
        then 1 - (item.price_cents::numeric / item.compare_at_price_cents) end desc,
      case when p_sort = 'name_asc' then item.display_name end asc,
      case when p_sort = 'name_desc' then item.display_name end desc,
      item.featured desc, item.sold_count desc, item.created_at desc,
      item.product_id, item.image_path
    ) as display_position from filtered item
  ), page_rows as (
    select * from ordered order by display_position
    limit greatest(1, least(p_page_size, 48))
    offset ((greatest(1, p_page) - 1) * greatest(1, least(p_page_size, 48)))
  ), category_facets as (
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'value', slug, 'label', name, 'count', amount) order by name) value
    from (
      select category.slug, category.name, pg_catalog.count(distinct item.storefront_key)::integer amount
      from filtered item
      join public.product_categories link on link.product_id = item.product_id
      join public.categories category on category.id = link.category_id and category.active
      group by category.slug, category.name
    ) options
  ), collection_facets as (
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'value', collection_slug, 'label', collection, 'count', amount) order by collection) value
    from (select collection_slug, collection, pg_catalog.count(distinct storefront_key)::integer amount
      from filtered where collection_slug <> '' group by collection_slug, collection) options
  ), color_facets as (
    select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object('value', color, 'label', color, 'count', amount)
        || case when hex is null then '{}'::jsonb else pg_catalog.jsonb_build_object('hex', hex) end
      order by color) value
    from (
      select pg_catalog.min(color) color, pg_catalog.max(hex) hex,
        pg_catalog.count(distinct storefront_key)::integer amount
      from (
        select item.storefront_key,
          pg_catalog.btrim(pg_catalog.regexp_replace(variant.color_name, '[[:space:]]+', ' ', 'g')) color,
          pg_catalog.lower(pg_catalog.btrim(pg_catalog.regexp_replace(variant.color_name, '[[:space:]]+', ' ', 'g'))) color_key,
          case when pg_catalog.btrim(variant.color_hex::text) ~ '^#[0-9A-Fa-f]{6}$'
            then pg_catalog.btrim(variant.color_hex::text) end hex
        from scoped item
        join public.product_variants variant on variant.product_id = item.product_id
          and variant.active and (pg_catalog.cardinality(item.colors) = 0 or variant.color_name = any(item.colors))
        join public.inventory inventory on inventory.variant_id = variant.id
          and inventory.available_quantity - inventory.reserved_quantity > 0
        where pg_catalog.cardinality(p_sizes) = 0 or variant.size = any(p_sizes)
      ) candidates group by color_key
    ) options
  ), size_facets as (
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'value', size, 'label', size, 'count', amount) order by size) value
    from (
      select variant.size, pg_catalog.count(distinct item.storefront_key)::integer amount
      from scoped item
      join public.product_variants variant on variant.product_id = item.product_id
        and variant.active and (pg_catalog.cardinality(item.colors) = 0 or variant.color_name = any(item.colors))
      join public.inventory inventory on inventory.variant_id = variant.id
        and inventory.available_quantity - inventory.reserved_quantity > 0
      where pg_catalog.cardinality(p_colors) = 0 or exists (
        select 1 from pg_catalog.unnest(p_colors) requested(color)
        where pg_catalog.lower(pg_catalog.btrim(pg_catalog.regexp_replace(variant.color_name, '[[:space:]]+', ' ', 'g')))
          = pg_catalog.lower(pg_catalog.btrim(pg_catalog.regexp_replace(requested.color, '[[:space:]]+', ' ', 'g')))
      ) group by variant.size
    ) options
  )
  select pg_catalog.jsonb_build_object(
    'products', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', product_id, 'storefrontKey', storefront_key, 'variantId', variant_id,
      'sku', sku, 'variantColor', variant_color, 'variantSize', variant_size,
      'slug', slug, 'name', display_name, 'category', category, 'categorySlug', category_slug,
      'description', description, 'priceInCents', price_cents,
      'compareAtPriceInCents', compare_at_price_cents, 'rating', rating,
      'reviews', reviews, 'colors', colors, 'sizes', sizes,
      'imagePath', image_path, 'featured', featured, 'stock', stock
    ) order by display_position) from page_rows), '[]'::jsonb),
    'total', (select pg_catalog.count(*) from filtered),
    'facets', pg_catalog.jsonb_build_object(
      'categories', coalesce((select value from category_facets), '[]'::jsonb),
      'collections', coalesce((select value from collection_facets), '[]'::jsonb),
      'colors', coalesce((select value from color_facets), '[]'::jsonb),
      'sizes', coalesce((select value from size_facets), '[]'::jsonb),
      'price', pg_catalog.jsonb_build_object(
        'min', coalesce((select pg_catalog.min(price_cents) from filtered), 0),
        'max', coalesce((select pg_catalog.max(price_cents) from filtered), 0)),
      'promotionCount', (select pg_catalog.count(*) from filtered where compare_at_price_cents is not null),
      'inStockCount', (select pg_catalog.count(*) from filtered where stock > 0),
      'newestCount', (select pg_catalog.count(*) from filtered where featured)
    )
  );
$$;

revoke all on function public.search_catalog(text, text, text, text[], text[], integer, integer,
  boolean, boolean, boolean, numeric, text, integer, integer) from public;
grant execute on function public.search_catalog(text, text, text, text[], text[], integer, integer,
  boolean, boolean, boolean, numeric, text, integer, integer) to anon, authenticated;

notify pgrst, 'reload schema';

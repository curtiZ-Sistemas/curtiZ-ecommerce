-- Pesquisa pública paginada do catálogo. Expõe somente dados comerciais necessários à loja.

create index if not exists products_catalog_filter_idx
  on public.products(status, category_id, featured, base_price, created_at desc);
create index if not exists product_variants_catalog_filter_idx
  on public.product_variants(product_id, active, color_name, size);

alter table public.products
  add column if not exists compare_at_price numeric(12,2)
  check (compare_at_price is null or compare_at_price > base_price);

create index if not exists products_active_promotion_idx
  on public.products(compare_at_price desc)
  where status = 'active' and compare_at_price is not null;

create or replace function public.search_catalog(
  p_query text default null,
  p_category text default null,
  p_collection text default null,
  p_colors text[] default '{}'::text[],
  p_sizes text[] default '{}'::text[],
  p_price_min integer default null,
  p_price_max integer default null,
  p_promotion boolean default false,
  p_in_stock boolean default false,
  p_featured boolean default false,
  p_min_rating numeric default null,
  p_sort text default 'relevant',
  p_page integer default 1,
  p_page_size integer default 12
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with product_data as (
    select
      p.id,
      p.slug,
      p.name,
      c.name as category,
      c.slug as category_slug,
      coalesce(collection.name, '') as collection,
      coalesce(collection.slug, '') as collection_slug,
      p.short_description as description,
      round(p.base_price * 100)::integer as price_cents,
      case
        when p.compare_at_price is not null then round(p.compare_at_price * 100)::integer
        else null
      end as compare_at_price_cents,
      p.featured,
      p.created_at,
      coalesce((
        select array_agg(distinct variant.color_name order by variant.color_name)
        from public.product_variants variant
        where variant.product_id = p.id and variant.active
      ), '{}'::text[]) as colors,
      coalesce((
        select array_agg(distinct variant.size order by variant.size)
        from public.product_variants variant
        where variant.product_id = p.id and variant.active
      ), '{}'::text[]) as sizes,
      coalesce((
        select sum(greatest(stock.available_quantity - stock.reserved_quantity, 0))::integer
        from public.product_variants variant
        join public.inventory stock on stock.variant_id = variant.id
        where variant.product_id = p.id and variant.active
      ), 0) as stock,
      coalesce((
        select round(avg(review.rating)::numeric, 1)
        from public.reviews review
        where review.product_id = p.id and review.status = 'approved'
      ), 0) as rating,
      coalesce((
        select count(*)::integer
        from public.reviews review
        where review.product_id = p.id and review.status = 'approved'
      ), 0) as reviews,
      coalesce((
        select sum(item.quantity)::integer
        from public.order_items item
        join public.orders sale on sale.id = item.order_id
        where item.product_id = p.id and sale.payment_status = 'approved'
      ), 0) as sold_count,
      (
        select image.storage_path
        from public.product_images image
        where image.product_id = p.id
        order by image.is_primary desc, image.sort_order, image.created_at
        limit 1
      ) as image_path
    from public.products p
    join public.categories c on c.id = p.category_id and c.active
    left join public.collections collection on collection.id = p.collection_id
    where p.status = 'active'
      and (
        nullif(trim(p_query), '') is null
        or p.search_document @@ websearch_to_tsquery('simple', trim(p_query))
        or p.name ilike ('%' || trim(p_query) || '%')
      )
      and (
        nullif(trim(p_category), '') is null
        or lower(c.slug) = lower(trim(p_category))
        or lower(c.name) = lower(trim(p_category))
      )
      and (
        nullif(trim(p_collection), '') is null
        or lower(coalesce(collection.slug, '')) = lower(trim(p_collection))
      )
  ),
  filtered as (
    select *
    from product_data product
    where (cardinality(p_colors) = 0 or product.colors && p_colors)
      and (cardinality(p_sizes) = 0 or product.sizes && p_sizes)
      and (p_price_min is null or product.price_cents >= p_price_min)
      and (p_price_max is null or product.price_cents <= p_price_max)
      and (not p_promotion or product.compare_at_price_cents is not null)
      and (not p_in_stock or product.stock > 0)
      and (not p_featured or product.featured)
      and (p_min_rating is null or product.rating >= p_min_rating)
  ),
  ordered as (
    select *
    from filtered
    order by
      case when p_sort = 'price_asc' then price_cents end asc,
      case when p_sort = 'price_desc' then price_cents end desc,
      case when p_sort = 'newest' then created_at end desc,
      case when p_sort = 'best_sellers' then sold_count end desc,
      case when p_sort = 'rating' then rating end desc,
      case
        when p_sort = 'discount' and compare_at_price_cents is not null
          then 1 - (price_cents::numeric / compare_at_price_cents)
      end desc,
      case when p_sort = 'name_asc' then name end asc,
      case when p_sort = 'name_desc' then name end desc,
      featured desc,
      sold_count desc,
      created_at desc,
      id
  ),
  page_rows as (
    select *
    from ordered
    limit greatest(1, least(p_page_size, 48))
    offset ((greatest(1, p_page) - 1) * greatest(1, least(p_page_size, 48)))
  ),
  category_facets as (
    select jsonb_agg(
      jsonb_build_object('value', category_slug, 'label', category, 'count', amount)
      order by category
    ) as value
    from (
      select category_slug, category, count(*)::integer as amount
      from product_data
      group by category_slug, category
    ) options
  ),
  collection_facets as (
    select jsonb_agg(
      jsonb_build_object('value', collection_slug, 'label', collection, 'count', amount)
      order by collection
    ) as value
    from (
      select collection_slug, collection, count(*)::integer as amount
      from product_data
      where collection_slug <> ''
      group by collection_slug, collection
    ) options
  ),
  color_facets as (
    select jsonb_agg(
      jsonb_build_object('value', color, 'label', color, 'count', amount)
      order by color
    ) as value
    from (
      select color, count(*)::integer as amount
      from product_data, unnest(colors) color
      group by color
    ) options
  ),
  size_facets as (
    select jsonb_agg(
      jsonb_build_object('value', size, 'label', size, 'count', amount)
      order by size
    ) as value
    from (
      select size, count(*)::integer as amount
      from product_data, unnest(sizes) size
      group by size
    ) options
  )
  select jsonb_build_object(
    'products',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', id,
          'slug', slug,
          'name', name,
          'category', category,
          'description', description,
          'priceInCents', price_cents,
          'compareAtPriceInCents', compare_at_price_cents,
          'rating', rating,
          'reviews', reviews,
          'colors', colors,
          'sizes', sizes,
          'imagePath', image_path,
          'featured', featured,
          'stock', stock
        )
      )
      from page_rows
    ), '[]'::jsonb),
    'total', (select count(*) from filtered),
    'facets', jsonb_build_object(
      'categories', coalesce((select value from category_facets), '[]'::jsonb),
      'collections', coalesce((select value from collection_facets), '[]'::jsonb),
      'colors', coalesce((select value from color_facets), '[]'::jsonb),
      'sizes', coalesce((select value from size_facets), '[]'::jsonb),
      'price', jsonb_build_object(
        'min', coalesce((select min(price_cents) from product_data), 0),
        'max', coalesce((select max(price_cents) from product_data), 0)
      ),
      'promotionCount', (select count(*) from product_data where compare_at_price_cents is not null),
      'inStockCount', (select count(*) from product_data where stock > 0),
      'newestCount', (select count(*) from product_data where featured)
    )
  );
$$;

revoke all on function public.search_catalog(
  text, text, text, text[], text[], integer, integer, boolean, boolean, boolean, numeric, text, integer, integer
) from public;
grant execute on function public.search_catalog(
  text, text, text, text[], text[], integer, integer, boolean, boolean, boolean, numeric, text, integer, integer
) to anon, authenticated;

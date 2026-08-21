-- Home profissional: ranking real por período e suporte às seções já versionadas pelo construtor.

create index if not exists order_items_homepage_sales_idx
  on public.order_items(order_id, product_id);

create index if not exists orders_homepage_approved_sales_idx
  on public.orders(placed_at desc, id)
  where payment_status = 'approved'
    and status not in ('cancelled', 'returned', 'refund_pending', 'refunded');

create or replace function public.get_homepage_best_sellers(
  p_period text default '90d',
  p_metric text default 'units',
  p_limit integer default 8,
  p_fill boolean default true,
  p_in_stock boolean default true
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with parameters as (
    select
      case when p_period in ('30d', '90d', 'all') then p_period else '90d' end as sales_period,
      case when p_metric in ('units', 'revenue') then p_metric else 'units' end as ranking_metric,
      greatest(1, least(coalesce(p_limit, 8), 24)) as result_limit
  ),
  qualified_sales as (
    select
      item.product_id,
      sum(item.quantity)::bigint as units_sold,
      sum(item.total)::numeric as revenue
    from public.order_items item
    join public.orders sale on sale.id = item.order_id
    cross join parameters config
    where sale.payment_status = 'approved'
      and sale.status not in ('cancelled', 'returned', 'refund_pending', 'refunded')
      and sale.placed_at is not null
      and (
        config.sales_period = 'all'
        or sale.placed_at >= now() - case config.sales_period
          when '30d' then interval '30 days'
          else interval '90 days'
        end
      )
    group by item.product_id
  ),
  eligible as (
    select
      product.id,
      product.slug,
      product.name,
      category.name as category,
      coalesce(product.short_description, '') as description,
      round(product.base_price * 100)::integer as price_cents,
      case when product.compare_at_price is null then null else round(product.compare_at_price * 100)::integer end as compare_at_price_cents,
      product.featured,
      variants.colors,
      variants.sizes,
      variants.stock,
      coalesce(review_summary.rating, 0) as rating,
      coalesce(review_summary.reviews, 0) as reviews,
      image.storage_path as image_path,
      coalesce(sales.units_sold, 0) as units_sold,
      coalesce(sales.revenue, 0) as revenue
    from public.products product
    join public.categories category on category.id = product.category_id and category.active
    join lateral (
      select
        array_agg(distinct variant.color_name order by variant.color_name) as colors,
        array_agg(distinct variant.size order by variant.size) as sizes,
        coalesce(sum(greatest(coalesce(stock.available_quantity, 0) - coalesce(stock.reserved_quantity, 0), 0)), 0)::integer as stock
      from public.product_variants variant
      left join public.inventory stock on stock.variant_id = variant.id
      where variant.product_id = product.id and variant.active
      having count(*) > 0
    ) variants on true
    join lateral (
      select product_image.storage_path
      from public.product_images product_image
      where product_image.product_id = product.id
        and nullif(trim(product_image.storage_path), '') is not null
      order by product_image.is_primary desc, product_image.sort_order, product_image.created_at
      limit 1
    ) image on true
    left join lateral (
      select round(avg(review.rating)::numeric, 1) as rating, count(*)::integer as reviews
      from public.reviews review
      where review.product_id = product.id and review.status = 'approved'
    ) review_summary on true
    left join qualified_sales sales on sales.product_id = product.id
    where product.status = 'active'
      and (not p_in_stock or variants.stock > 0)
      and (p_fill or coalesce(sales.units_sold, 0) > 0)
  ),
  ranked as (
    select candidate.*
    from eligible candidate
    cross join parameters config
    order by
      case when candidate.units_sold > 0 then 0 else 1 end,
      case when config.ranking_metric = 'units' then candidate.units_sold end desc,
      case when config.ranking_metric = 'revenue' then candidate.revenue end desc,
      candidate.units_sold desc,
      md5(candidate.id::text || ':curtiz-home-fallback')
    limit (select result_limit from parameters)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', ranked.id,
    'slug', ranked.slug,
    'name', ranked.name,
    'category', ranked.category,
    'description', ranked.description,
    'priceInCents', ranked.price_cents,
    'compareAtPriceInCents', ranked.compare_at_price_cents,
    'rating', ranked.rating,
    'reviews', ranked.reviews,
    'colors', ranked.colors,
    'sizes', ranked.sizes,
    'imagePath', ranked.image_path,
    'featured', ranked.featured,
    'stock', ranked.stock
  ) order by
    case when ranked.units_sold > 0 then 0 else 1 end,
    case when (select ranking_metric from parameters) = 'units' then ranked.units_sold end desc,
    case when (select ranking_metric from parameters) = 'revenue' then ranked.revenue end desc,
    ranked.units_sold desc,
    md5(ranked.id::text || ':curtiz-home-fallback')
  ), '[]'::jsonb)
  from ranked;
$$;

revoke all on function public.get_homepage_best_sellers(text, text, integer, boolean, boolean)
  from public;
grant execute on function public.get_homepage_best_sellers(text, text, integer, boolean, boolean)
  to anon, authenticated;

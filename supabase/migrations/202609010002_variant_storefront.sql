-- Vitrine virtual por variação. Produtos reais, vendas e avaliações continuam
-- agregados por product_id; apenas a projeção pública ganha variant_id quando há
-- imagem explicitamente vinculada a uma variação ativa.

create index if not exists product_images_variant_storefront_idx
  on public.product_images(product_id, variant_id, is_primary desc, sort_order, created_at)
  where variant_id is not null;

create or replace function private.storefront_catalog_items()
returns table (
  product_id uuid,
  variant_id uuid,
  storefront_key text,
  slug text,
  display_name text,
  base_name text,
  category_id uuid,
  category text,
  category_slug text,
  collection text,
  collection_slug text,
  model_slug text,
  description text,
  price_cents integer,
  compare_at_price_cents integer,
  featured boolean,
  created_at timestamptz,
  colors text[],
  sizes text[],
  stock integer,
  rating numeric,
  reviews integer,
  sold_count integer,
  image_path text,
  sku text,
  variant_color text,
  variant_size text
)
language sql
stable
security definer
set search_path = ''
as $$
  with product_data as (
    select
      product.id,
      product.slug,
      product.name,
      category.id as category_id,
      category.name as category,
      category.slug as category_slug,
      coalesce(collection.name, '') as collection,
      coalesce(collection.slug, '') as collection_slug,
      coalesce(model.slug, '') as model_slug,
      product.short_description as description,
      product.base_price,
      product.compare_at_price,
      product.featured,
      product.created_at,
      coalesce(variants.colors, '{}'::text[]) as colors,
      coalesce(variants.sizes, '{}'::text[]) as sizes,
      coalesce(variants.stock, 0) as stock,
      coalesce(review_summary.rating, 0) as rating,
      coalesce(review_summary.reviews, 0) as reviews,
      coalesce(sales.sold_count, 0) as sold_count,
      generic_image.storage_path as generic_image_path
    from public.products product
    join public.categories category on category.id = product.category_id and category.active
    left join public.collections collection on collection.id = product.collection_id
    left join public.product_models model on model.id = product.model_id
    left join lateral (
      select
        array_agg(distinct variant.color_name order by variant.color_name) as colors,
        array_agg(distinct variant.size order by variant.size) as sizes,
        sum(greatest(coalesce(inventory.available_quantity, 0) - coalesce(inventory.reserved_quantity, 0), 0))::integer as stock
      from public.product_variants variant
      left join public.inventory inventory on inventory.variant_id = variant.id
      where variant.product_id = product.id and variant.active
    ) variants on true
    left join lateral (
      select round(avg(review.rating)::numeric, 1) as rating, count(*)::integer as reviews
      from public.reviews review
      where review.product_id = product.id and review.status = 'approved'
    ) review_summary on true
    left join lateral (
      select sum(item.quantity)::integer as sold_count
      from public.order_items item
      join public.orders sale on sale.id = item.order_id
      where item.product_id = product.id
        and sale.payment_status = 'approved'
        and sale.status not in ('cancelled', 'returned', 'refund_pending', 'refunded')
    ) sales on true
    left join lateral (
      select image.storage_path
      from public.product_images image
      where image.product_id = product.id
        and image.variant_id is null
        and nullif(trim(image.storage_path), '') is not null
      order by image.is_primary desc, image.sort_order, image.created_at
      limit 1
    ) generic_image on true
    where product.status = 'active'
  ),
  visual_variants as (
    select
      product.id as product_id,
      variant.id as variant_id,
      product.id::text || ':' || variant.id::text as storefront_key,
      product.slug,
      product.name || ' — ' || variant.color_name || case
        when count(*) over(partition by product.id, lower(variant.color_name)) > 1
          then ' — ' || variant.size
        else ''
      end as display_name,
      product.name as base_name,
      product.category_id,
      product.category,
      product.category_slug,
      product.collection,
      product.collection_slug,
      product.model_slug,
      product.description,
      round(coalesce(variant.price_override, product.base_price) * 100)::integer as price_cents,
      case
        when product.compare_at_price > coalesce(variant.price_override, product.base_price)
          then round(product.compare_at_price * 100)::integer
        else null
      end as compare_at_price_cents,
      product.featured,
      product.created_at,
      array[variant.color_name]::text[] as colors,
      array[variant.size]::text[] as sizes,
      greatest(coalesce(inventory.available_quantity, 0) - coalesce(inventory.reserved_quantity, 0), 0)::integer as stock,
      product.rating,
      product.reviews,
      product.sold_count,
      variant_image.storage_path as image_path,
      variant.sku::text as sku,
      variant.color_name as variant_color,
      variant.size as variant_size
    from product_data product
    join public.product_variants variant on variant.product_id = product.id and variant.active
    left join public.inventory inventory on inventory.variant_id = variant.id
    join lateral (
      select image.storage_path
      from public.product_images image
      where image.product_id = product.id
        and image.variant_id = variant.id
        and nullif(trim(image.storage_path), '') is not null
        and image.width > 0 and image.height > 0
      order by image.is_primary desc, image.sort_order, image.created_at
      limit 1
    ) variant_image on true
  ),
  fallback_products as (
    select
      product.id as product_id,
      null::uuid as variant_id,
      product.id::text || ':product' as storefront_key,
      product.slug,
      product.name as display_name,
      product.name as base_name,
      product.category_id,
      product.category,
      product.category_slug,
      product.collection,
      product.collection_slug,
      product.model_slug,
      product.description,
      round(product.base_price * 100)::integer as price_cents,
      case when product.compare_at_price > product.base_price
        then round(product.compare_at_price * 100)::integer else null end as compare_at_price_cents,
      product.featured,
      product.created_at,
      product.colors,
      product.sizes,
      product.stock,
      product.rating,
      product.reviews,
      product.sold_count,
      product.generic_image_path as image_path,
      null::text as sku,
      null::text as variant_color,
      null::text as variant_size
    from product_data product
    where not exists (
      select 1 from visual_variants visual where visual.product_id = product.id
    )
  )
  select * from visual_variants
  union all
  select * from fallback_products;
$$;

revoke all on function private.storefront_catalog_items() from public, anon, authenticated;

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
    select item.*
    from private.storefront_catalog_items() item
    where (
      nullif(trim(p_query), '') is null
      or to_tsvector('simple', concat_ws(' ', item.base_name, item.description, item.category,
          item.variant_color, item.variant_size, item.sku))
        @@ websearch_to_tsquery('simple', trim(p_query))
      or concat_ws(' ', item.base_name, item.variant_color, item.variant_size, item.sku)
        ilike ('%' || trim(p_query) || '%')
    )
    and (nullif(trim(p_category), '') is null
      or lower(item.category_slug) = lower(trim(p_category))
      or lower(item.category) = lower(trim(p_category)))
    and (nullif(trim(p_collection), '') is null
      or lower(item.collection_slug) = lower(trim(p_collection)))
  ),
  filtered as (
    select * from product_data item
    where (cardinality(p_colors) = 0 or item.colors && p_colors)
      and (cardinality(p_sizes) = 0 or item.sizes && p_sizes)
      and (p_price_min is null or item.price_cents >= p_price_min)
      and (p_price_max is null or item.price_cents <= p_price_max)
      and (not p_promotion or item.compare_at_price_cents is not null)
      and (not p_in_stock or item.stock > 0)
      and (not p_featured or item.featured)
      and (p_min_rating is null or item.rating >= p_min_rating)
  ),
  ordered as (
    select item.*,
      row_number() over(order by
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
        item.product_id, item.variant_id nulls first
      ) as display_position
    from filtered item
  ),
  page_rows as (
    select * from ordered
    order by display_position
    limit greatest(1, least(p_page_size, 48))
    offset ((greatest(1, p_page) - 1) * greatest(1, least(p_page_size, 48)))
  ),
  category_facets as (
    select jsonb_agg(jsonb_build_object('value', category_slug, 'label', category, 'count', amount) order by category) value
    from (select category_slug, category, count(*)::integer amount from product_data group by category_slug, category) options
  ),
  collection_facets as (
    select jsonb_agg(jsonb_build_object('value', collection_slug, 'label', collection, 'count', amount) order by collection) value
    from (select collection_slug, collection, count(*)::integer amount from product_data where collection_slug <> '' group by collection_slug, collection) options
  ),
  color_facets as (
    select jsonb_agg(jsonb_build_object('value', color, 'label', color, 'count', amount) order by color) value
    from (select color, count(*)::integer amount from product_data, unnest(colors) color group by color) options
  ),
  size_facets as (
    select jsonb_agg(jsonb_build_object('value', size, 'label', size, 'count', amount) order by size) value
    from (select size, count(*)::integer amount from product_data, unnest(sizes) size group by size) options
  )
  select jsonb_build_object(
    'products', coalesce((select jsonb_agg(jsonb_build_object(
      'id', product_id, 'storefrontKey', storefront_key, 'variantId', variant_id,
      'sku', sku, 'variantColor', variant_color, 'variantSize', variant_size,
      'slug', slug, 'name', display_name, 'category', category,
      'description', description, 'priceInCents', price_cents,
      'compareAtPriceInCents', compare_at_price_cents, 'rating', rating,
      'reviews', reviews, 'colors', colors, 'sizes', sizes,
      'imagePath', image_path, 'featured', featured, 'stock', stock
    ) order by display_position) from page_rows), '[]'::jsonb),
    'total', (select count(*) from filtered),
    'facets', jsonb_build_object(
      'categories', coalesce((select value from category_facets), '[]'::jsonb),
      'collections', coalesce((select value from collection_facets), '[]'::jsonb),
      'colors', coalesce((select value from color_facets), '[]'::jsonb),
      'sizes', coalesce((select value from size_facets), '[]'::jsonb),
      'price', jsonb_build_object('min', coalesce((select min(price_cents) from product_data), 0),
        'max', coalesce((select max(price_cents) from product_data), 0)),
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

create or replace function public.get_model_storefront_items(
  p_model_slug text,
  p_limit integer default 48
) returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', item.product_id, 'storefrontKey', item.storefront_key,
    'variantId', item.variant_id, 'sku', item.sku,
    'variantColor', item.variant_color, 'variantSize', item.variant_size,
    'slug', item.slug, 'name', item.display_name, 'category', item.category,
    'description', item.description, 'priceInCents', item.price_cents,
    'compareAtPriceInCents', item.compare_at_price_cents,
    'rating', item.rating, 'reviews', item.reviews, 'colors', item.colors,
    'sizes', item.sizes, 'imagePath', item.image_path,
    'featured', item.featured, 'stock', item.stock
  ) order by item.featured desc, item.created_at desc, item.storefront_key), '[]'::jsonb)
  from (
    select candidate.* from private.storefront_catalog_items() candidate
    where lower(candidate.model_slug) = lower(trim(p_model_slug))
    order by candidate.featured desc, candidate.created_at desc, candidate.storefront_key
    limit greatest(1, least(coalesce(p_limit, 48), 48))
  ) item;
$$;

revoke all on function public.get_model_storefront_items(text,integer) from public;
grant execute on function public.get_model_storefront_items(text,integer) to anon,authenticated;

-- Favoritos preservam a seleção visual sem duplicar produto.
alter table public.favorites add column variant_id uuid references public.product_variants(id) on delete cascade;
alter table public.favorites add column id uuid not null default gen_random_uuid();
alter table public.favorites drop constraint favorites_pkey;
alter table public.favorites add constraint favorites_pkey primary key(id);
alter table public.favorites add column selection_key text generated always as (
  coalesce(variant_id::text, 'product')
) stored;
alter table public.favorites add constraint favorites_customer_product_variant_key
  unique(customer_id, product_id, selection_key);
drop policy if exists "customer owns favorites" on public.favorites;
create policy "customer owns favorites" on public.favorites
  for all to authenticated
  using (customer_id = auth.uid() and private.is_active_user())
  with check (
    customer_id = auth.uid()
    and private.is_active_user()
    and (
      variant_id is null
      or exists (
        select 1 from public.product_variants variant
        where variant.id = variant_id
          and variant.product_id = product_id
          and variant.active
      )
    )
  );

alter table public.session_interest_profiles
  add column color_scores jsonb not null default '{}'::jsonb;

create or replace function private.aggregate_variant_storefront_interest()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_variant_id uuid;
  v_color text;
  v_scores jsonb;
  v_existing numeric;
begin
  if new.product_id is null or new.event_weight = 0 then return new; end if;
  v_variant_id := nullif(new.context_sanitized->>'variantId', '')::uuid;
  if v_variant_id is null then return new; end if;

  select lower(trim(variant.color_name)) into v_color
  from public.product_variants variant
  where variant.id = v_variant_id
    and variant.product_id = new.product_id
    and variant.active;
  if coalesce(v_color, '') = '' then return new; end if;

  select profile.color_scores into v_scores
  from public.session_interest_profiles profile
  where profile.session_id = new.anonymous_session_id
  for update;
  if not found then return new; end if;

  v_scores := coalesce(v_scores, '{}'::jsonb);
  v_existing := coalesce((v_scores->>v_color)::numeric, 0) + new.event_weight;
  update public.session_interest_profiles
  set color_scores = jsonb_set(v_scores, array[v_color], to_jsonb(round(v_existing, 3)), true)
  where session_id = new.anonymous_session_id;
  return new;
end;
$$;

drop trigger if exists zz_aggregate_variant_storefront_interest on public.marketing_events;
create trigger zz_aggregate_variant_storefront_interest
after insert on public.marketing_events
for each row when (new.product_id is not null and new.event_weight <> 0)
execute function private.aggregate_variant_storefront_interest();

-- Recomendações escolhem no máximo uma apresentação por produto. Eventos
-- continuam agregados no produto real e carregam variantId apenas como contexto.
create or replace function public.get_intelligence_recommendations(
  p_source text default 'personalized', p_session_id uuid default null, p_category text default null,
  p_seen uuid[] default '{}'::uuid[], p_seed text default 'curtiz', p_limit integer default 8,
  p_price_min integer default null, p_price_max integer default null, p_only uuid[] default '{}'::uuid[]
) returns jsonb language sql stable security definer set search_path = ''
as $$
with config as (select greatest(1,least(coalesce(p_limit,8),24)) result_limit),
profile as (select category_scores,color_scores,price_min_cents,price_max_cents from public.session_interest_profiles where session_id=p_session_id and expires_at>now()),
signals as (
 select metric.product_id,
  sum((metric.views+metric.image_interactions*1.5+metric.variant_selections*2+metric.favorite_adds*4+metric.cart_adds*6+metric.recommendation_clicks*2.5+metric.units_sold*12)
      /(1+greatest(0,current_date-metric.metric_date)::numeric/7)) score,
  sum(metric.views) views,sum(metric.favorite_adds) favorites,sum(metric.units_sold) sold,
  sum(case when metric.metric_date>=current_date-1 then metric.views+metric.favorite_adds*4+metric.cart_adds*6+metric.recommendation_clicks*2.5+metric.units_sold*12 else 0 end) trending_score
 from public.product_metrics_daily metric where metric.metric_date>=current_date-30 group by metric.product_id
), candidates as (
 select item.*,
  row_number() over(partition by item.product_id order by
    case when item.stock > 0 then 0 else 1 end,
    coalesce((select (profile.color_scores->>lower(item.variant_color))::numeric from profile),0) desc,
    md5(item.storefront_key || ':' || p_seed)) as variant_rank
 from private.storefront_catalog_items() item
 where private.intelligence_flag_enabled('intelligence.recommendations')
  and (p_source<>'discovery' or private.intelligence_flag_enabled('intelligence.discovery'))
  and item.stock>0
  and not(item.product_id=any(coalesce(p_seen,'{}'::uuid[])))
  and (cardinality(coalesce(p_only,'{}'::uuid[]))=0 or item.product_id=any(p_only))
  and (p_category is null or lower(item.category)=lower(p_category) or lower(item.category_slug)=lower(p_category))
  and (p_price_min is null or item.price_cents>=p_price_min)
  and (p_price_max is null or item.price_cents<=p_price_max)
), eligible as (
 select candidate.*,
  coalesce(signals.score,0) signal_score,coalesce(signals.views,0) views,
  coalesce(signals.favorites,0) favorites,coalesce(signals.sold,0) sold,
  coalesce(signals.trending_score,0) trending_score,
  coalesce((select (profile.category_scores->>candidate.category_id::text)::numeric from profile),0) affinity
 from candidates candidate left join signals on signals.product_id=candidate.product_id
 where candidate.variant_rank=1
), scored as (
 select eligible.*,
  case p_source when 'trending' then trending_score when 'most_wanted' then favorites*5+signal_score when 'most_viewed' then views*2+signal_score
    when 'newest' then greatest(0,30-extract(day from now()-created_at))*10+signal_score
    when 'price_range' then signal_score+affinity*3 else signal_score+affinity*10 end rank_score,
  row_number() over(partition by category_id order by signal_score desc,md5(product_id::text||p_seed)) category_rank
 from eligible
), ranked as (
 select * from scored order by case when category_rank<=4 then 0 else 1 end,
 rank_score desc,md5(product_id::text||p_seed) limit (select result_limit from config)
)
select coalesce(jsonb_agg(jsonb_build_object(
 'id',product_id,'storefrontKey',storefront_key,'variantId',variant_id,'sku',sku,
 'variantColor',variant_color,'variantSize',variant_size,'slug',slug,'name',display_name,
 'category',category,'description',description,'priceInCents',price_cents,
 'compareAtPriceInCents',compare_at_price_cents,'rating',rating,'reviews',reviews,
 'colors',colors,'sizes',sizes,'imagePath',image_path,'featured',featured,'stock',stock,
 'recommendationSource',p_source
) order by case when category_rank<=4 then 0 else 1 end,rank_score desc,md5(product_id::text||p_seed)),'[]'::jsonb) from ranked
$$;

revoke all on function public.get_intelligence_recommendations(text,uuid,text,uuid[],text,integer,integer,integer,uuid[]) from public;
grant execute on function public.get_intelligence_recommendations(text,uuid,text,uuid[],text,integer,integer,integer,uuid[]) to anon,authenticated;

-- Mais vendidos ranqueia uma vez por produto e apenas depois escolhe uma
-- apresentação visual, impedindo multiplicação artificial das vendas.
create or replace function public.get_homepage_best_sellers(
  p_period text default '90d', p_metric text default 'units', p_limit integer default 8,
  p_fill boolean default true, p_in_stock boolean default true
) returns jsonb language sql stable security definer set search_path = ''
as $$
with parameters as (
 select case when p_period in ('30d','90d','all') then p_period else '90d' end sales_period,
  case when p_metric in ('units','revenue') then p_metric else 'units' end ranking_metric,
  greatest(1,least(coalesce(p_limit,8),24)) result_limit
), qualified_sales as (
 select item.product_id,sum(item.quantity)::bigint units_sold,sum(item.total)::numeric revenue
 from public.order_items item join public.orders sale on sale.id=item.order_id cross join parameters config
 where sale.payment_status='approved'
  and sale.status not in ('cancelled','returned','refund_pending','refunded')
  and sale.placed_at is not null
  and (config.sales_period='all' or sale.placed_at>=now()-case config.sales_period when '30d' then interval '30 days' else interval '90 days' end)
 group by item.product_id
), candidates as (
 select item.*,coalesce(sales.units_sold,0) units_sold,coalesce(sales.revenue,0) revenue,
  row_number() over(partition by item.product_id order by case when item.stock>0 then 0 else 1 end,
    md5(item.storefront_key||':curtiz-home-variant')) variant_rank
 from private.storefront_catalog_items() item
 left join qualified_sales sales on sales.product_id=item.product_id
 where (not p_in_stock or item.stock>0) and (p_fill or coalesce(sales.units_sold,0)>0)
), ranked as (
 select candidate.* from candidates candidate cross join parameters config
 where candidate.variant_rank=1
 order by case when candidate.units_sold>0 then 0 else 1 end,
  case when config.ranking_metric='units' then candidate.units_sold end desc,
  case when config.ranking_metric='revenue' then candidate.revenue end desc,
  candidate.units_sold desc,md5(candidate.product_id::text||':curtiz-home-fallback')
 limit (select result_limit from parameters)
)
select coalesce(jsonb_agg(jsonb_build_object(
 'id',product_id,'storefrontKey',storefront_key,'variantId',variant_id,'sku',sku,
 'variantColor',variant_color,'variantSize',variant_size,'slug',slug,'name',display_name,
 'category',category,'description',description,'priceInCents',price_cents,
 'compareAtPriceInCents',compare_at_price_cents,'rating',rating,'reviews',reviews,
 'colors',colors,'sizes',sizes,'imagePath',image_path,'featured',featured,'stock',stock
) order by case when units_sold>0 then 0 else 1 end,
 case when (select ranking_metric from parameters)='units' then units_sold end desc,
 case when (select ranking_metric from parameters)='revenue' then revenue end desc,
 units_sold desc,md5(product_id::text||':curtiz-home-fallback')),'[]'::jsonb) from ranked
$$;

revoke all on function public.get_homepage_best_sellers(text,text,integer,boolean,boolean) from public;
grant execute on function public.get_homepage_best_sellers(text,text,integer,boolean,boolean) to anon,authenticated;

notify pgrst, 'reload schema';

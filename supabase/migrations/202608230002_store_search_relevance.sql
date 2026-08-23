-- Busca compacta do cabeçalho com ranking explícito e apenas produtos publicados.

create index if not exists product_variants_search_sku_idx
  on public.product_variants (lower(sku::text))
  where active;

create index if not exists product_variants_search_color_idx
  on public.product_variants (lower(color_name))
  where active;

create or replace function public.search_catalog_suggestions(
  p_query text,
  p_limit integer default 5
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with input as (
    select lower(extensions.unaccent(left(trim(coalesce(p_query, '')), 100))) as term
  ),
  ranked as (
    select
      p.id,
      p.slug,
      p.name,
      category.name as category,
      p.short_description as description,
      p.base_price,
      p.compare_at_price,
      p.featured,
      p.created_at,
      case
        when lower(extensions.unaccent(p.name)) = input.term then 0
        when lower(extensions.unaccent(p.name)) like input.term || '%' then 1
        when lower(extensions.unaccent(p.name)) like '%' || input.term || '%' then 2
        when lower(extensions.unaccent(category.name)) = input.term
          or lower(extensions.unaccent(coalesce(model.name, ''))) = input.term then 3
        when lower(extensions.unaccent(category.name)) like input.term || '%'
          or lower(extensions.unaccent(coalesce(model.name, ''))) like input.term || '%' then 4
        when exists (
          select 1 from public.product_variants variant
          where variant.product_id = p.id and variant.active
            and (
              lower(extensions.unaccent(variant.color_name)) like '%' || input.term || '%'
              or lower(variant.sku::text) like input.term || '%'
            )
        ) then 5
        else 6
      end as relevance
    from public.products p
    join public.categories category on category.id = p.category_id and category.active
    left join public.product_models model on model.id = p.model_id and model.active
    cross join input
    where input.term <> ''
      and p.status = 'active'
      and (
        lower(extensions.unaccent(p.name)) like '%' || input.term || '%'
        or lower(extensions.unaccent(category.name)) like '%' || input.term || '%'
        or lower(extensions.unaccent(coalesce(model.name, ''))) like '%' || input.term || '%'
        or p.search_document @@ websearch_to_tsquery('simple', input.term)
        or exists (
          select 1 from public.product_variants variant
          where variant.product_id = p.id and variant.active
            and (
              lower(extensions.unaccent(variant.color_name)) like '%' || input.term || '%'
              or lower(variant.sku::text) like '%' || input.term || '%'
              or lower(variant.size) = input.term
            )
        )
      )
    order by relevance, p.featured desc, p.created_at desc, p.id
    limit greatest(1, least(coalesce(p_limit, 5), 8))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', ranked.id,
    'slug', ranked.slug,
    'name', ranked.name,
    'category', ranked.category,
    'description', ranked.description,
    'priceInCents', round(ranked.base_price * 100)::integer,
    'compareAtPriceInCents', case when ranked.compare_at_price is null then null else round(ranked.compare_at_price * 100)::integer end,
    'rating', coalesce(details.rating, 0),
    'reviews', coalesce(details.reviews, 0),
    'colors', coalesce(details.colors, '[]'::jsonb),
    'sizes', coalesce(details.sizes, '[]'::jsonb),
    'imagePath', details.image_path,
    'featured', ranked.featured,
    'stock', coalesce(details.stock, 0)
  ) order by ranked.relevance, ranked.featured desc, ranked.created_at desc, ranked.id), '[]'::jsonb)
  from ranked
  left join lateral (
    select
      (select round(avg(review.rating)::numeric, 1) from public.reviews review where review.product_id = ranked.id and review.status = 'approved') as rating,
      (select count(*)::integer from public.reviews review where review.product_id = ranked.id and review.status = 'approved') as reviews,
      (select jsonb_agg(distinct variant.color_name) from public.product_variants variant where variant.product_id = ranked.id and variant.active) as colors,
      (select jsonb_agg(distinct variant.size) from public.product_variants variant where variant.product_id = ranked.id and variant.active) as sizes,
      (select sum(greatest(stock.available_quantity - stock.reserved_quantity, 0))::integer from public.product_variants variant join public.inventory stock on stock.variant_id = variant.id where variant.product_id = ranked.id and variant.active) as stock,
      (select image.storage_path from public.product_images image where image.product_id = ranked.id order by image.is_primary desc, image.sort_order, image.created_at limit 1) as image_path
  ) details on true;
$$;

revoke all on function public.search_catalog_suggestions(text, integer) from public;
grant execute on function public.search_catalog_suggestions(text, integer) to anon, authenticated;

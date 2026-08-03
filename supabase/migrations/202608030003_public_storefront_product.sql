-- Detalhe público de produto com variantes, mídia, estoque e avaliações aprovadas.

create or replace function public.get_catalog_product(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with target as (
    select
      product.id,
      product.slug,
      product.name,
      category.name as category,
      product.description,
      round(product.base_price * 100)::integer as price_cents,
      case
        when product.compare_at_price is not null
          then round(product.compare_at_price * 100)::integer
        else null
      end as compare_at_price_cents,
      product.featured,
      product.weight_grams,
      product.height_cm,
      product.width_cm,
      product.length_cm
    from public.products product
    join public.categories category
      on category.id = product.category_id
      and category.active
    where product.status = 'active'
      and product.slug = trim(p_slug)
    limit 1
  )
  select jsonb_build_object(
    'id', target.id,
    'slug', target.slug,
    'name', target.name,
    'category', target.category,
    'description', target.description,
    'priceInCents', target.price_cents,
    'compareAtPriceInCents', target.compare_at_price_cents,
    'featured', target.featured,
    'stock', coalesce((
      select sum(greatest(inventory.available_quantity - inventory.reserved_quantity, 0))::integer
      from public.product_variants variant
      join public.inventory inventory on inventory.variant_id = variant.id
      where variant.product_id = target.id
        and variant.active
    ), 0),
    'rating', coalesce((
      select round(avg(review.rating)::numeric, 1)
      from public.reviews review
      where review.product_id = target.id
        and review.status = 'approved'
    ), 0),
    'reviews', (
      select count(*)::integer
      from public.reviews review
      where review.product_id = target.id
        and review.status = 'approved'
    ),
    'variants', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', variant.id,
          'color', variant.color_name,
          'colorHex', variant.color_hex,
          'size', variant.size,
          'priceInCents',
            round(coalesce(variant.price_override, product.base_price) * 100)::integer,
          'stock',
            greatest(inventory.available_quantity - inventory.reserved_quantity, 0),
          'imagePath', variant_image.storage_path
        )
        order by variant.color_name, variant.size
      )
      from public.product_variants variant
      join public.products product on product.id = variant.product_id
      join public.inventory inventory on inventory.variant_id = variant.id
      left join lateral (
        select image.storage_path
        from public.product_images image
        where image.product_id = target.id
          and image.variant_id = variant.id
        order by image.is_primary desc, image.sort_order, image.created_at
        limit 1
      ) variant_image on true
      where variant.product_id = target.id
        and variant.active
    ), '[]'::jsonb),
    'images', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', image.id,
          'path', image.storage_path,
          'alt', image.alt_text
        )
        order by image.is_primary desc, image.sort_order, image.created_at
      )
      from public.product_images image
      where image.product_id = target.id
    ), '[]'::jsonb),
    'specifications', jsonb_build_array(
      jsonb_build_object('label', 'Peso', 'value', target.weight_grams || ' g'),
      jsonb_build_object('label', 'Altura', 'value', target.height_cm || ' cm'),
      jsonb_build_object('label', 'Largura', 'value', target.width_cm || ' cm'),
      jsonb_build_object('label', 'Comprimento', 'value', target.length_cm || ' cm')
    ),
    'recentReviews', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', recent.id,
          'rating', recent.rating,
          'title', recent.title,
          'content', recent.content,
          'verified', recent.verified_purchase,
          'helpfulVotes', recent.helpful_votes,
          'createdAt', recent.created_at
        )
        order by recent.created_at desc
      )
      from (
        select review.*
        from public.reviews review
        where review.product_id = target.id
          and review.status = 'approved'
        order by review.created_at desc
        limit 8
      ) recent
    ), '[]'::jsonb)
  )
  from target;
$$;

revoke all on function public.get_catalog_product(text) from public;
grant execute on function public.get_catalog_product(text) to anon, authenticated;

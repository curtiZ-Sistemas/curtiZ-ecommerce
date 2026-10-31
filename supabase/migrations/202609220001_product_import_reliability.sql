begin;

-- Restaura o save mais recente (categorias, guia, especificações e segunda cor)
-- e mantém os metadados Merchant dentro da mesma transação.
create or replace function public.admin_save_product_authorized(p_payload jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_product_id uuid := nullif(p_payload->>'productId', '')::uuid;
  v_primary_category_id uuid := nullif(p_payload->>'categoryId', '')::uuid;
  v_requires_stock_adjustment boolean := false;
  v_category_id uuid;
begin
  perform private.require_permission('products.update');
  if v_product_id is null then perform private.require_permission('products.create'); end if;
  if p_payload->>'status' = 'archived' then
    perform private.require_permission('products.archive');
  end if;

  select exists (
    select 1
    from jsonb_array_elements(coalesce(p_payload->'variants', '[]'::jsonb)) as item(value)
    left join public.inventory inventory
      on inventory.variant_id = nullif(item.value->>'id', '')::uuid
    where coalesce((item.value->>'stock')::integer, 0)
      is distinct from coalesce(inventory.available_quantity, 0)
  ) into v_requires_stock_adjustment;
  if v_requires_stock_adjustment then perform private.require_permission('inventory.adjust'); end if;

  if p_payload->>'status' = 'active' and (
    char_length(trim(coalesce(p_payload->>'name', ''))) < 3
    or v_primary_category_id is null
    or coalesce((p_payload->>'priceInCents')::integer, 0) <= 0
  ) then
    raise exception 'active product is incomplete';
  end if;

  v_product_id := public.admin_save_product(p_payload);

  update public.product_variants variant
  set color_hex_secondary = nullif(trim(item.value->>'colorHexSecondary'), ''),
      updated_at = now()
  from jsonb_array_elements(coalesce(p_payload->'variants', '[]'::jsonb)) as item(value)
  where variant.product_id = v_product_id
    and variant.sku::text = trim(item.value->>'sku');

  delete from public.product_categories where product_id = v_product_id;
  for v_category_id in
    select distinct value::text::uuid
    from jsonb_array_elements_text(
      case when jsonb_typeof(p_payload->'categoryIds') = 'array' then p_payload->'categoryIds'
        else '[]'::jsonb end
    ) item(value)
  loop
    insert into public.product_categories(product_id, category_id, is_primary)
    values (v_product_id, v_category_id, v_category_id = v_primary_category_id);
  end loop;
  if v_primary_category_id is not null and not exists (
    select 1 from public.product_categories
    where product_id = v_product_id and category_id = v_primary_category_id
  ) then
    insert into public.product_categories(product_id, category_id, is_primary)
    values (v_product_id, v_primary_category_id, true);
  end if;

  if p_payload ? 'sizeGuide' then
    delete from public.product_size_guide_entries where product_id = v_product_id;
    insert into public.product_size_guide_entries(product_id, size, measurement_cm, position)
    select v_product_id, entry.size, entry.measurement_cm, entry.position
    from (
      select distinct on (lower(trim(item.value->>'size')))
        trim(item.value->>'size') as size,
        (item.value->>'measurementCm')::numeric as measurement_cm,
        (item.ordinality - 1)::integer as position
      from jsonb_array_elements(
        case when jsonb_typeof(p_payload->'sizeGuide') = 'array' then p_payload->'sizeGuide'
          else '[]'::jsonb end
      ) with ordinality as item(value, ordinality)
      where nullif(trim(item.value->>'size'), '') is not null
        and (item.value->>'measurementCm')::numeric > 0
      order by lower(trim(item.value->>'size')), item.ordinality
    ) entry order by entry.position;
  end if;

  if p_payload ? 'specifications' then
    if jsonb_typeof(p_payload->'specifications') <> 'array'
      or jsonb_array_length(p_payload->'specifications') > 50 then
      raise exception 'invalid product specifications' using errcode = '22023';
    end if;
    delete from public.product_specifications where product_id = v_product_id;
    insert into public.product_specifications(product_id, label, value, position)
    select v_product_id, trim(item.value->>'label'), trim(item.value->>'value'),
      (row_number() over(order by item.ordinality) - 1)::integer
    from jsonb_array_elements(p_payload->'specifications') with ordinality as item(value, ordinality)
    where nullif(trim(item.value->>'label'), '') is not null
      and nullif(trim(item.value->>'value'), '') is not null;
  end if;

  perform public.admin_save_product_merchant_metadata(v_product_id, p_payload);
  return v_product_id;
end;
$$;
revoke all on function public.admin_save_product_authorized(jsonb) from public, anon;
grant execute on function public.admin_save_product_authorized(jsonb) to authenticated;

-- A chave do advisory lock precisa ser texto PostgreSQL válido; chr(0) nunca é.
create or replace function public.admin_import_product_authorized(
  p_source text,
  p_external_key text,
  p_batch_hash text,
  p_payload jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  existing_product_id uuid;
  saved_product_id uuid;
  import_payload jsonb;
begin
  perform private.require_permission('products.create');
  perform private.require_permission('products.update');
  if p_source !~ '^[a-z0-9_-]{2,40}$'
     or char_length(p_external_key) not between 1 and 160
     or p_batch_hash !~ '^[a-f0-9]{64}$'
     or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'invalid product import payload' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_source || ':' || p_external_key, 0));
  select product_id into existing_product_id
  from public.product_import_sources
  where source = p_source and external_key = p_external_key;
  if existing_product_id is not null then
    return jsonb_build_object('productId', existing_product_id, 'alreadyImported', true);
  end if;

  import_payload := jsonb_set(p_payload - 'productId', '{status}', '"draft"'::jsonb, true);
  saved_product_id := public.admin_save_product_authorized(import_payload);
  insert into public.product_import_sources(source, external_key, product_id, batch_hash, imported_by)
  values(p_source, p_external_key, saved_product_id, p_batch_hash, auth.uid());

  return jsonb_build_object('productId', saved_product_id, 'alreadyImported', false);
end;
$$;
revoke all on function public.admin_import_product_authorized(text, text, text, jsonb) from public, anon;
grant execute on function public.admin_import_product_authorized(text, text, text, jsonb) to authenticated;

drop policy if exists "product import sessions delete own" on public.product_import_sessions;
create policy "product import sessions delete own"
  on public.product_import_sessions for delete to authenticated
  using (
    user_id = auth.uid()
    and private.has_permission('products.create')
    and private.has_permission('products.update')
  );

-- Uma associação representativa por cor atende todas as numerações da mesma cor.
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
        and sale.status not in ('draft', 'pending_payment', 'cancellation_requested', 'cancelled', 'returned', 'refund_pending', 'refunded')
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
      left join public.product_variants image_variant on image_variant.id = image.variant_id
      where image.product_id = product.id
        and (
          image.variant_id = variant.id
          or (image_variant.product_id = product.id and image_variant.active and lower(image_variant.color_name) = lower(variant.color_name))
          or image.variant_id is null
        )
        and nullif(trim(image.storage_path), '') is not null
        and image.width > 0 and image.height > 0
      order by case
        when image.variant_id = variant.id then 0
        when image_variant.id is not null then 1
        else 2
      end, image.is_primary desc, image.sort_order, image.created_at
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

create or replace function public.get_google_merchant_feed()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(row_to_json(feed_row)::jsonb order by feed_row.product_name, feed_row.color, feed_row.size), '[]'::jsonb)
  from (
    select
      variant.id as variant_id,
      variant.sku::text as sku,
      variant.barcode as gtin,
      variant.merchant_mpn as mpn,
      product.id as product_id,
      product.slug,
      product.name as product_name,
      product.description,
      category.name as product_type,
      variant.color_name as color,
      variant.size,
      round(coalesce(variant.price_override, product.base_price) * 100)::integer as effective_price_cents,
      case
        when product.compare_at_price > coalesce(variant.price_override, product.base_price)
          then round(product.compare_at_price * 100)::integer
        else null
      end as original_price_cents,
      greatest(inventory.available_quantity - inventory.reserved_quantity, 0)::integer as stock,
      product.merchant_condition,
      product.merchant_gender,
      product.merchant_age_group,
      product.google_product_category,
      product.merchant_identifier_exists,
      coalesce(images.items, '[]'::jsonb) as images
    from public.products product
    join public.categories category on category.id = product.category_id and category.active
    join public.product_variants variant on variant.product_id = product.id and variant.active
    join public.inventory inventory on inventory.variant_id = variant.id
    left join lateral (
      select jsonb_agg(
        jsonb_build_object(
          'path', selected.storage_path,
          'width', selected.width,
          'height', selected.height
        ) order by selected.variant_priority, selected.is_primary desc, selected.sort_order, selected.created_at
      ) as items
      from (
        select image.storage_path, image.width, image.height, image.is_primary,
          image.sort_order, image.created_at,
          case
            when image.variant_id = variant.id then 0
            when image_variant.id is not null then 1
            else 2
          end as variant_priority
        from public.product_images image
        left join public.product_variants image_variant on image_variant.id = image.variant_id
        where image.product_id = product.id
          and (
            image.variant_id = variant.id
            or (image_variant.product_id = product.id and image_variant.active and lower(image_variant.color_name) = lower(variant.color_name))
            or image.variant_id is null
          )
        order by variant_priority, image.is_primary desc, image.sort_order, image.created_at
        limit 11
      ) selected
    ) images on true
    where product.status = 'active'
  ) feed_row;
$$;
revoke all on function public.get_google_merchant_feed() from public;
grant execute on function public.get_google_merchant_feed() to anon, authenticated;

create or replace function public.get_catalog_product(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with target as (
    select
      product.id, product.slug, product.name, category.name as category,
      product.description, round(product.base_price * 100)::integer as price_cents,
      case when product.compare_at_price is not null
        then round(product.compare_at_price * 100)::integer else null end as compare_at_price_cents,
      product.featured, product.weight_grams, product.height_cm, product.width_cm,
      product.length_cm, product.merchant_condition, product.merchant_gender,
      product.merchant_age_group, product.google_product_category,
      product.merchant_identifier_exists
    from public.products product
    join public.categories category on category.id = product.category_id and category.active
    where product.status = 'active' and product.slug = trim(p_slug)
    limit 1
  )
  select jsonb_build_object(
    'id', target.id, 'slug', target.slug, 'name', target.name,
    'category', target.category, 'description', target.description,
    'priceInCents', target.price_cents,
    'compareAtPriceInCents', target.compare_at_price_cents,
    'featured', target.featured,
    'merchant', jsonb_build_object(
      'condition', target.merchant_condition,
      'gender', target.merchant_gender,
      'ageGroup', target.merchant_age_group,
      'googleProductCategory', target.google_product_category,
      'identifierExists', target.merchant_identifier_exists
    ),
    'stock', coalesce((select sum(greatest(inventory.available_quantity - inventory.reserved_quantity, 0))::integer
      from public.product_variants variant join public.inventory inventory on inventory.variant_id = variant.id
      where variant.product_id = target.id and variant.active), 0),
    'rating', coalesce((select round(avg(review.rating)::numeric, 1) from public.reviews review
      where review.product_id = target.id and review.status = 'approved'), 0),
    'reviews', (select count(*)::integer from public.reviews review
      where review.product_id = target.id and review.status = 'approved'),
    'variants', coalesce((select jsonb_agg(jsonb_build_object(
        'id', variant.id, 'sku', variant.sku::text, 'gtin', variant.barcode,
        'mpn', variant.merchant_mpn, 'color', variant.color_name,
        'colorHex', variant.color_hex, 'colorHexSecondary', variant.color_hex_secondary,
        'size', variant.size,
        'priceInCents', round(coalesce(variant.price_override, product.base_price) * 100)::integer,
        'stock', greatest(inventory.available_quantity - inventory.reserved_quantity, 0),
        'imagePath', variant_image.storage_path
      ) order by variant.color_name, variant.size)
      from public.product_variants variant
      join public.products product on product.id = variant.product_id
      join public.inventory inventory on inventory.variant_id = variant.id
      left join lateral (
        select image.storage_path
        from public.product_images image
        left join public.product_variants image_variant on image_variant.id = image.variant_id
        where image.product_id = target.id
          and (
            image.variant_id = variant.id
            or (image_variant.product_id = target.id and image_variant.active and lower(image_variant.color_name) = lower(variant.color_name))
            or image.variant_id is null
          )
        order by case
          when image.variant_id = variant.id then 0
          when image_variant.id is not null then 1
          else 2
        end, image.is_primary desc, image.sort_order, image.created_at
        limit 1
      ) variant_image on true
      where variant.product_id = target.id and variant.active), '[]'::jsonb),
    'images', coalesce((select jsonb_agg(jsonb_build_object(
        'id', image.id, 'path', image.storage_path, 'alt', image.alt_text
      ) order by image.is_primary desc, image.sort_order, image.created_at)
      from public.product_images image where image.product_id = target.id), '[]'::jsonb),
    'specifications', jsonb_build_array(
      jsonb_build_object('label', 'Peso', 'value', target.weight_grams || ' g'),
      jsonb_build_object('label', 'Altura', 'value', target.height_cm || ' cm'),
      jsonb_build_object('label', 'Largura', 'value', target.width_cm || ' cm'),
      jsonb_build_object('label', 'Comprimento', 'value', target.length_cm || ' cm')
    ),
    'recentReviews', coalesce((select jsonb_agg(jsonb_build_object(
        'id', recent.id, 'rating', recent.rating, 'title', recent.title,
        'content', recent.content, 'verified', recent.verified_purchase,
        'helpfulVotes', recent.helpful_votes, 'createdAt', recent.created_at
      ) order by recent.created_at desc)
      from (select review.* from public.reviews review
        where review.product_id = target.id and review.status = 'approved'
        order by review.created_at desc limit 8) recent), '[]'::jsonb)
  ) from target;
$$;
revoke all on function public.get_catalog_product(text) from public;
grant execute on function public.get_catalog_product(text) to anon, authenticated;

commit;
notify pgrst, 'reload schema';

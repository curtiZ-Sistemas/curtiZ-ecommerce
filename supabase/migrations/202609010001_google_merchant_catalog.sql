-- Metadados opcionais e uma leitura pública mínima para o Google Merchant Center.
-- Nenhum valor comercial ou identificador é presumido: itens incompletos permanecem
-- na loja, mas a aplicação os exclui do feed e apresenta os motivos no painel.

alter table public.products
  add column merchant_condition text,
  add column merchant_gender text,
  add column merchant_age_group text,
  add column google_product_category text,
  add column merchant_identifier_exists boolean,
  add constraint products_merchant_condition_check
    check (merchant_condition is null or merchant_condition in ('new', 'refurbished', 'used')),
  add constraint products_merchant_gender_check
    check (merchant_gender is null or merchant_gender in ('male', 'female', 'unisex')),
  add constraint products_merchant_age_group_check
    check (merchant_age_group is null or merchant_age_group in ('newborn', 'infant', 'toddler', 'kids', 'adult'));

alter table public.product_variants
  add column merchant_mpn text,
  add constraint product_variants_merchant_mpn_length_check
    check (merchant_mpn is null or char_length(merchant_mpn) between 1 and 70);

comment on column public.product_variants.barcode is
  'GTIN/EAN real da variação. Não preencher com valor interno ou inventado.';
comment on column public.product_variants.merchant_mpn is
  'MPN real do fabricante, quando existir. Não é o SKU interno.';

create or replace function public.admin_save_product_merchant_metadata(
  p_product_id uuid,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_variant jsonb;
  v_updated integer := 0;
  v_gtin_count integer := 0;
  v_mpn_count integer := 0;
begin
  perform private.require_permission('products.update');

  if not exists (
    select 1 from public.products product where product.id = p_product_id for update
  ) then
    raise exception 'product not found';
  end if;

  update public.products set
    merchant_condition = nullif(trim(p_payload->>'merchantCondition'), ''),
    merchant_gender = nullif(trim(p_payload->>'merchantGender'), ''),
    merchant_age_group = nullif(trim(p_payload->>'merchantAgeGroup'), ''),
    google_product_category = nullif(trim(p_payload->>'googleProductCategory'), ''),
    merchant_identifier_exists = case
      when p_payload->'merchantIdentifierExists' is null
        or p_payload->'merchantIdentifierExists' = 'null'::jsonb then null
      else (p_payload->>'merchantIdentifierExists')::boolean
    end,
    updated_by = v_actor,
    updated_at = now()
  where id = p_product_id;

  for v_variant in
    select value from jsonb_array_elements(coalesce(p_payload->'variants', '[]'::jsonb))
  loop
    update public.product_variants set
      barcode = nullif(trim(v_variant->>'gtin'), ''),
      merchant_mpn = nullif(trim(v_variant->>'mpn'), ''),
      updated_at = now()
    where product_id = p_product_id
      and sku = trim(v_variant->>'sku');

    if not found then
      raise exception 'merchant variant does not belong to product';
    end if;

    v_updated := v_updated + 1;
    if nullif(trim(v_variant->>'gtin'), '') is not null then
      v_gtin_count := v_gtin_count + 1;
    end if;
    if nullif(trim(v_variant->>'mpn'), '') is not null then
      v_mpn_count := v_mpn_count + 1;
    end if;
  end loop;

  insert into public.audit_logs(
    actor_id, actor_role, action, entity_type, entity_id,
    new_data_sanitized, reason
  ) values (
    v_actor, private.current_app_role(), 'product_merchant_metadata_updated',
    'product', p_product_id,
    jsonb_build_object(
      'variant_count', v_updated,
      'gtin_count', v_gtin_count,
      'mpn_count', v_mpn_count,
      'identifier_exists_confirmed', p_payload->'merchantIdentifierExists' is not null
        and p_payload->'merchantIdentifierExists' <> 'null'::jsonb
    ),
    'Google Merchant catalog metadata updated'
  );

  return p_product_id;
end;
$$;

revoke all on function public.admin_save_product_merchant_metadata(uuid, jsonb) from public;

-- Mantém produto, estoque e metadados Merchant na mesma transação do RPC já usado pelo painel.
create or replace function public.admin_save_product_authorized(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product_id uuid := nullif(p_payload->>'productId', '')::uuid;
  v_requires_stock_adjustment boolean := false;
begin
  perform private.require_permission('products.update');
  if v_product_id is null then
    perform private.require_permission('products.create');
  end if;
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

  if v_requires_stock_adjustment then
    perform private.require_permission('inventory.adjust');
  end if;

  v_product_id := public.admin_save_product(p_payload);
  perform public.admin_save_product_merchant_metadata(v_product_id, p_payload);
  return v_product_id;
end;
$$;

revoke all on function public.admin_save_product_merchant_metadata(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.admin_save_product_authorized(jsonb) from public, anon;
grant execute on function public.admin_save_product_authorized(jsonb) to authenticated;

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
          case when image.variant_id = variant.id then 0 else 1 end as variant_priority
        from public.product_images image
        where image.product_id = product.id
          and (image.variant_id is null or image.variant_id = variant.id)
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
        'colorHex', variant.color_hex, 'size', variant.size,
        'priceInCents', round(coalesce(variant.price_override, product.base_price) * 100)::integer,
        'stock', greatest(inventory.available_quantity - inventory.reserved_quantity, 0),
        'imagePath', variant_image.storage_path
      ) order by variant.color_name, variant.size)
      from public.product_variants variant
      join public.products product on product.id = variant.product_id
      join public.inventory inventory on inventory.variant_id = variant.id
      left join lateral (select image.storage_path from public.product_images image
        where image.product_id = target.id and image.variant_id = variant.id
        order by image.is_primary desc, image.sort_order, image.created_at limit 1) variant_image on true
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

notify pgrst, 'reload schema';

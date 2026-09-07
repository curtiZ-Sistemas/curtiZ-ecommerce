-- Cadastro simples, categorias múltiplas e exclusões conservadoras do catálogo.

alter table public.categories add column if not exists image_path text;

alter table public.products
  alter column short_description drop not null,
  alter column description drop not null,
  alter column category_id drop not null,
  alter column base_price drop not null,
  alter column cost_price drop not null,
  alter column weight_grams drop not null,
  alter column height_cm drop not null,
  alter column width_cm drop not null,
  alter column length_cm drop not null;

create table if not exists public.product_categories (
  product_id uuid not null references public.products(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete restrict,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (product_id, category_id)
);

create unique index if not exists product_categories_one_primary_idx
  on public.product_categories(product_id) where is_primary;
create index if not exists product_categories_category_idx
  on public.product_categories(category_id, product_id);

insert into public.product_categories(product_id, category_id, is_primary)
select product.id, product.category_id, true
from public.products product
where product.category_id is not null
on conflict (product_id, category_id) do update set is_primary = true;

alter table public.product_categories enable row level security;
alter table public.product_categories force row level security;

drop policy if exists "public reads active product categories" on public.product_categories;
create policy "public reads active product categories" on public.product_categories
  for select to anon, authenticated using (
    exists (
      select 1 from public.products product
      where product.id = product_id and product.status = 'active'
    )
    and exists (
      select 1 from public.categories category
      where category.id = category_id and category.active
    )
    or private.has_permission('products.read')
  );

drop policy if exists "product managers maintain product categories" on public.product_categories;
create policy "product managers maintain product categories" on public.product_categories
  for all to authenticated
  using (private.has_permission('products.update'))
  with check (private.has_permission('products.update'));

drop policy if exists "taxonomy managers upload category media" on storage.objects;
create policy "taxonomy managers upload category media" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'catalog-public'
    and (storage.foldername(name))[1] = 'categories'
    and private.has_permission('catalog.taxonomy.manage')
  );

drop policy if exists "taxonomy managers remove category media" on storage.objects;
create policy "taxonomy managers remove category media" on storage.objects
  for delete to authenticated using (
    bucket_id = 'catalog-public'
    and (storage.foldername(name))[1] = 'categories'
    and private.has_permission('catalog.taxonomy.manage')
  );

create or replace function public.admin_save_product_authorized(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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
    char_length(trim(coalesce(p_payload->>'description', ''))) < 3
    or v_primary_category_id is null
    or coalesce((p_payload->>'priceInCents')::integer, 0) <= 0
    or coalesce((p_payload->>'weightGrams')::numeric, 0) <= 0
    or coalesce((p_payload->>'heightCm')::numeric, 0) <= 0
    or coalesce((p_payload->>'widthCm')::numeric, 0) <= 0
    or coalesce((p_payload->>'lengthCm')::numeric, 0) <= 0
  ) then
    raise exception 'active product is incomplete';
  end if;

  v_product_id := public.admin_save_product(p_payload);

  delete from public.product_categories where product_id = v_product_id;
  for v_category_id in
    select distinct value::text::uuid
    from jsonb_array_elements_text(
      case
        when jsonb_typeof(p_payload->'categoryIds') = 'array' then p_payload->'categoryIds'
        else '[]'::jsonb
      end
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

  perform public.admin_save_product_merchant_metadata(v_product_id, p_payload);
  return v_product_id;
end;
$$;

revoke all on function public.admin_save_product_authorized(jsonb) from public, anon;
grant execute on function public.admin_save_product_authorized(jsonb) to authenticated;

create or replace function public.admin_set_product_status_authorized(
  p_product_id uuid,
  p_status public.product_status,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status = 'archived' then
    perform private.require_permission('products.archive');
  else
    perform private.require_permission('products.update');
  end if;
  if p_status = 'active' and not exists (
    select 1 from public.products product
    where product.id = p_product_id
      and char_length(trim(coalesce(product.description, ''))) >= 3
      and product.category_id is not null
      and product.base_price > 0
      and product.weight_grams > 0
      and product.height_cm > 0
      and product.width_cm > 0
      and product.length_cm > 0
  ) then
    raise exception 'active product is incomplete';
  end if;
  return public.admin_set_product_status(p_product_id, p_status, p_reason);
end;
$$;

revoke all on function public.admin_set_product_status_authorized(uuid, public.product_status, text)
  from public, anon;
grant execute on function public.admin_set_product_status_authorized(uuid, public.product_status, text)
  to authenticated;

create or replace function private.product_deletion_blockers(p_product_id uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  dependency record;
  has_rows boolean;
  blockers text[] := '{}'::text[];
begin
  if not exists (select 1 from public.products where id = p_product_id) then
    return array['Produto não encontrado'];
  end if;
  for dependency in
    select
      source_namespace.nspname as source_schema,
      source_table.relname as source_table,
      source_column.attname as source_column,
      target_table.relname as target_table
    from pg_catalog.pg_constraint constraint_row
    join pg_catalog.pg_class source_table on source_table.oid = constraint_row.conrelid
    join pg_catalog.pg_namespace source_namespace on source_namespace.oid = source_table.relnamespace
    join pg_catalog.pg_class target_table on target_table.oid = constraint_row.confrelid
    join pg_catalog.pg_namespace target_namespace on target_namespace.oid = target_table.relnamespace
    join lateral unnest(constraint_row.conkey) with ordinality source_key(attnum, position) on true
    join lateral unnest(constraint_row.confkey) with ordinality target_key(attnum, position)
      on target_key.position = source_key.position
    join pg_catalog.pg_attribute source_column
      on source_column.attrelid = constraint_row.conrelid and source_column.attnum = source_key.attnum
    where constraint_row.contype = 'f'
      and constraint_row.confdeltype <> 'c'
      and source_namespace.nspname = 'public'
      and target_namespace.nspname = 'public'
      and target_table.relname in ('products', 'product_variants')
      and target_key.position = 1
      and (target_table.relname, source_table.relname) not in (
        ('products', 'product_variants'),
        ('products', 'product_images'),
        ('products', 'product_media'),
        ('product_variants', 'inventory'),
        ('product_variants', 'product_images'),
        ('product_variants', 'product_media')
      )
  loop
    if dependency.target_table = 'products' then
      execute format('select exists (select 1 from %I.%I where %I = $1)',
        dependency.source_schema, dependency.source_table, dependency.source_column)
      into has_rows using p_product_id;
    else
      execute format('select exists (select 1 from %I.%I where %I in (select id from public.product_variants where product_id = $1))',
        dependency.source_schema, dependency.source_table, dependency.source_column)
      into has_rows using p_product_id;
    end if;
    if has_rows then
      blockers := array_append(blockers, case dependency.source_table
        when 'order_items' then 'pedidos'
        when 'reviews' then 'avaliações'
        when 'inventory_movements' then 'histórico de estoque'
        when 'return_items' then 'devoluções'
        when 'purchase_order_items' then 'compras de estoque'
        else replace(dependency.source_table, '_', ' ')
      end);
    end if;
  end loop;
  return (select coalesce(array_agg(distinct blocker), '{}'::text[]) from unnest(blockers) blocker);
end;
$$;

create or replace function private.product_has_deletion_dependencies(p_product_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select cardinality(private.product_deletion_blockers(p_product_id)) > 0;
$$;

create or replace function public.admin_product_delete_eligibility(p_product_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  product_id uuid;
  blockers text[];
  result jsonb := '{}'::jsonb;
begin
  perform private.require_permission('products.read');
  if coalesce(pg_catalog.array_length(p_product_ids, 1), 0) > 100 then
    raise exception 'too many products' using errcode = '22023';
  end if;
  foreach product_id in array coalesce(p_product_ids, array[]::uuid[])
  loop
    blockers := private.product_deletion_blockers(product_id);
    result := result || pg_catalog.jsonb_build_object(
      product_id::text,
      pg_catalog.jsonb_build_object(
        'canDelete', cardinality(blockers) = 0,
        'blockers', to_jsonb(blockers)
      )
    );
  end loop;
  return result;
end;
$$;

revoke all on function private.product_deletion_blockers(uuid) from public, anon, authenticated;
revoke all on function private.product_has_deletion_dependencies(uuid) from public, anon, authenticated;
revoke all on function public.admin_product_delete_eligibility(uuid[]) from public, anon;
grant execute on function public.admin_product_delete_eligibility(uuid[]) to authenticated;

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
    and (
      nullif(trim(p_category), '') is null
      or exists (
        select 1
        from public.product_categories link
        join public.categories category on category.id = link.category_id and category.active
        where link.product_id = item.product_id
          and (lower(category.slug) = lower(trim(p_category))
            or lower(category.name) = lower(trim(p_category)))
      )
    )
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
    select * from ordered order by display_position
    limit greatest(1, least(p_page_size, 48))
    offset ((greatest(1, p_page) - 1) * greatest(1, least(p_page_size, 48)))
  ),
  category_facets as (
    select jsonb_agg(jsonb_build_object('value', slug, 'label', name, 'count', amount) order by name) value
    from (
      select category.slug, category.name, count(distinct item.storefront_key)::integer amount
      from product_data item
      join public.product_categories link on link.product_id = item.product_id
      join public.categories category on category.id = link.category_id and category.active
      group by category.slug, category.name
    ) options
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

notify pgrst, 'reload schema';

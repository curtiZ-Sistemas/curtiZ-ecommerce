alter table public.product_variants
  add column if not exists display_title text;

do $migration$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.product_variants'::pg_catalog.regclass
      and conname = 'product_variants_display_title_length_check'
  ) then
    alter table public.product_variants
      add constraint product_variants_display_title_length_check
      check (display_title is null or char_length(trim(display_title)) between 3 and 160);
  end if;
end;
$migration$;

comment on column public.product_variants.display_title is
  'Nome comercial opcional da apresentação visual da variante no storefront.';

create or replace function private.storefront_variant_title(
  p_product_id uuid,
  p_variant_id uuid,
  p_colors text[]
) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select nullif(pg_catalog.btrim(variant.display_title), '')
     from public.product_variants variant
     where variant.product_id = p_product_id and variant.id = p_variant_id),
    (select nullif(pg_catalog.btrim(variant.display_title), '')
     from public.product_variants variant
     where variant.product_id = p_product_id
       and variant.active
       and variant.color_name = any(coalesce(p_colors, '{}'::text[]))
     order by variant.color_name, variant.id
     limit 1)
  );
$$;
revoke all on function private.storefront_variant_title(uuid, uuid, text[]) from public, anon, authenticated;

create or replace function private.storefront_variant_search_text(
  p_product_id uuid,
  p_colors text[]
) returns text
language sql stable security definer set search_path = '' as $$
  select pg_catalog.string_agg(distinct pg_catalog.btrim(variant.display_title), ' ')
  from public.product_variants variant
  where variant.product_id = p_product_id
    and variant.active
    and nullif(pg_catalog.btrim(variant.display_title), '') is not null
    and (coalesce(cardinality(p_colors), 0) = 0 or variant.color_name = any(p_colors));
$$;
revoke all on function private.storefront_variant_search_text(uuid, text[]) from public, anon, authenticated;

-- Extend the latest authorized save in place so its permission, stock, category,
-- specification and merchant behavior remains the source of truth.
do $migration$
declare
  definition text;
  marker text := 'v_product_id := public.admin_save_product(p_payload);';
  replacement text := $replacement$v_product_id := public.admin_save_product(p_payload);

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(coalesce(p_payload->'variants', '[]'::jsonb)) as item(value)
    where item.value ? 'displayTitle'
      and nullif(pg_catalog.btrim(item.value->>'displayTitle'), '') is not null
      and char_length(pg_catalog.btrim(item.value->>'displayTitle')) not between 3 and 160
  ) then
    raise exception 'invalid variant display title' using errcode = '22023';
  end if;

  update public.product_variants variant
  set display_title = nullif(pg_catalog.btrim(item.value->>'displayTitle'), '')
  from pg_catalog.jsonb_array_elements(coalesce(p_payload->'variants', '[]'::jsonb)) as item(value)
  where item.value ? 'displayTitle'
    and variant.product_id = v_product_id
    and variant.id = coalesce(
      (select exact_variant.id
       from public.product_variants exact_variant
       where exact_variant.product_id = v_product_id
         and exact_variant.id = nullif(item.value->>'id', '')::uuid
       limit 1),
      (select sku_variant.id
       from public.product_variants sku_variant
       where sku_variant.product_id = v_product_id
         and pg_catalog.upper(sku_variant.sku::text) = pg_catalog.upper(pg_catalog.btrim(item.value->>'sku'))
       order by sku_variant.id
       limit 1)
    );$replacement$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.admin_save_product_authorized(jsonb)'::pg_catalog.regprocedure
  ) into definition;
  if definition is null or pg_catalog.strpos(definition, marker) = 0 then
    raise exception 'latest authorized product save changed; review variant display title persistence';
  end if;
  execute pg_catalog.replace(definition, marker, replacement);
end;
$migration$;

-- Product detail variants carry their own optional title; base product name stays canonical.
do $migration$
declare
  definition text;
  old_fragment text := $old$'mpn', variant.merchant_mpn, 'color', variant.color_name,$old$;
  new_fragment text := $new$'mpn', variant.merchant_mpn, 'displayTitle', variant.display_title, 'color', variant.color_name,$new$;
begin
  select pg_catalog.pg_get_functiondef('public.get_catalog_product(text)'::pg_catalog.regprocedure)
    into definition;
  if definition is null or pg_catalog.strpos(definition, old_fragment) = 0 then
    raise exception 'latest product detail definition changed; review variant display title projection';
  end if;
  execute pg_catalog.replace(definition, old_fragment, new_fragment);
end;
$migration$;

-- Patch current JSON catalog RPCs without changing their signatures or card identity.
do $migration$
declare
  definition text;
  function_id pg_catalog.regprocedure;
  old_search text := 'item.variant_size, item.sku';
  new_search text := 'item.variant_size, item.sku, private.storefront_variant_search_text(item.product_id, item.colors)';
  old_card text := $old$'slug', slug, 'name', display_name, 'category', category, 'categorySlug', category_slug,$old$;
  new_card text := $new$'slug', slug, 'name', base_name, 'variantTitle', private.storefront_variant_title(product_id, variant_id, colors), 'category', category, 'categorySlug', category_slug,$new$;
begin
  foreach function_id in array array[
    'public.search_catalog(text,text,text,text[],text[],integer,integer,boolean,boolean,boolean,numeric,text,integer,integer)'::pg_catalog.regprocedure,
    'public.search_catalog_page(text,text,text,text[],text[],integer,integer,boolean,boolean,boolean,numeric,text,integer,integer)'::pg_catalog.regprocedure
  ] loop
    select pg_catalog.pg_get_functiondef(function_id) into definition;
    if definition is null or pg_catalog.strpos(definition, old_search) = 0
      or pg_catalog.strpos(definition, old_card) = 0 then
      raise exception 'current catalog search definition changed; review variant title search and projection';
    end if;
    definition := pg_catalog.replace(definition, old_search, new_search);
    definition := pg_catalog.replace(definition, old_card, new_card);
    execute definition;
  end loop;
end;
$migration$;

do $migration$
declare
  definition text;
  old_fragment text;
  new_fragment text;
begin
  select pg_catalog.pg_get_functiondef('public.get_model_storefront_items(text,integer)'::pg_catalog.regprocedure)
    into definition;
  old_fragment := $old$'slug', item.slug, 'name', item.display_name, 'category', item.category,$old$;
  new_fragment := $new$'slug', item.slug, 'name', item.base_name, 'variantTitle', private.storefront_variant_title(item.product_id, item.variant_id, item.colors), 'category', item.category,$new$;
  if definition is null or pg_catalog.strpos(definition, old_fragment) = 0 then
    raise exception 'current model catalog definition changed; review variant title projection';
  end if;
  execute pg_catalog.replace(definition, old_fragment, new_fragment);

  select pg_catalog.pg_get_functiondef('public.get_homepage_best_sellers(text,text,integer,boolean,boolean)'::pg_catalog.regprocedure)
    into definition;
  old_fragment := $old$'slug',slug,'name',display_name,$old$;
  new_fragment := $new$'slug',slug,'name',base_name,'variantTitle',private.storefront_variant_title(product_id,variant_id,colors),$new$;
  if definition is null or pg_catalog.strpos(definition, old_fragment) = 0 then
    raise exception 'current best sellers definition changed; review variant title projection';
  end if;
  execute pg_catalog.replace(definition, old_fragment, new_fragment);

  select pg_catalog.pg_get_functiondef(
    'public.get_intelligence_recommendations(text,uuid,text,uuid[],text,integer,integer,integer,uuid[])'::pg_catalog.regprocedure
  ) into definition;
  old_fragment := $old$'variantColor',variant_color,'variantSize',variant_size,'slug',slug,'name',display_name,$old$;
  new_fragment := $new$'variantColor',variant_color,'variantSize',variant_size,'slug',slug,'name',base_name,'variantTitle',private.storefront_variant_title(product_id,variant_id,colors),$new$;
  if definition is null or pg_catalog.strpos(definition, old_fragment) = 0 then
    raise exception 'current recommendations definition changed; review variant title projection';
  end if;
  execute pg_catalog.replace(definition, old_fragment, new_fragment);
end;
$migration$;

notify pgrst, 'reload schema';

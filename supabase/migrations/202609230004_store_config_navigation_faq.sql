-- Metadados de exposição da taxonomia; registros legados não são excluídos.
alter table public.categories
  add column if not exists show_in_menu boolean not null default false,
  add column if not exists show_on_home boolean not null default true,
  add column if not exists home_sort_order integer not null default 100;

alter table public.store_navigation_items
  add column if not exists source text not null default 'manual',
  add column if not exists source_key text;
create unique index if not exists store_navigation_items_source_key_idx
  on public.store_navigation_items(source, source_key) where source_key is not null;
create unique index if not exists homepage_sections_xlsx_key_idx
  on public.homepage_sections(home_page_id, internal_name)
  where internal_name like 'xlsx:%' and status <> 'archived';

alter table public.homepage_sections drop constraint homepage_sections_type_check;
alter table public.homepage_sections add constraint homepage_sections_type_check check (section_type in (
  'banner_hero','product_carousel','product_grid','product_horizontal','categories_grid',
  'models_grid','brands_strip','collections_grid','image_links','image_mosaic',
  'promotions','flash_offers','best_sellers','launches','featured_products',
  'recommended_products','manual_products','campaigns','benefits','reviews_carousel',
  'editorial','video','image_text','countdown','newsletter','institutional',
  'quick_links','safe_component','faq'
));

-- Preserve every validation, revision and audit rule of the existing builder while extending its allowlist.
do $migration$
declare definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.save_homepage_section(jsonb,integer)'::pg_catalog.regprocedure
  ) into definition;
  if definition is null or pg_catalog.strpos(definition, '''quick_links'',''safe_component''') = 0 then
    raise exception 'homepage builder definition changed; review FAQ migration before applying';
  end if;
  definition := pg_catalog.replace(definition,
    '''quick_links'',''safe_component''',
    '''quick_links'',''safe_component'',''faq''');
  execute definition;
end;
$migration$;

create or replace function public.admin_sync_store_navigation(p_categories jsonb, p_items jsonb, p_sync_menu boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  category_row jsonb;
  navigation_row jsonb;
  category_slug text;
  destination_type text;
  destination_value text;
  source_key text;
  seen_keys text[] := '{}'::text[];
  seen_destinations text[] := '{}'::text[];
  synced_categories integer := 0;
  synced_navigation integer := 0;
begin
  perform private.require_permission('catalog.taxonomy.manage');
  if jsonb_typeof(p_categories) is distinct from 'array' or jsonb_array_length(p_categories) > 100
    or (p_items is not null and (jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 100)) then
    raise exception 'invalid store configuration' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('curtiz:store-config-navigation', 0));

  for category_row in select value from jsonb_array_elements(p_categories) as item(value) loop
    category_slug := category_row->>'slug';
    if category_slug is null or category_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
      or char_length(category_slug) > 180
      or char_length(trim(coalesce(category_row->>'name', ''))) not between 1 and 120
      or coalesce((category_row->>'sortOrder')::integer, -1) not between 0 and 10000
      or jsonb_typeof(category_row->'active') <> 'boolean'
      or jsonb_typeof(category_row->'showMenu') <> 'boolean'
      or jsonb_typeof(category_row->'showHome') <> 'boolean' then
      raise exception 'invalid configured category' using errcode = '22023';
    end if;
    insert into public.categories(name, slug, description, active, sort_order, show_in_menu, show_on_home, home_sort_order)
    values(trim(category_row->>'name'), category_slug, nullif(trim(category_row->>'description'), ''),
      (category_row->>'active')::boolean, (category_row->>'sortOrder')::integer,
      (category_row->>'showMenu')::boolean, (category_row->>'showHome')::boolean,
      (category_row->>'sortOrder')::integer)
    on conflict (slug) do update set name = excluded.name, description = excluded.description,
      active = excluded.active, sort_order = excluded.sort_order,
      show_in_menu = excluded.show_in_menu, show_on_home = excluded.show_on_home,
      home_sort_order = excluded.home_sort_order, updated_at = now()
    where (public.categories.name, public.categories.description, public.categories.active,
      public.categories.sort_order, public.categories.show_in_menu, public.categories.show_on_home,
      public.categories.home_sort_order) is distinct from
      (excluded.name, excluded.description, excluded.active, excluded.sort_order,
       excluded.show_in_menu, excluded.show_on_home, excluded.home_sort_order);
    synced_categories := synced_categories + 1;
  end loop;

  if coalesce(p_sync_menu, false) then
  -- Missing Navegacao sheet must not remove previously managed explicit links.
  if p_items is null then
    select coalesce(array_agg(navigation.source_key), '{}'::text[]) into seen_keys
    from public.store_navigation_items navigation
    where navigation.source = 'xlsx_config' and navigation.source_key like 'sheet:%';
  end if;
  for navigation_row in select value from jsonb_array_elements(p_items) as item(value) loop
    destination_type := navigation_row->>'type';
    destination_value := navigation_row->>'destination';
    source_key := case when destination_type = 'category' then 'category:' || destination_value
      else 'sheet:' || (navigation_row->>'key') end;
    if char_length(trim(coalesce(navigation_row->>'key', ''))) not between 1 and 80
      or char_length(trim(coalesce(navigation_row->>'label', ''))) not between 1 and 60
      or destination_type is null or destination_type not in ('page', 'category', 'collection')
      or destination_value is null
      or coalesce((navigation_row->>'sortOrder')::integer, -1) not between 0 and 10000
      or jsonb_typeof(navigation_row->'visible') <> 'boolean'
      or (destination_type = 'page' and (
        left(destination_value, 1) <> '/' or left(destination_value, 2) = '//'
        or pg_catalog.strpos(destination_value, '..') > 0
        or pg_catalog.strpos(destination_value, pg_catalog.chr(92)) > 0
        or destination_value ~ '[[:cntrl:]]'))
      or (destination_type <> 'page' and destination_value !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
      or source_key = any(seen_keys)
      or (destination_type || ':' || destination_value) = any(seen_destinations) then
      raise exception 'invalid configured navigation' using errcode = '22023';
    end if;
    seen_destinations := array_append(seen_destinations, destination_type || ':' || destination_value);
    if destination_type = 'category' and not exists (
      select 1 from public.categories category
      where category.slug = destination_value and category.active and category.show_in_menu
    ) then raise exception 'configured navigation category unavailable' using errcode = 'P0002'; end if;
    if destination_type = 'collection' and not exists (
      select 1 from public.collections collection where collection.slug = destination_value and collection.active
    ) then raise exception 'configured navigation collection unavailable' using errcode = 'P0002'; end if;
    if exists (
      select 1 from public.store_navigation_items navigation
      where navigation.source = 'manual' and navigation.visible
        and navigation.destination_type = case when navigation_row->>'type' = 'page' then 'internal_url' else navigation_row->>'type' end
        and navigation.destination_value = navigation_row->>'destination'
    ) then continue; end if;
    seen_keys := array_append(seen_keys, source_key);
    insert into public.store_navigation_items(label, placement, destination_type, destination_value,
      visible, sort_order, source, source_key, created_by, updated_by)
    values(trim(navigation_row->>'label'), 'main',
      case when destination_type = 'page' then 'internal_url' else destination_type end,
      destination_value, (navigation_row->>'visible')::boolean, (navigation_row->>'sortOrder')::integer,
      'xlsx_config', source_key, auth.uid(), auth.uid())
    on conflict (source, source_key) where source_key is not null do update set
      label = excluded.label, destination_type = excluded.destination_type,
      destination_value = excluded.destination_value, visible = excluded.visible,
      sort_order = excluded.sort_order, updated_by = auth.uid(), updated_at = now()
    where (public.store_navigation_items.label, public.store_navigation_items.destination_type,
      public.store_navigation_items.destination_value, public.store_navigation_items.visible,
      public.store_navigation_items.sort_order) is distinct from
      (excluded.label, excluded.destination_type, excluded.destination_value, excluded.visible, excluded.sort_order);
    synced_navigation := synced_navigation + 1;
  end loop;

  -- Include configured categories absent from the explicit navigation tab.
  for category_slug in select slug from public.categories where active and show_in_menu
    and slug = any(select value->>'slug' from jsonb_array_elements(p_categories) item(value))
  loop
    source_key := 'category:' || category_slug;
    if source_key = any(seen_keys) then continue; end if;
    if exists (select 1 from public.store_navigation_items navigation
      where navigation.source = 'manual' and navigation.destination_type = 'category'
        and navigation.destination_value = category_slug and navigation.visible) then continue; end if;
    insert into public.store_navigation_items(label, placement, destination_type, destination_value,
      visible, sort_order, source, source_key, created_by, updated_by)
    select category.name, 'main', 'category', category.slug, true,
      category.home_sort_order * 10 + 20, 'xlsx_config', source_key, auth.uid(), auth.uid()
    from public.categories category where category.slug = category_slug
    on conflict (source, source_key) where source_key is not null do update set
      label = excluded.label, visible = true, sort_order = excluded.sort_order,
      updated_by = auth.uid(), updated_at = now()
    where (public.store_navigation_items.label, public.store_navigation_items.visible,
      public.store_navigation_items.sort_order) is distinct from
      (excluded.label, true, excluded.sort_order);
    seen_keys := array_append(seen_keys, source_key);
    synced_navigation := synced_navigation + 1;
  end loop;
  update public.store_navigation_items set visible = false, updated_by = auth.uid(), updated_at = now()
  where source = 'xlsx_config' and not (source_key = any(seen_keys)) and visible;
  end if;
  return jsonb_build_object('categories', synced_categories, 'navigation', synced_navigation);
end;
$$;

revoke all on function public.admin_sync_store_navigation(jsonb, jsonb, boolean) from public, anon;
grant execute on function public.admin_sync_store_navigation(jsonb, jsonb, boolean) to authenticated;

create or replace function public.get_home_categories()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', category.id, 'name', category.name, 'slug', category.slug,
    'imagePath', media.storage_path
  ) order by category.home_sort_order, category.name), '[]'::jsonb)
  from public.categories category
  join lateral (
    select image.storage_path
    from public.product_categories link
    join public.products product on product.id = link.product_id and product.status = 'active'
    join public.product_images image on image.product_id = product.id
      and image.width > 0 and image.height > 0 and image.storage_path !~ '(^/|icon[.]svg$)'
    where link.category_id = category.id
    order by product.featured desc, image.is_primary desc, product.created_at desc, image.sort_order
    limit 1
  ) media on true
  where category.active and category.show_on_home;
$$;
revoke all on function public.get_home_categories() from public;
grant execute on function public.get_home_categories() to anon, authenticated;

create or replace function public.get_public_store_navigation()
returns table(id uuid, label text, placement text, destination_type text,
  destination_value text, sort_order integer)
language sql stable security definer set search_path = '' as $$
  select navigation.id, navigation.label, navigation.placement,
    navigation.destination_type, navigation.destination_value, navigation.sort_order
  from public.store_navigation_items navigation
  where navigation.visible and (
    navigation.destination_type <> 'category'
    or exists (
      select 1 from public.categories category
      join public.product_categories link on link.category_id = category.id
      join public.products product on product.id = link.product_id and product.status = 'active'
      join public.product_images image on image.product_id = product.id
        and image.width > 0 and image.height > 0 and image.storage_path !~ '(^/|icon[.]svg$)'
      where category.slug = navigation.destination_value and category.active
    )
  )
  order by navigation.placement, navigation.sort_order, navigation.created_at;
$$;
revoke all on function public.get_public_store_navigation() from public;
grant execute on function public.get_public_store_navigation() to anon, authenticated;

notify pgrst, 'reload schema';

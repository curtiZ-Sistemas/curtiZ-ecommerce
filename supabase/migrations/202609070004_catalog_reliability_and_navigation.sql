-- Publicação mínima, navegação configurável e integração Google desativada por padrão.

create table if not exists public.store_navigation_items (
  id uuid primary key default gen_random_uuid(),
  label text not null check (char_length(trim(label)) between 1 and 60),
  placement text not null default 'main' check (placement in ('main', 'utility')),
  destination_type text not null check (
    destination_type in ('category', 'collection', 'page', 'internal_url')
  ),
  destination_value text not null check (char_length(trim(destination_value)) between 1 and 500),
  visible boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists store_navigation_items_display_idx
  on public.store_navigation_items(placement, sort_order, created_at);

alter table public.store_navigation_items enable row level security;
alter table public.store_navigation_items force row level security;

drop policy if exists "public reads visible store navigation" on public.store_navigation_items;
create policy "public reads visible store navigation" on public.store_navigation_items
  for select to anon, authenticated using (
    visible or private.has_permission('catalog.taxonomy.manage')
  );

drop policy if exists "taxonomy managers maintain store navigation" on public.store_navigation_items;
create policy "taxonomy managers maintain store navigation" on public.store_navigation_items
  for all to authenticated
  using (private.has_permission('catalog.taxonomy.manage'))
  with check (private.has_permission('catalog.taxonomy.manage'));

create or replace function public.admin_reorder_store_navigation(p_item_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
begin
  perform private.require_permission('catalog.taxonomy.manage');
  if coalesce(array_length(p_item_ids, 1), 0) > 100
    or coalesce(array_length(p_item_ids, 1), 0) <> (
      select count(distinct item_id) from unnest(coalesce(p_item_ids, array[]::uuid[])) item_id
    ) then
    raise exception 'invalid navigation order' using errcode = '22023';
  end if;
  with desired as (
    select item_id, (position - 1) * 10 as sort_order
    from unnest(coalesce(p_item_ids, array[]::uuid[])) with ordinality item(item_id, position)
  )
  update public.store_navigation_items navigation
  set sort_order = desired.sort_order, updated_by = auth.uid(), updated_at = now()
  from desired
  where navigation.id = desired.item_id;
  get diagnostics changed = row_count;
  if changed <> coalesce(array_length(p_item_ids, 1), 0) then
    raise exception 'navigation item not found' using errcode = 'P0002';
  end if;
  return changed;
end;
$$;

revoke all on function public.admin_reorder_store_navigation(uuid[]) from public, anon;
grant execute on function public.admin_reorder_store_navigation(uuid[]) to authenticated;

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
    char_length(trim(coalesce(p_payload->>'name', ''))) < 3
    or v_primary_category_id is null
    or coalesce((p_payload->>'priceInCents')::integer, 0) <= 0
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

  -- Metadados antigos permanecem preservados, mas não são exigidos nem sincronizados.
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
      and char_length(trim(product.name)) >= 3
      and product.category_id is not null
      and product.base_price > 0
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

notify pgrst, 'reload schema';

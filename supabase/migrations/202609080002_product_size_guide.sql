-- Guia de medidas por produto, sem duplicação por cor/variação.
create table if not exists public.product_size_guide_entries (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  size text not null check (char_length(trim(size)) between 1 and 40),
  measurement_cm numeric(7, 2) not null check (measurement_cm > 0 and measurement_cm <= 9999.99),
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, size)
);

create index if not exists product_size_guide_entries_product_position_idx
  on public.product_size_guide_entries(product_id, position, size);

alter table public.product_size_guide_entries enable row level security;
alter table public.product_size_guide_entries force row level security;

drop policy if exists "public reads active product size guides" on public.product_size_guide_entries;
create policy "public reads active product size guides" on public.product_size_guide_entries
  for select to anon, authenticated using (
    exists (
      select 1 from public.products product
      where product.id = product_size_guide_entries.product_id
        and product.status = 'active'
    )
    or private.has_permission('products.read')
  );

drop policy if exists "product managers maintain size guides" on public.product_size_guide_entries;
create policy "product managers maintain size guides" on public.product_size_guide_entries
  for all to authenticated
  using (private.has_permission('products.update'))
  with check (private.has_permission('products.update'));

revoke all on table public.product_size_guide_entries from public;
grant select on table public.product_size_guide_entries to anon, authenticated;
grant insert, update, delete on table public.product_size_guide_entries to authenticated;

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

  if p_payload ? 'sizeGuide' then
    delete from public.product_size_guide_entries where product_id = v_product_id;
    insert into public.product_size_guide_entries(product_id, size, measurement_cm, position)
    select
      v_product_id,
      entry.size,
      entry.measurement_cm,
      entry.position
    from (
      select distinct on (lower(trim(item.value->>'size')))
        trim(item.value->>'size') as size,
        (item.value->>'measurementCm')::numeric as measurement_cm,
        (item.ordinality - 1)::integer as position
      from jsonb_array_elements(
        case
          when jsonb_typeof(p_payload->'sizeGuide') = 'array' then p_payload->'sizeGuide'
          else '[]'::jsonb
        end
      ) with ordinality as item(value, ordinality)
      where nullif(trim(item.value->>'size'), '') is not null
        and (item.value->>'measurementCm')::numeric > 0
      order by lower(trim(item.value->>'size')), item.ordinality
    ) entry
    order by entry.position;
  end if;

  return v_product_id;
end;
$$;

revoke all on function public.admin_save_product_authorized(jsonb) from public, anon;
grant execute on function public.admin_save_product_authorized(jsonb) to authenticated;

notify pgrst, 'reload schema';

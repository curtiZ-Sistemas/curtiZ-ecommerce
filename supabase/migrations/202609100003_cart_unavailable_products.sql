begin;
-- Snapshot detached from catalog FKs: deleting a product must not delete its notice.
create table public.cart_unavailable_items (
  cart_id uuid not null references public.carts(id) on delete cascade,
  variant_id uuid not null,
  snapshot jsonb not null,
  unavailable_at timestamptz not null default now(),
  primary key(cart_id, variant_id)
);
alter table public.cart_unavailable_items enable row level security;
revoke all on public.cart_unavailable_items from anon, authenticated;
create index cart_unavailable_expiry on public.cart_unavailable_items(unavailable_at);
create table public.catalog_retired_variants (
  variant_id uuid primary key,
  retired_at timestamptz not null default now()
);
alter table public.catalog_retired_variants enable row level security;
revoke all on public.catalog_retired_variants from anon, authenticated;

create or replace function private.retain_unavailable_cart_variant(p_variant_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.catalog_retired_variants(variant_id) values (p_variant_id)
    on conflict (variant_id) do nothing;
  insert into public.cart_unavailable_items(cart_id, variant_id, snapshot)
  select item.cart_id, variant.id, jsonb_build_object(
    'productId', product.id, 'variantId', variant.id, 'slug', product.slug,
    'name', product.name, 'color', variant.color_name, 'size', variant.size,
    'quantity', item.quantity, 'maxQuantity', 1,
    'unitPriceInCents', round(item.unit_price_snapshot * 100)::integer,
    'imagePath', (select image.storage_path from public.product_images image
      where image.product_id = product.id order by image.is_primary desc, image.sort_order limit 1)
  )
  from public.cart_items item
  join public.product_variants variant on variant.id = item.variant_id
  join public.products product on product.id = variant.product_id
  where variant.id = p_variant_id
  on conflict (cart_id, variant_id) do nothing;
  delete from public.cart_items where variant_id = p_variant_id;
end;
$$;
revoke all on function private.retain_unavailable_cart_variant(uuid) from public, anon, authenticated;

create or replace function private.retain_removed_product_carts()
returns trigger language plpgsql security definer set search_path = '' as $$
declare variant record;
begin
  if tg_table_name = 'product_variants' then
    perform private.retain_unavailable_cart_variant(old.id);
  else
    for variant in select id from public.product_variants where product_id = old.id loop
      perform private.retain_unavailable_cart_variant(variant.id);
    end loop;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger retain_archived_product_carts before update of status on public.products
for each row when (old.status = 'active' and new.status <> 'active')
execute function private.retain_removed_product_carts();
create trigger retain_deleted_variant_carts before delete on public.product_variants
for each row execute function private.retain_removed_product_carts();
create trigger retain_disabled_variant_carts before update of active on public.product_variants
for each row when (old.active and not new.active)
execute function private.retain_removed_product_carts();

create function private.clear_restored_variant_retirement()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'products' then
    delete from public.catalog_retired_variants where variant_id in (select id from public.product_variants where product_id = new.id and active);
  else
    delete from public.catalog_retired_variants where variant_id = new.id;
  end if;
  return new;
end;
$$;
create trigger clear_restored_product_retirement after update of status on public.products
for each row when (old.status <> 'active' and new.status = 'active') execute function private.clear_restored_variant_retirement();
create trigger clear_restored_variant_retirement after update of active on public.product_variants
for each row when (not old.active and new.active) execute function private.clear_restored_variant_retirement();

-- Preserve notices for products already archived before this migration.
do $$ declare variant record; begin
  for variant in select distinct v.id from public.cart_items item
    join public.product_variants v on v.id = item.variant_id
    join public.products p on p.id = v.product_id
    where not v.active or p.status <> 'active' loop
    perform private.retain_unavailable_cart_variant(variant.id);
  end loop;
end $$;

-- Keep the established stock, pricing and merge implementation intact.
alter function public.sync_customer_cart(jsonb, uuid) rename to sync_customer_cart_available;
revoke all on function public.sync_customer_cart_available(jsonb, uuid) from public, anon, authenticated;
create function public.sync_customer_cart(p_lines jsonb, p_source_cart_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb; v_cart_id uuid; unavailable jsonb;
begin
  if auth.uid() is null or not private.is_active_user() then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  result := public.sync_customer_cart_available(p_lines, p_source_cart_id);
  v_cart_id := (result->>'cartId')::uuid;
  delete from public.cart_unavailable_items tombstone where cart_id = v_cart_id
    and exists (select 1 from jsonb_array_elements(result->'items') item where item->>'variantId' = tombstone.variant_id::text);
  delete from public.cart_unavailable_items where cart_id = v_cart_id
    and unavailable_at <= now() - interval '3 days';
  if v_cart_id = p_source_cart_id then
    delete from public.cart_unavailable_items tombstone where tombstone.cart_id = v_cart_id
    and not exists (select 1 from jsonb_array_elements(p_lines) requested
      where requested->>'product_id' = tombstone.snapshot->>'productId'
        and lower(requested->>'color') = lower(tombstone.snapshot->>'color')
        and lower(requested->>'size') = lower(tombstone.snapshot->>'size'));
  end if;
  select coalesce(jsonb_agg(snapshot || jsonb_build_object('unavailableAt', unavailable_at)), '[]'::jsonb)
    into unavailable from public.cart_unavailable_items where cart_id = v_cart_id;
  return jsonb_set(result, '{items}', coalesce(result->'items', '[]'::jsonb) || unavailable);
end;
$$;
revoke all on function public.sync_customer_cart(jsonb, uuid) from public, anon;
grant execute on function public.sync_customer_cart(jsonb, uuid) to authenticated;

-- Public availability exposes only whether requested catalog variants can still exist in a cart.
create function public.cart_variant_availability(p_variant_ids uuid[])
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('variantId', requested.id,
    'unavailableAt', (select retired_at from public.catalog_retired_variants where variant_id = requested.id),
    'available', exists (
    select 1 from public.product_variants variant join public.products product on product.id = variant.product_id
    where variant.id = requested.id and variant.active and product.status = 'active'
  ))), '[]'::jsonb) from (select unnest(p_variant_ids) id limit 50) requested;
$$;
revoke all on function public.cart_variant_availability(uuid[]) from public;
grant execute on function public.cart_variant_availability(uuid[]) to anon, authenticated;

create function private.clear_closed_account_cart_notices()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.cart_unavailable_items where cart_id = new.id;
  return new;
end;
$$;
create trigger clear_closed_account_cart_notices after update of status on public.carts
for each row when (new.status = 'closed') execute function private.clear_closed_account_cart_notices();
commit;

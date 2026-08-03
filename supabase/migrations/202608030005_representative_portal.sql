-- Complete the representative self-service portal with server-owned mutations.
-- All monetary values, inventory changes and network visibility remain controlled
-- by the database and its RLS/permission model.

alter table public.kit_orders
  add column if not exists idempotency_key text;

create unique index if not exists kit_orders_representative_idempotency_idx
  on public.kit_orders(representative_id, idempotency_key)
  where idempotency_key is not null;

alter table public.representative_sales
  add column if not exists payment_method text,
  add column if not exists notes text;

create policy "representative updates own notification"
on public.representative_notifications
for update to authenticated
using (private.owns_representative(representative_id))
with check (private.owns_representative(representative_id));

create or replace function public.update_representative_profile(p_region_code text)
returns public.representatives
language plpgsql
security definer
set search_path = ''
as $$
declare
  representative_row public.representatives%rowtype;
  normalized_region text;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  normalized_region := upper(trim(coalesce(p_region_code, '')));
  if normalized_region !~ '^[A-Z]{2,8}$' then
    raise exception 'invalid region code' using errcode = '22023';
  end if;

  update public.representatives
  set region_code = normalized_region, updated_at = now()
  where user_id = auth.uid()
  returning * into representative_row;
  if representative_row.id is null then
    raise exception 'representative not found' using errcode = 'P0002';
  end if;

  insert into public.audit_logs(
    actor_id, actor_role, action, entity_type, entity_id, new_data_sanitized
  ) values (
    auth.uid(), private.current_app_role(), 'representative.profile.updated',
    'representative', representative_row.id,
    jsonb_build_object('region_code', normalized_region)
  );
  return representative_row;
end;
$$;

create or replace function public.create_representative_kit_order(
  p_kit_id uuid,
  p_idempotency_key text
)
returns public.kit_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  representative_row public.representatives%rowtype;
  kit_row public.kits%rowtype;
  existing_order public.kit_orders%rowtype;
  created_order public.kit_orders%rowtype;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 16
    or char_length(p_idempotency_key) > 128
    or p_idempotency_key !~ '^[A-Za-z0-9._:-]+$' then
    raise exception 'invalid idempotency key' using errcode = '22023';
  end if;

  select * into representative_row
  from public.representatives
  where user_id = auth.uid()
    and status in ('approved_waiting_kit', 'active', 'unqualified')
  for update;
  if representative_row.id is null then
    raise exception 'representative is not allowed to buy kits' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(representative_row.id::text || ':' || p_idempotency_key, 0)
  );
  select * into existing_order
  from public.kit_orders
  where representative_id = representative_row.id
    and idempotency_key = p_idempotency_key;
  if existing_order.id is not null then
    return existing_order;
  end if;

  select * into kit_row from public.kits where id = p_kit_id and active for share;
  if kit_row.id is null then
    raise exception 'kit unavailable' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.kit_level_rules where kit_id = kit_row.id)
    and not exists (
      select 1 from public.kit_level_rules
      where kit_id = kit_row.id
        and level_id = representative_row.current_level_id
        and available
    ) then
    raise exception 'kit unavailable for representative level' using errcode = '42501';
  end if;

  insert into public.kit_orders(
    representative_id, kit_id, status, total_in_cents, kit_snapshot,
    idempotency_key
  ) values (
    representative_row.id, kit_row.id, 'pending_payment',
    kit_row.price_in_cents,
    jsonb_build_object(
      'id', kit_row.id, 'name', kit_row.name, 'version', kit_row.version,
      'price_in_cents', kit_row.price_in_cents
    ),
    p_idempotency_key
  ) returning * into created_order;

  insert into public.kit_order_items(
    kit_order_id, variant_id, quantity, unit_price_in_cents, item_snapshot
  )
  select
    created_order.id,
    item.variant_id,
    item.quantity,
    0,
    jsonb_build_object(
      'sku', variant.sku, 'name', product.name, 'color', variant.color_name,
      'size', variant.size, 'bundle_pricing', true
    )
  from public.kit_items item
  join public.product_variants variant on variant.id = item.variant_id
  join public.products product on product.id = variant.product_id
  where item.kit_id = kit_row.id;

  insert into public.audit_logs(
    actor_id, actor_role, action, entity_type, entity_id, new_data_sanitized
  ) values (
    auth.uid(), private.current_app_role(), 'representative.kit_order.created',
    'kit_order', created_order.id,
    jsonb_build_object('kit_id', kit_row.id, 'total_in_cents', kit_row.price_in_cents)
  );
  return created_order;
end;
$$;

create or replace function public.cancel_representative_sale(
  p_sale_id uuid,
  p_reason text
)
returns public.representative_sales
language plpgsql
security definer
set search_path = ''
as $$
declare
  representative_row public.representatives%rowtype;
  sale_row public.representative_sales%rowtype;
  item record;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception 'invalid cancellation reason' using errcode = '22023';
  end if;

  select * into representative_row
  from public.representatives where user_id = auth.uid();
  if representative_row.id is null then
    raise exception 'representative not found' using errcode = '42501';
  end if;
  select * into sale_row
  from public.representative_sales
  where id = p_sale_id and representative_id = representative_row.id
  for update;
  if sale_row.id is null then
    raise exception 'sale not found' using errcode = 'P0002';
  end if;
  if sale_row.status <> 'confirmed' then
    raise exception 'sale cannot be cancelled' using errcode = '23514';
  end if;

  for item in
    select variant_id, quantity
    from public.representative_sale_items
    where sale_id = sale_row.id
    order by variant_id
  loop
    insert into public.representative_inventory(representative_id, variant_id, quantity)
    values (representative_row.id, item.variant_id, item.quantity)
    on conflict (representative_id, variant_id) do update
      set quantity = public.representative_inventory.quantity + excluded.quantity,
          version = public.representative_inventory.version + 1,
          updated_at = now();
    insert into public.representative_inventory_movements(
      representative_id, variant_id, quantity_delta, reason, source_type,
      source_id, idempotency_key, created_by
    ) values (
      representative_row.id, item.variant_id, item.quantity,
      'sale_cancellation', 'representative_sale', sale_row.id,
      'cancel:' || sale_row.id::text || ':' || item.variant_id::text,
      auth.uid()
    );
  end loop;

  update public.representative_sales
  set status = 'cancelled',
      notes = concat_ws(E'\n', nullif(notes, ''), 'Cancelamento: ' || trim(p_reason)),
      updated_at = now()
  where id = sale_row.id
  returning * into sale_row;
  update public.commission_entries
  set status = 'reversed'
  where sale_id = sale_row.id and status not in ('paid', 'reversed', 'cancelled');

  insert into public.audit_logs(
    actor_id, actor_role, action, entity_type, entity_id, new_data_sanitized
  ) values (
    auth.uid(), private.current_app_role(), 'representative.sale.cancelled',
    'representative_sale', sale_row.id, jsonb_build_object('reason', trim(p_reason))
  );
  return sale_row;
end;
$$;

create or replace function public.set_representative_sale_metadata(
  p_sale_id uuid,
  p_payment_method text,
  p_notes text,
  p_sold_at timestamptz
)
returns public.representative_sales
language plpgsql
security definer
set search_path = ''
as $$
declare
  representative_row public.representatives%rowtype;
  sale_row public.representative_sales%rowtype;
begin
  select * into representative_row
  from public.representatives where user_id = auth.uid();
  if representative_row.id is null then
    raise exception 'representative not found' using errcode = '42501';
  end if;
  if p_payment_method is not null
    and p_payment_method not in ('pix', 'card', 'cash', 'transfer', 'other') then
    raise exception 'invalid payment method' using errcode = '22023';
  end if;
  if p_notes is not null and char_length(trim(p_notes)) > 500 then
    raise exception 'notes too long' using errcode = '22023';
  end if;
  if p_sold_at is not null
    and (p_sold_at > now() or p_sold_at < representative_row.approved_at) then
    raise exception 'invalid sale date' using errcode = '22023';
  end if;

  update public.representative_sales
  set payment_method = nullif(trim(p_payment_method), ''),
      notes = nullif(trim(p_notes), ''),
      sold_at = coalesce(p_sold_at, sold_at),
      updated_at = now()
  where id = p_sale_id
    and representative_id = representative_row.id
    and status = 'confirmed'
  returning * into sale_row;
  if sale_row.id is null then
    raise exception 'sale not found' using errcode = 'P0002';
  end if;
  return sale_row;
end;
$$;

create or replace function public.get_representative_network(
  p_search text default null,
  p_status public.representative_status default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table(
  representative_id uuid,
  public_code text,
  display_name text,
  status public.representative_status,
  level_name text,
  depth integer,
  joined_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    member.id,
    member.public_code,
    profile.full_name,
    member.status,
    level.name,
    closure.depth,
    member.created_at
  from public.representatives owner
  join public.representative_network_closure closure
    on closure.ancestor_id = owner.id and closure.depth > 0
  join public.representatives member on member.id = closure.descendant_id
  join public.profiles profile on profile.id = member.user_id
  left join public.representative_levels level on level.id = member.current_level_id
  where owner.user_id = auth.uid()
    and owner.status in ('active', 'unqualified', 'approved_waiting_kit')
    and (p_status is null or member.status = p_status)
    and (
      nullif(trim(p_search), '') is null
      or member.public_code ilike '%' || trim(p_search) || '%'
      or profile.full_name ilike '%' || trim(p_search) || '%'
    )
  order by closure.depth, profile.full_name
  limit least(greatest(p_limit, 1), 50)
  offset greatest(p_offset, 0);
$$;

create or replace function private.receive_representative_kit_inventory()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare item record;
begin
  if new.status = 'delivered' and old.status is distinct from new.status then
    for item in
      select variant_id, quantity
      from public.kit_order_items
      where kit_order_id = new.id
      order by variant_id
    loop
      insert into public.representative_inventory(representative_id, variant_id, quantity)
      values(new.representative_id, item.variant_id, item.quantity)
      on conflict (representative_id, variant_id) do update
        set quantity = public.representative_inventory.quantity + excluded.quantity,
            version = public.representative_inventory.version + 1,
            updated_at = now();
      insert into public.representative_inventory_movements(
        representative_id, variant_id, quantity_delta, reason, source_type,
        source_id, idempotency_key
      ) values (
        new.representative_id, item.variant_id, item.quantity,
        'kit_delivery', 'kit_order', new.id,
        'kit-delivery:' || new.id::text || ':' || item.variant_id::text
      ) on conflict (idempotency_key) do nothing;
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists receive_representative_kit_inventory on public.kit_orders;
create trigger receive_representative_kit_inventory
after update on public.kit_orders
for each row execute function private.receive_representative_kit_inventory();

revoke all on function public.update_representative_profile(text) from public, anon;
grant execute on function public.update_representative_profile(text) to authenticated;
revoke all on function public.create_representative_kit_order(uuid, text) from public, anon;
grant execute on function public.create_representative_kit_order(uuid, text) to authenticated;
revoke all on function public.cancel_representative_sale(uuid, text) from public, anon;
grant execute on function public.cancel_representative_sale(uuid, text) to authenticated;
revoke all on function public.set_representative_sale_metadata(uuid, text, text, timestamptz) from public, anon;
grant execute on function public.set_representative_sale_metadata(uuid, text, text, timestamptz) to authenticated;
revoke all on function public.get_representative_network(text, public.representative_status, integer, integer) from public, anon;
grant execute on function public.get_representative_network(text, public.representative_status, integer, integer) to authenticated;

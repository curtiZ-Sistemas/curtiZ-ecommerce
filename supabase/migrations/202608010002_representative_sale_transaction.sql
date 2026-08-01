-- Atomic representative sale registration. Prices and availability are always
-- derived from the database; the browser cannot provide monetary totals.
create or replace function public.record_representative_sale(
  p_idempotency_key text,
  p_items jsonb,
  p_customer_reference text default null
)
returns public.representative_sales
language plpgsql
security definer
set search_path = ''
as $$
declare
  representative_row public.representatives%rowtype;
  existing_sale public.representative_sales%rowtype;
  created_sale public.representative_sales%rowtype;
  item record;
  item_count integer := 0;
  subtotal bigint := 0;
  unit_price bigint;
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
  if jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) < 1
    or jsonb_array_length(p_items) > 50 then
    raise exception 'invalid sale items' using errcode = '22023';
  end if;
  if p_customer_reference is not null and (
    char_length(trim(p_customer_reference)) > 80
    or trim(p_customer_reference) !~ '^[A-Za-z0-9._/-]+$'
  ) then
    raise exception 'invalid customer reference' using errcode = '22023';
  end if;

  select * into representative_row
  from public.representatives
  where user_id = auth.uid() and status = 'active'
  for update;
  if representative_row.id is null
    or not private.has_permission('representatives.sales.create_own') then
    raise exception 'representative is not allowed to register sales' using errcode = '42501';
  end if;

  -- Serialize equal requests before checking/creating the unique record.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(representative_row.id::text || ':' || p_idempotency_key, 0)
  );
  select * into existing_sale
  from public.representative_sales
  where representative_id = representative_row.id
    and idempotency_key = p_idempotency_key;
  if existing_sale.id is not null then
    return existing_sale;
  end if;

  if (
    select count(*) <> count(distinct (entry->>'variantId'))
    from jsonb_array_elements(p_items) entry
  ) then
    raise exception 'duplicate variants are not allowed' using errcode = '22023';
  end if;

  -- Lock inventory in a deterministic order to prevent overselling/deadlocks.
  for item in
    select
      requested."variantId" as variant_id,
      requested.quantity,
      inventory.quantity as available_quantity,
      product.id as product_id,
      product.name as product_name,
      product.base_price,
      variant.sku,
      variant.color_name,
      variant.size,
      variant.price_override
    from jsonb_to_recordset(p_items) as requested("variantId" uuid, quantity integer)
    join public.product_variants variant
      on variant.id = requested."variantId" and variant.active
    join public.products product
      on product.id = variant.product_id and product.status = 'active'
    join public.representative_inventory inventory
      on inventory.representative_id = representative_row.id
      and inventory.variant_id = requested."variantId"
    order by requested."variantId"
    for update of inventory
  loop
    if item.quantity is null or item.quantity < 1 or item.quantity > 99 then
      raise exception 'invalid item quantity' using errcode = '22023';
    end if;
    if item.available_quantity < item.quantity then
      raise exception 'insufficient representative inventory' using errcode = '23514';
    end if;
    unit_price := (coalesce(item.price_override, item.base_price) * 100)::bigint;
    subtotal := subtotal + (unit_price * item.quantity);
    item_count := item_count + 1;
  end loop;
  if item_count <> jsonb_array_length(p_items) then
    raise exception 'one or more variants are unavailable' using errcode = '23514';
  end if;

  insert into public.representative_sales(
    representative_id,
    status,
    channel,
    customer_snapshot,
    subtotal_in_cents,
    discount_in_cents,
    total_in_cents,
    idempotency_key,
    sold_at
  ) values (
    representative_row.id,
    'confirmed',
    'manual',
    case when p_customer_reference is null then '{}'::jsonb
      else jsonb_build_object('external_reference', trim(p_customer_reference)) end,
    subtotal,
    0,
    subtotal,
    p_idempotency_key,
    now()
  ) returning * into created_sale;

  for item in
    select
      requested."variantId" as variant_id,
      requested.quantity,
      product.id as product_id,
      product.name as product_name,
      product.base_price,
      variant.sku,
      variant.color_name,
      variant.size,
      variant.price_override
    from jsonb_to_recordset(p_items) as requested("variantId" uuid, quantity integer)
    join public.product_variants variant on variant.id = requested."variantId"
    join public.products product on product.id = variant.product_id
    order by requested."variantId"
  loop
    unit_price := (coalesce(item.price_override, item.base_price) * 100)::bigint;
    insert into public.representative_sale_items(
      sale_id, variant_id, quantity, unit_price_in_cents, discount_in_cents, item_snapshot
    ) values (
      created_sale.id,
      item.variant_id,
      item.quantity,
      unit_price,
      0,
      jsonb_build_object(
        'product_id', item.product_id,
        'name', item.product_name,
        'sku', item.sku,
        'color', item.color_name,
        'size', item.size
      )
    );
    update public.representative_inventory
    set quantity = quantity - item.quantity,
        version = version + 1,
        updated_at = now()
    where representative_id = representative_row.id
      and variant_id = item.variant_id;
    insert into public.representative_inventory_movements(
      representative_id, variant_id, quantity_delta, reason, source_type, source_id,
      idempotency_key, created_by
    ) values (
      representative_row.id,
      item.variant_id,
      -item.quantity,
      'representative_sale',
      'representative_sale',
      created_sale.id,
      p_idempotency_key || ':' || item.variant_id::text,
      auth.uid()
    );
  end loop;

  insert into public.audit_logs(
    actor_id, actor_role, action, entity_type, entity_id, new_data_sanitized, request_id
  ) values (
    auth.uid(),
    private.current_app_role(),
    'representative.sale.recorded',
    'representative_sale',
    created_sale.id,
    jsonb_build_object('item_count', item_count, 'total_in_cents', subtotal),
    null
  );

  return created_sale;
end;
$$;

revoke all on function public.record_representative_sale(text, jsonb, text) from public, anon;
grant execute on function public.record_representative_sale(text, jsonb, text) to authenticated;

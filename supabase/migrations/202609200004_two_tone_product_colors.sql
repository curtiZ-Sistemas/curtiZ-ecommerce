-- Segunda tonalidade opcional por variante. Produtos existentes permanecem com swatch simples.
alter table public.product_variants
  add column if not exists color_hex_secondary char(7)
    check (color_hex_secondary is null or color_hex_secondary::text ~ '^#[0-9A-Fa-f]{6}$');

-- Mantem o save autorizado como a unica operacao publica de cadastro e aplica a
-- segunda cor na mesma transacao depois que o save-base materializa as variantes.
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

  return v_product_id;
end;
$$;
revoke all on function public.admin_save_product_authorized(jsonb) from public, anon;
grant execute on function public.admin_save_product_authorized(jsonb) to authenticated;

notify pgrst, 'reload schema';

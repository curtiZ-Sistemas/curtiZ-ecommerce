-- Cadastro de produto, variações e estoque em uma transação autorizada e auditável.

create or replace function public.admin_save_product(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product_id uuid := nullif(p_payload->>'productId', '')::uuid;
  v_actor uuid := auth.uid();
  v_status public.product_status := (p_payload->>'status')::public.product_status;
  v_previous jsonb;
  v_variant jsonb;
  v_variant_id uuid;
  v_variant_product_id uuid;
  v_inventory public.inventory%rowtype;
  v_stock integer;
  v_delta integer;
  v_seen_variants uuid[] := '{}'::uuid[];
  v_stock_reason text := trim(coalesce(p_payload->>'stockReason', 'Estoque definido no cadastro do produto'));
begin
  perform private.require_permission('products.update');
  if v_product_id is null then
    perform private.require_permission('products.create');
  end if;

  if char_length(trim(coalesce(p_payload->>'name', ''))) < 3
    or coalesce(p_payload->>'slug', '') !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    or jsonb_typeof(coalesce(p_payload->'variants', '[]'::jsonb)) <> 'array'
    or char_length(v_stock_reason) < 10 then
    raise exception 'invalid product payload';
  end if;
  if v_status = 'active' and not exists (
    select 1
    from jsonb_array_elements(coalesce(p_payload->'variants', '[]'::jsonb)) variant
    where coalesce((variant->>'active')::boolean, true)
  ) then
    raise exception 'an active product requires at least one active variant';
  end if;

  if v_product_id is null then
    insert into public.products(
      name, slug, short_description, description, category_id, model_id, collection_id,
      status, status_reason, featured, base_price, compare_at_price, cost_price,
      weight_grams, height_cm, width_cm, length_cm, seo_title, seo_description,
      published_at, published_by, created_by, updated_by
    ) values (
      trim(p_payload->>'name'), p_payload->>'slug', trim(p_payload->>'shortDescription'),
      trim(p_payload->>'description'), (p_payload->>'categoryId')::uuid,
      nullif(p_payload->>'modelId', '')::uuid, nullif(p_payload->>'collectionId', '')::uuid,
      v_status, nullif(trim(p_payload->>'statusReason'), ''),
      coalesce((p_payload->>'featured')::boolean, false),
      (p_payload->>'priceInCents')::numeric / 100,
      nullif(p_payload->>'compareAtPriceInCents', '')::numeric / 100,
      (p_payload->>'costInCents')::numeric / 100,
      (p_payload->>'weightGrams')::integer, (p_payload->>'heightCm')::numeric,
      (p_payload->>'widthCm')::numeric, (p_payload->>'lengthCm')::numeric,
      nullif(trim(p_payload->>'seoTitle'), ''), nullif(trim(p_payload->>'seoDescription'), ''),
      case when v_status = 'active' then now() else null end,
      case when v_status = 'active' then v_actor else null end,
      v_actor, v_actor
    ) returning id into v_product_id;
  else
    select to_jsonb(product) into v_previous
    from public.products product where product.id = v_product_id for update;
    if v_previous is null then raise exception 'product not found'; end if;

    update public.products set
      name = trim(p_payload->>'name'), slug = p_payload->>'slug',
      short_description = trim(p_payload->>'shortDescription'),
      description = trim(p_payload->>'description'), category_id = (p_payload->>'categoryId')::uuid,
      model_id = nullif(p_payload->>'modelId', '')::uuid,
      collection_id = nullif(p_payload->>'collectionId', '')::uuid,
      status = v_status, status_reason = nullif(trim(p_payload->>'statusReason'), ''),
      featured = coalesce((p_payload->>'featured')::boolean, false),
      base_price = (p_payload->>'priceInCents')::numeric / 100,
      compare_at_price = nullif(p_payload->>'compareAtPriceInCents', '')::numeric / 100,
      cost_price = (p_payload->>'costInCents')::numeric / 100,
      weight_grams = (p_payload->>'weightGrams')::integer,
      height_cm = (p_payload->>'heightCm')::numeric,
      width_cm = (p_payload->>'widthCm')::numeric,
      length_cm = (p_payload->>'lengthCm')::numeric,
      seo_title = nullif(trim(p_payload->>'seoTitle'), ''),
      seo_description = nullif(trim(p_payload->>'seoDescription'), ''),
      published_at = case when v_status = 'active' then coalesce(published_at, now()) else published_at end,
      published_by = case when v_status = 'active' then v_actor else published_by end,
      updated_by = v_actor, updated_at = now()
    where id = v_product_id;
  end if;

  for v_variant in select value from jsonb_array_elements(coalesce(p_payload->'variants', '[]'::jsonb))
  loop
    v_variant_id := nullif(v_variant->>'id', '')::uuid;
    v_stock := coalesce((v_variant->>'stock')::integer, 0);
    if char_length(trim(coalesce(v_variant->>'sku', ''))) < 2
      or char_length(trim(coalesce(v_variant->>'color', ''))) < 1
      or char_length(trim(coalesce(v_variant->>'size', ''))) < 1
      or v_stock < 0 then
      raise exception 'invalid product variant';
    end if;

    if v_variant_id is null then
      insert into public.product_variants(
        product_id, sku, color_name, color_hex, size, price_override, cost_override, active
      ) values (
        v_product_id, trim(v_variant->>'sku'), trim(v_variant->>'color'),
        nullif(v_variant->>'colorHex', ''), trim(v_variant->>'size'),
        nullif(v_variant->>'priceInCents', '')::numeric / 100,
        nullif(v_variant->>'costInCents', '')::numeric / 100,
        coalesce((v_variant->>'active')::boolean, true)
      ) returning id into v_variant_id;

      insert into public.inventory(variant_id, available_quantity)
      values (v_variant_id, v_stock);
      if v_stock > 0 then
        insert into public.inventory_movements(
          variant_id, movement_type, quantity, previous_quantity, new_quantity,
          reason, reference_type, reference_id, performed_by
        ) values (
          v_variant_id, 'initial_stock', v_stock, 0, v_stock,
          v_stock_reason, 'product', v_product_id, v_actor
        );
      end if;
    else
      select variant.product_id into v_variant_product_id
      from public.product_variants variant where variant.id = v_variant_id for update;
      if v_variant_product_id is distinct from v_product_id then
        raise exception 'variant does not belong to product';
      end if;

      update public.product_variants set
        sku = trim(v_variant->>'sku'), color_name = trim(v_variant->>'color'),
        color_hex = nullif(v_variant->>'colorHex', ''), size = trim(v_variant->>'size'),
        price_override = nullif(v_variant->>'priceInCents', '')::numeric / 100,
        cost_override = nullif(v_variant->>'costInCents', '')::numeric / 100,
        active = coalesce((v_variant->>'active')::boolean, true), updated_at = now()
      where id = v_variant_id;

      select inventory.* into v_inventory
      from public.inventory inventory where inventory.variant_id = v_variant_id for update;
      if v_inventory.variant_id is null then
        insert into public.inventory(variant_id, available_quantity) values(v_variant_id, v_stock);
      elsif v_inventory.available_quantity <> v_stock then
        v_delta := v_stock - v_inventory.available_quantity;
        update public.inventory set available_quantity = v_stock, version = version + 1, updated_at = now()
        where variant_id = v_variant_id;
        insert into public.inventory_movements(
          variant_id, movement_type, quantity, previous_quantity, new_quantity,
          reason, reference_type, reference_id, performed_by
        ) values (
          v_variant_id, 'admin_adjustment', v_delta, v_inventory.available_quantity, v_stock,
          v_stock_reason, 'product', v_product_id, v_actor
        );
      end if;
    end if;
    v_seen_variants := array_append(v_seen_variants, v_variant_id);
  end loop;

  update public.product_variants
  set active = false, updated_at = now()
  where product_id = v_product_id and not (id = any(v_seen_variants));

  insert into public.audit_logs(
    actor_id, actor_role, action, entity_type, entity_id,
    previous_data_sanitized, new_data_sanitized, reason
  ) values (
    v_actor, private.current_app_role(),
    case when v_previous is null then 'product_created' else 'product_updated' end,
    'product', v_product_id,
    case when v_previous is null then null else v_previous - 'search_document' end,
    jsonb_build_object('name', trim(p_payload->>'name'), 'status', v_status,
      'variant_count', jsonb_array_length(coalesce(p_payload->'variants', '[]'::jsonb))),
    nullif(trim(p_payload->>'statusReason'), '')
  );

  return v_product_id;
end;
$$;

revoke all on function public.admin_save_product(jsonb) from public, anon;
grant execute on function public.admin_save_product(jsonb) to authenticated;

create or replace function public.admin_set_product_status(
  p_product_id uuid,
  p_status public.product_status,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_previous jsonb;
begin
  perform private.require_permission('products.update');
  if p_status in ('inactive', 'archived', 'rejected')
    and char_length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'a status reason is required';
  end if;
  if p_status = 'active' and not exists (
    select 1 from public.product_variants
    where product_id = p_product_id and active
  ) then
    raise exception 'an active product requires at least one active variant';
  end if;

  select to_jsonb(product) into v_previous
  from public.products product where product.id = p_product_id for update;
  if v_previous is null then raise exception 'product not found'; end if;

  update public.products set
    status = p_status,
    status_reason = nullif(trim(p_reason), ''),
    published_at = case when p_status = 'active' then coalesce(published_at, now()) else published_at end,
    published_by = case when p_status = 'active' then v_actor else published_by end,
    updated_by = v_actor,
    updated_at = now()
  where id = p_product_id;

  insert into public.audit_logs(
    actor_id, actor_role, action, entity_type, entity_id,
    previous_data_sanitized, new_data_sanitized, reason
  ) values (
    v_actor, private.current_app_role(), 'product_status_updated', 'product', p_product_id,
    jsonb_build_object('status', v_previous->>'status'),
    jsonb_build_object('status', p_status),
    nullif(trim(p_reason), '')
  );
  return p_product_id;
end;
$$;

revoke all on function public.admin_set_product_status(uuid, public.product_status, text) from public, anon;
grant execute on function public.admin_set_product_status(uuid, public.product_status, text) to authenticated;

drop policy if exists "product managers remove catalog media" on storage.objects;
create policy "product managers remove catalog media" on storage.objects
  for delete to authenticated using (
    bucket_id = 'catalog-public'
    and (storage.foldername(name))[1] = 'products'
    and private.has_permission('products.update')
  );

-- Sincronização idempotente do conteúdo da planilha sem substituir o catálogo publicado por rascunhos.
alter table public.product_import_sources
  add column if not exists product_hash text check (product_hash ~ '^[a-f0-9]{64}$');

revoke update on public.product_import_sources from authenticated;

create or replace function public.admin_sync_import_product_authorized(
  p_source text,
  p_external_key text,
  p_batch_hash text,
  p_product_hash text,
  p_payload jsonb,
  p_categories jsonb,
  p_create_category boolean,
  p_model_name text,
  p_model_slug text,
  p_create_model boolean
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.product_import_sources%rowtype;
  v_category jsonb;
  v_category_name text;
  v_taxonomy jsonb;
  v_primary_id uuid;
  v_category_ids jsonb := '[]'::jsonb;
  v_model_id uuid;
  v_payload jsonb;
  v_variants jsonb := '[]'::jsonb;
  v_variant jsonb;
  v_variant_id uuid;
  v_product_id uuid;
  v_status text;
begin
  perform private.require_permission('products.create');
  perform private.require_permission('products.update');
  if p_source is null or p_source !~ '^[a-z0-9_-]{2,40}$'
    or char_length(p_external_key) not between 1 and 160
    or p_batch_hash is null or p_batch_hash !~ '^[a-f0-9]{64}$'
    or p_product_hash is null or p_product_hash !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_payload) is distinct from 'object'
    or jsonb_typeof(p_payload->'variants') is distinct from 'array'
    or jsonb_typeof(p_categories) is distinct from 'array'
    or jsonb_array_length(p_categories) not between 1 and 20
    or (select count(*) from jsonb_array_elements(p_categories) item where item->>'primary' = 'true') <> 1
  then
    raise exception 'invalid product import payload' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('product-import:' || p_source || ':' || p_external_key, 0));
  select * into v_source from public.product_import_sources
  where source = p_source and external_key = p_external_key for update;
  if v_source.product_id is not null and v_source.product_hash = p_product_hash then
    return jsonb_build_object('productId', v_source.product_id, 'alreadyImported', true, 'unchanged', true);
  end if;

  for v_category in select value from jsonb_array_elements(p_categories) as item(value) loop
    v_category_name := nullif(trim(v_category->>'name'), '');
    if v_category_name is null or char_length(v_category_name) > 120
      or coalesce(v_category->>'slug', '') !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
      or char_length(v_category->>'slug') > 180
      or jsonb_typeof(v_category->'primary') <> 'boolean' then
      raise exception 'invalid product import category' using errcode = '22023';
    end if;
    v_taxonomy := private.resolve_product_import_taxonomy(
      v_category_name, v_category->>'slug', p_create_category,
      case when v_category->>'primary' = 'true' then p_model_name else null end,
      case when v_category->>'primary' = 'true' then p_model_slug else null end,
      p_create_model
    );
    if not v_category_ids @> jsonb_build_array(v_taxonomy->>'categoryId') then
      v_category_ids := v_category_ids || jsonb_build_array(v_taxonomy->>'categoryId');
    end if;
    if v_category->>'primary' = 'true' then
      v_primary_id := (v_taxonomy->>'categoryId')::uuid;
      v_model_id := nullif(v_taxonomy->>'modelId', '')::uuid;
    end if;
  end loop;

  if v_source.product_id is not null then
    select status::text into v_status from public.products where id = v_source.product_id for update;
    if v_status is null then raise exception 'imported product not found' using errcode = 'P0002'; end if;
    for v_variant in select value from jsonb_array_elements(p_payload->'variants') as item(value) loop
      select id into v_variant_id from public.product_variants
      where product_id = v_source.product_id and upper(sku::text) = upper(v_variant->>'sku')
      limit 1;
      v_variants := v_variants || jsonb_build_array(
        case when v_variant_id is null then v_variant
          else jsonb_set(v_variant, '{id}', to_jsonb(v_variant_id::text), true) end
      );
      v_variant_id := null;
    end loop;
    v_payload := jsonb_set(p_payload, '{variants}', v_variants, true);
    v_payload := v_payload || jsonb_build_object('productId', v_source.product_id, 'status', v_status);
  else
    v_payload := (p_payload - 'productId') || jsonb_build_object('status', 'draft');
  end if;
  v_payload := v_payload || jsonb_build_object(
    'categoryId', v_primary_id, 'categoryIds', v_category_ids, 'modelId', v_model_id
  );
  v_product_id := public.admin_save_product_authorized(v_payload);
  if v_source.product_id is null then
    insert into public.product_import_sources(source, external_key, product_id, batch_hash, product_hash, imported_by)
    values(p_source, p_external_key, v_product_id, p_batch_hash, p_product_hash, auth.uid());
  else
    update public.product_import_sources
    set batch_hash = p_batch_hash, product_hash = p_product_hash, imported_by = auth.uid(), imported_at = now()
    where source = p_source and external_key = p_external_key;
  end if;
  return jsonb_build_object('productId', v_product_id, 'alreadyImported', v_source.product_id is not null, 'unchanged', false);
end;
$$;

revoke all on function public.admin_sync_import_product_authorized(text, text, text, text, jsonb, jsonb, boolean, text, text, boolean)
  from public, anon;
grant execute on function public.admin_sync_import_product_authorized(text, text, text, text, jsonb, jsonb, boolean, text, text, boolean)
  to authenticated;

-- Re-associate completed image records after a spreadsheet changes a color or its variants.
-- The stored file remains the same; only the representative variant pointer changes.
create or replace function public.admin_reconcile_import_image_colors(p_product_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  job record;
  target_variant_id uuid;
  changed integer := 0;
begin
  perform private.require_permission('products.update');
  if not exists (select 1 from public.product_import_sources where product_id = p_product_id) then
    raise exception 'product import source not found' using errcode = 'P0002';
  end if;
  for job in select storage_path, color_name from public.product_import_image_jobs
    where product_id = p_product_id and status = 'completed'
  loop
    target_variant_id := null;
    if job.color_name is not null then
      select variant.id into target_variant_id from public.product_variants variant
      where variant.product_id = p_product_id and variant.active
        and lower(trim(variant.color_name)) = lower(trim(job.color_name))
      order by variant.created_at, variant.id limit 1;
      if target_variant_id is null then continue; end if;
    end if;
    update public.product_images set variant_id = target_variant_id
    where product_id = p_product_id and storage_path = job.storage_path
      and variant_id is distinct from target_variant_id;
    changed := changed + found::integer;
    update public.product_media set variant_id = target_variant_id
    where product_id = p_product_id and storage_path = job.storage_path and media_type = 'image'
      and variant_id is distinct from target_variant_id;
  end loop;
  return changed;
end;
$$;
revoke all on function public.admin_reconcile_import_image_colors(uuid) from public, anon;
grant execute on function public.admin_reconcile_import_image_colors(uuid) to authenticated;

create or replace function private.reconcile_completed_import_image_color()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target_variant_id uuid;
begin
  if new.status <> 'completed' then return new; end if;
  if new.color_name is not null then
    select variant.id into target_variant_id from public.product_variants variant
    where variant.product_id = new.product_id and variant.active
      and lower(trim(variant.color_name)) = lower(trim(new.color_name))
    order by variant.created_at, variant.id limit 1;
    if target_variant_id is null then return new; end if;
  end if;
  update public.product_images set variant_id = target_variant_id
  where product_id = new.product_id and storage_path = new.storage_path
    and variant_id is distinct from target_variant_id;
  update public.product_media set variant_id = target_variant_id
  where product_id = new.product_id and storage_path = new.storage_path and media_type = 'image'
    and variant_id is distinct from target_variant_id;
  return new;
end;
$$;
drop trigger if exists product_import_completed_color on public.product_import_image_jobs;
create trigger product_import_completed_color after update of status, color_name
  on public.product_import_image_jobs for each row
  when (new.status = 'completed')
  execute function private.reconcile_completed_import_image_color();
revoke all on function private.reconcile_completed_import_image_color() from public, anon, authenticated;

notify pgrst, 'reload schema';

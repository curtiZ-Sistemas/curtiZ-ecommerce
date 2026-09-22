-- Resolve a taxonomia configurada pela planilha e salva o produto na mesma transação.

create or replace function private.resolve_product_import_taxonomy(
  p_category_name text,
  p_category_slug text,
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
  category_id uuid;
  model_id uuid;
  category_created boolean := false;
  model_created boolean := false;
  normalized_model_name text := nullif(trim(coalesce(p_model_name, '')), '');
begin
  if char_length(trim(coalesce(p_category_name, ''))) not between 1 and 120
    or coalesce(p_category_slug, '') !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    or char_length(p_category_slug) > 180 then
    raise exception 'invalid import category' using errcode = '22023';
  end if;
  if normalized_model_name is not null and (
    char_length(normalized_model_name) > 120
    or coalesce(p_model_slug, '') !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    or char_length(p_model_slug) > 180
  ) then
    raise exception 'invalid import model' using errcode = '22023';
  end if;

  select category.id into category_id
  from public.categories category
  where lower(trim(category.name)) = lower(trim(p_category_name))
     or category.slug = p_category_slug
  order by (category.slug = p_category_slug) desc, category.created_at
  limit 1;

  if category_id is null then
    if not coalesce(p_create_category, false) then
      raise exception 'import category not found' using errcode = 'P0002';
    end if;
    perform private.require_permission('catalog.taxonomy.manage');
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('product-import-category:' || p_category_slug, 0));
    select category.id into category_id
    from public.categories category
    where lower(trim(category.name)) = lower(trim(p_category_name))
       or category.slug = p_category_slug
    order by (category.slug = p_category_slug) desc, category.created_at
    limit 1;
    if category_id is null then
      insert into public.categories(name, slug, active)
      values (trim(p_category_name), p_category_slug, true)
      on conflict (slug) do nothing
      returning id into category_id;
      if category_id is null then
        select category.id into category_id from public.categories category where category.slug = p_category_slug;
      else
        category_created := true;
      end if;
    end if;
  end if;

  if normalized_model_name is not null then
    select model.id into model_id
    from public.product_models model
    where lower(trim(model.name)) = lower(normalized_model_name)
       or model.slug = p_model_slug
    order by (model.slug = p_model_slug) desc, model.created_at
    limit 1;

    if model_id is null then
      if not coalesce(p_create_model, false) then
        raise exception 'import model not found' using errcode = 'P0002';
      end if;
      perform private.require_permission('catalog.taxonomy.manage');
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('product-import-model:' || p_model_slug, 0));
      select model.id into model_id
      from public.product_models model
      where lower(trim(model.name)) = lower(normalized_model_name)
         or model.slug = p_model_slug
      order by (model.slug = p_model_slug) desc, model.created_at
      limit 1;
      if model_id is null then
        insert into public.product_models(name, slug, active, created_by, updated_by)
        values (normalized_model_name, p_model_slug, true, auth.uid(), auth.uid())
        on conflict (slug) do nothing
        returning id into model_id;
        if model_id is null then
          select model.id into model_id from public.product_models model where model.slug = p_model_slug;
        else
          model_created := true;
        end if;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'categoryId', category_id,
    'categoryCreated', category_created,
    'modelId', model_id,
    'modelCreated', model_created
  );
end;
$$;

revoke all on function private.resolve_product_import_taxonomy(text, text, boolean, text, text, boolean)
  from public, anon, authenticated;

create or replace function public.admin_import_product_with_taxonomy_authorized(
  p_source text,
  p_external_key text,
  p_batch_hash text,
  p_payload jsonb,
  p_category_name text,
  p_category_slug text,
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
  existing_product_id uuid;
  taxonomy jsonb;
  import_payload jsonb;
begin
  perform private.require_permission('products.create');
  perform private.require_permission('products.update');
  if p_source !~ '^[a-z0-9_-]{2,40}$'
     or char_length(p_external_key) not between 1 and 160
     or p_batch_hash !~ '^[a-f0-9]{64}$'
     or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'invalid product import payload' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_source || ':' || p_external_key, 0));
  select source.product_id into existing_product_id
  from public.product_import_sources source
  where source.source = p_source and source.external_key = p_external_key;
  if existing_product_id is not null then
    return jsonb_build_object('productId', existing_product_id, 'alreadyImported', true);
  end if;

  taxonomy := private.resolve_product_import_taxonomy(
    p_category_name, p_category_slug, p_create_category,
    p_model_name, p_model_slug, p_create_model
  );
  import_payload := jsonb_set(p_payload, '{categoryId}', to_jsonb(taxonomy->>'categoryId'), true);
  import_payload := jsonb_set(import_payload, '{categoryIds}', jsonb_build_array(taxonomy->>'categoryId'), true);
  import_payload := jsonb_set(
    import_payload,
    '{modelId}',
    case when taxonomy->>'modelId' is null then 'null'::jsonb else to_jsonb(taxonomy->>'modelId') end,
    true
  );
  return public.admin_import_product_authorized(p_source, p_external_key, p_batch_hash, import_payload);
end;
$$;

revoke all on function public.admin_import_product_with_taxonomy_authorized(
  text, text, text, jsonb, text, text, boolean, text, text, boolean
) from public, anon;
grant execute on function public.admin_import_product_with_taxonomy_authorized(
  text, text, text, jsonb, text, text, boolean, text, text, boolean
) to authenticated;

notify pgrst, 'reload schema';

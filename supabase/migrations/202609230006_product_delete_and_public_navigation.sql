begin;

-- Classify actual foreign keys. Unknown references fail closed, including future tables.
create or replace function private.product_deletion_dependencies(p_product_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  dependency record;
  linked boolean;
  commercial boolean;
  removable text[] := '{}'::text[];
  blocking text[] := '{}'::text[];
  disposable constant text[] := array[
    'product_images', 'product_media', 'product_categories', 'product_relations',
    'product_size_guide_entries', 'product_specifications', 'product_import_sources',
    'product_import_run_products', 'product_import_image_jobs', 'product_metrics_daily',
    'favorites', 'cart_items', 'coupon_scopes', 'product_questions', 'kit_items',
    'inventory', 'inventory_movements', 'inventory_count_items',
    'inventory_reservations', 'marketing_events', 'representative_inventory'
  ];
begin
  if not exists (select 1 from public.products where id = p_product_id) then
    return pg_catalog.jsonb_build_object('canDelete', false,
      'removableDependencies', '[]'::jsonb,
      'blockingDependencies', pg_catalog.jsonb_build_array('Produto não encontrado'),
      'blockers', pg_catalog.jsonb_build_array('Produto não encontrado'));
  end if;

  for dependency in
    select source_table.relname as source_table, source_column.attname as source_column,
      target_table.relname as target_table
    from pg_catalog.pg_constraint constraint_row
    join pg_catalog.pg_class source_table on source_table.oid = constraint_row.conrelid
    join pg_catalog.pg_namespace source_namespace on source_namespace.oid = source_table.relnamespace
    join pg_catalog.pg_class target_table on target_table.oid = constraint_row.confrelid
    join pg_catalog.pg_namespace target_namespace on target_namespace.oid = target_table.relnamespace
    join lateral pg_catalog.unnest(constraint_row.conkey) with ordinality source_key(attnum, position) on true
    join lateral pg_catalog.unnest(constraint_row.confkey) with ordinality target_key(attnum, position)
      on target_key.position = source_key.position
    join pg_catalog.pg_attribute source_column
      on source_column.attrelid = constraint_row.conrelid and source_column.attnum = source_key.attnum
    where constraint_row.contype = 'f' and source_namespace.nspname = 'public'
      and target_namespace.nspname = 'public'
      and target_table.relname in ('products', 'product_variants')
      and target_key.position = 1
      and source_table.relname <> 'product_variants'
  loop
    if dependency.target_table = 'products' then
      execute pg_catalog.format('select exists (select 1 from public.%I where %I = $1)',
        dependency.source_table, dependency.source_column) into linked using p_product_id;
    else
      execute pg_catalog.format('select exists (select 1 from public.%I where %I in
        (select id from public.product_variants where product_id = $1))',
        dependency.source_table, dependency.source_column) into linked using p_product_id;
    end if;
    if not linked then continue; end if;

    commercial := false;
    if dependency.source_table = 'inventory_movements' then
      select exists (select 1 from public.inventory_movements movement
        join public.product_variants variant on variant.id = movement.variant_id
        where variant.product_id = p_product_id
          and (movement.movement_type in ('sale', 'return', 'refund')
            or (movement.reference_type is not null
              and movement.reference_type not in ('product', 'variant'))))
        into commercial;
    elsif dependency.source_table = 'inventory_reservations' then
      select exists (select 1 from public.inventory_reservations reservation
        join public.product_variants variant on variant.id = reservation.variant_id
        where variant.product_id = p_product_id and reservation.order_id is not null)
        into commercial;
    elsif dependency.source_table = 'marketing_events' then
      select exists (select 1 from public.marketing_events event
        where event.product_id = p_product_id and event.order_id is not null)
        into commercial;
    elsif dependency.source_table = 'representative_inventory' then
      select exists (select 1 from public.representative_inventory stock
        join public.product_variants variant on variant.id = stock.variant_id
        where variant.product_id = p_product_id and stock.quantity > 0)
        into commercial;
    end if;

    if commercial or not (dependency.source_table = any(disposable)) then
      blocking := pg_catalog.array_append(blocking, dependency.source_table);
    else
      removable := pg_catalog.array_append(removable, dependency.source_table);
    end if;
  end loop;

  select coalesce(pg_catalog.array_agg(distinct item), '{}'::text[]) into removable
    from pg_catalog.unnest(removable) as dependency_name(item);
  select coalesce(pg_catalog.array_agg(distinct item), '{}'::text[]) into blocking
    from pg_catalog.unnest(blocking) as dependency_name(item);
  return pg_catalog.jsonb_build_object('canDelete', pg_catalog.cardinality(blocking) = 0,
    'removableDependencies', pg_catalog.to_jsonb(removable),
    'blockingDependencies', pg_catalog.to_jsonb(blocking),
    'blockers', pg_catalog.to_jsonb(blocking));
end;
$$;
revoke all on function private.product_deletion_dependencies(uuid) from public, anon, authenticated;

create or replace function private.product_deletion_blockers(p_product_id uuid)
returns text[] language sql security definer set search_path = '' as $$
  select array(select pg_catalog.jsonb_array_elements_text(
    private.product_deletion_dependencies(p_product_id)->'blockingDependencies'));
$$;

create or replace function private.product_has_deletion_dependencies(p_product_id uuid)
returns boolean language sql security definer set search_path = '' as $$
  select (private.product_deletion_dependencies(p_product_id)->>'canDelete')::boolean is not true;
$$;

create or replace function public.admin_product_delete_eligibility(p_product_ids uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare product_id uuid; result jsonb := '{}'::jsonb;
begin
  perform private.require_permission('products.read');
  if coalesce(pg_catalog.array_length(p_product_ids, 1), 0) > 100 then
    raise exception 'too many products' using errcode = '22023';
  end if;
  foreach product_id in array coalesce(p_product_ids, array[]::uuid[]) loop
    result := result || pg_catalog.jsonb_build_object(product_id::text,
      private.product_deletion_dependencies(product_id));
  end loop;
  return result;
end;
$$;
revoke all on function public.admin_product_delete_eligibility(uuid[]) from public, anon;
grant execute on function public.admin_product_delete_eligibility(uuid[]) to authenticated;

create or replace function public.admin_delete_product(p_product_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  product_name text;
  eligibility jsonb;
  storage_paths text[];
  import_run_ids uuid[];
  dependency record;
  disposable constant text[] := array[
    'product_images', 'product_media', 'product_categories', 'product_relations',
    'product_size_guide_entries', 'product_specifications', 'product_import_sources',
    'product_import_run_products', 'product_import_image_jobs', 'product_metrics_daily',
    'favorites', 'cart_items', 'coupon_scopes', 'product_questions', 'kit_items',
    'inventory', 'inventory_movements', 'inventory_count_items',
    'inventory_reservations', 'marketing_events', 'representative_inventory'
  ];
begin
  perform private.require_permission('products.delete');
  select product.name into product_name from public.products product
    where product.id = p_product_id for update;
  if product_name is null then raise exception 'product not found' using errcode = 'P0002'; end if;

  eligibility := private.product_deletion_dependencies(p_product_id);
  if (eligibility->>'canDelete')::boolean is not true then
    raise exception 'product has related records' using errcode = '23503';
  end if;

  select coalesce(pg_catalog.array_agg(distinct path), '{}'::text[]) into storage_paths
  from (
    select storage_path as path from public.product_images where product_id = p_product_id
    union select storage_path from public.product_media where product_id = p_product_id
    union select thumbnail_path from public.product_media
      where product_id = p_product_id and thumbnail_path is not null
    union select storage_path from public.product_import_image_jobs where product_id = p_product_id
  ) paths;
  select coalesce(pg_catalog.array_agg(run_id), '{}'::uuid[]) into import_run_ids
    from public.product_import_run_products where product_id = p_product_id;

  -- Delete each approved direct FK before variants/products. Other FKs remain protected.
  for dependency in
    select distinct source_table.relname as source_table, source_column.attname as source_column,
      target_table.relname as target_table
    from pg_catalog.pg_constraint constraint_row
    join pg_catalog.pg_class source_table on source_table.oid = constraint_row.conrelid
    join pg_catalog.pg_namespace source_namespace on source_namespace.oid = source_table.relnamespace
    join pg_catalog.pg_class target_table on target_table.oid = constraint_row.confrelid
    join pg_catalog.pg_namespace target_namespace on target_namespace.oid = target_table.relnamespace
    join lateral pg_catalog.unnest(constraint_row.conkey) with ordinality source_key(attnum, position) on true
    join lateral pg_catalog.unnest(constraint_row.confkey) with ordinality target_key(attnum, position)
      on target_key.position = source_key.position
    join pg_catalog.pg_attribute source_column
      on source_column.attrelid = constraint_row.conrelid and source_column.attnum = source_key.attnum
    where constraint_row.contype = 'f' and source_namespace.nspname = 'public'
      and target_namespace.nspname = 'public'
      and target_table.relname in ('products', 'product_variants')
      and target_key.position = 1
      and source_table.relname = any(disposable)
    order by target_table, source_table, source_column.attname
  loop
    if dependency.target_table = 'products' then
      execute pg_catalog.format('delete from public.%I where %I = $1',
        dependency.source_table, dependency.source_column) using p_product_id;
    else
      execute pg_catalog.format('delete from public.%I where %I in
        (select id from public.product_variants where product_id = $1)',
        dependency.source_table, dependency.source_column) using p_product_id;
    end if;
  end loop;

  delete from public.product_variants where product_id = p_product_id;
  delete from public.products where id = p_product_id;
  update public.product_import_runs run
  set products_total = pg_catalog.greatest(0, run.products_total - 1), updated_at = now()
  where run.id = any(import_run_ids);
  delete from public.product_import_runs run where run.id = any(import_run_ids)
    and run.products_total = 0
    and not exists (select 1 from public.product_import_run_products link where link.run_id = run.id);

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id,
    previous_data_sanitized, reason)
  values(auth.uid(), private.current_app_role(), 'product.delete', 'product', p_product_id,
    pg_catalog.jsonb_build_object('name', product_name),
    'Exclusão permanente solicitada no painel de produtos');
  return pg_catalog.jsonb_build_object('deleted', true, 'storagePaths', pg_catalog.to_jsonb(storage_paths));
end;
$$;
revoke all on function public.admin_delete_product(uuid) from public, anon;
grant execute on function public.admin_delete_product(uuid) to authenticated;

-- Imported drafts only become public after every queued image is usable.
create or replace function private.publish_ready_import_product(p_product_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare importer_id uuid;
begin
  if auth.role() is distinct from 'service_role' and session_user <> 'postgres' then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  select source.imported_by into importer_id from public.product_import_sources source
    where source.product_id = p_product_id;
  if importer_id is null then return; end if;
  if not exists (select 1 from public.product_import_image_jobs job
      where job.product_id = p_product_id) or exists (
    select 1 from public.product_import_image_jobs job
    where job.product_id = p_product_id and job.status <> 'completed'
  ) then return; end if;

  update public.products product set status = 'active', status_reason = null,
    published_at = coalesce(product.published_at, now()),
    published_by = importer_id, updated_by = importer_id, updated_at = now()
  where product.id = p_product_id and product.status = 'draft'
    and pg_catalog.char_length(pg_catalog.btrim(product.name)) >= 3
    and product.base_price > 0
    and exists (select 1 from public.categories category
      where category.id = product.category_id and category.active)
    and exists (select 1 from public.product_variants variant
      where variant.product_id = product.id and variant.active)
    and exists (select 1 from public.product_images image
      where image.product_id = product.id and image.width > 0 and image.height > 0
        and image.storage_path !~ '(^/|icon[.]svg$)');
  if found then
    insert into public.audit_logs(actor_id, action, entity_type, entity_id,
      previous_data_sanitized, new_data_sanitized, reason)
    values(importer_id, 'product_status_updated', 'product', p_product_id,
      pg_catalog.jsonb_build_object('status', 'draft'),
      pg_catalog.jsonb_build_object('status', 'active'),
      'Publicação automática após conclusão das imagens importadas');
  end if;
end;
$$;
revoke all on function private.publish_ready_import_product(uuid) from public, anon, authenticated;

do $migration$
declare definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.complete_product_import_image_job(uuid,uuid,integer,integer,bigint)'::pg_catalog.regprocedure)
    into definition;
  if definition is null or pg_catalog.strpos(definition,
    'perform private.reconcile_product_import_primary(job.product_id);') = 0 then
    raise exception 'image completion definition changed; review import publication';
  end if;
  execute pg_catalog.replace(definition,
    'perform private.reconcile_product_import_primary(job.product_id);',
    'perform private.reconcile_product_import_primary(job.product_id);
  perform private.publish_ready_import_product(job.product_id);');
end;
$migration$;

do $migration$
declare imported_product record;
begin
  for imported_product in
    select source.product_id from public.product_import_sources source
    join public.products product on product.id = source.product_id and product.status = 'draft'
    where exists (select 1 from public.product_import_image_jobs job
      where job.product_id = source.product_id)
      and not exists (select 1 from public.product_import_image_jobs job
        where job.product_id = source.product_id and job.status <> 'completed')
  loop
    perform private.publish_ready_import_product(imported_product.product_id);
  end loop;
end;
$migration$;

-- Navigation and catalog must agree about which categories have public products.
create or replace function public.get_public_store_navigation()
returns table(id uuid, label text, placement text, destination_type text,
  destination_value text, sort_order integer)
language sql stable security definer set search_path = '' as $$
  with eligible_products as materialized (
    select distinct item.product_id from private.storefront_catalog_items() item
  )
  select navigation.id, navigation.label, navigation.placement,
    navigation.destination_type, navigation.destination_value, navigation.sort_order
  from public.store_navigation_items navigation
  where navigation.visible and (
    navigation.destination_type <> 'category' or exists (
      select 1 from public.categories category
      join public.product_categories link on link.category_id = category.id
      join eligible_products item on item.product_id = link.product_id
      where category.slug = navigation.destination_value
        and category.active and category.show_in_menu
    )
  )
  order by navigation.placement, navigation.sort_order, navigation.created_at;
$$;
revoke all on function public.get_public_store_navigation() from public;
grant execute on function public.get_public_store_navigation() to anon, authenticated;

notify pgrst, 'reload schema';
commit;

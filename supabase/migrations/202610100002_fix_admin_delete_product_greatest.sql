begin;

-- GREATEST é uma construção SQL, não uma função de pg_catalog: a forma qualificada
-- (pg_catalog.greatest) falha com 42883 ao planejar o UPDATE de product_import_runs, que roda em
-- toda exclusão. Resultado: public.admin_delete_product sempre abortava e revertia a exclusão.
-- Corpo idêntico ao de 202609230006, trocando apenas essa chamada (search_path='' não afeta GREATEST).
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
  set products_total = greatest(0, run.products_total - 1), updated_at = now()
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

commit;

-- Finaliza a gestão de produtos com exclusão permanente conservadora e auditável.

insert into public.permissions (code, description)
values ('products.delete', 'Excluir permanentemente produtos sem vínculos históricos')
on conflict (code) do update set description = excluded.description;

insert into public.role_permissions (role, permission_id)
select 'admin'::public.app_role, permission.id
from public.permissions permission
where permission.code = 'products.delete'
on conflict do nothing;

create or replace function private.product_has_deletion_dependencies(p_product_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  dependency record;
  has_rows boolean;
begin
  if not exists (select 1 from public.products where id = p_product_id) then
    return true;
  end if;

  for dependency in
    select
      source_namespace.nspname as source_schema,
      source_table.relname as source_table,
      source_column.attname as source_column,
      target_table.relname as target_table
    from pg_catalog.pg_constraint constraint_row
    join pg_catalog.pg_class source_table on source_table.oid = constraint_row.conrelid
    join pg_catalog.pg_namespace source_namespace on source_namespace.oid = source_table.relnamespace
    join pg_catalog.pg_class target_table on target_table.oid = constraint_row.confrelid
    join pg_catalog.pg_namespace target_namespace on target_namespace.oid = target_table.relnamespace
    join lateral unnest(constraint_row.conkey) with ordinality source_key(attnum, position) on true
    join lateral unnest(constraint_row.confkey) with ordinality target_key(attnum, position)
      on target_key.position = source_key.position
    join pg_catalog.pg_attribute source_column
      on source_column.attrelid = constraint_row.conrelid
      and source_column.attnum = source_key.attnum
    where constraint_row.contype = 'f'
      and source_namespace.nspname = 'public'
      and target_namespace.nspname = 'public'
      and target_table.relname in ('products', 'product_variants')
      and target_key.position = 1
      and (target_table.relname, source_table.relname) not in (
        ('products', 'product_variants'),
        ('products', 'product_images'),
        ('products', 'product_media'),
        ('product_variants', 'inventory'),
        ('product_variants', 'product_images'),
        ('product_variants', 'product_media')
      )
  loop
    if dependency.target_table = 'products' then
      execute format(
        'select exists (select 1 from %I.%I where %I = $1)',
        dependency.source_schema,
        dependency.source_table,
        dependency.source_column
      ) into has_rows using p_product_id;
    else
      execute format(
        'select exists (select 1 from %I.%I where %I in (select id from public.product_variants where product_id = $1))',
        dependency.source_schema,
        dependency.source_table,
        dependency.source_column
      ) into has_rows using p_product_id;
    end if;

    if has_rows then
      return true;
    end if;
  end loop;

  return false;
end;
$$;

revoke all on function private.product_has_deletion_dependencies(uuid) from public, anon, authenticated;

create or replace function public.admin_product_delete_eligibility(p_product_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  product_id uuid;
  result jsonb := '{}'::jsonb;
begin
  perform private.require_permission('products.read');

  if coalesce(pg_catalog.array_length(p_product_ids, 1), 0) > 100 then
    raise exception 'too many products' using errcode = '22023';
  end if;

  foreach product_id in array coalesce(p_product_ids, array[]::uuid[])
  loop
    result := result || pg_catalog.jsonb_build_object(
      product_id::text,
      not private.product_has_deletion_dependencies(product_id)
    );
  end loop;

  return result;
end;
$$;

revoke all on function public.admin_product_delete_eligibility(uuid[]) from public, anon;
grant execute on function public.admin_product_delete_eligibility(uuid[]) to authenticated;

create or replace function public.admin_delete_product(p_product_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  product_name text;
  storage_paths text[];
begin
  perform private.require_permission('products.delete');

  select product.name into product_name
  from public.products product
  where product.id = p_product_id
  for update;

  if product_name is null then
    raise exception 'product not found' using errcode = 'P0002';
  end if;

  if private.product_has_deletion_dependencies(p_product_id) then
    raise exception 'product has related records' using errcode = '23503';
  end if;

  select coalesce(pg_catalog.array_agg(paths.path), array[]::text[])
  into storage_paths
  from (
    select storage_path as path from public.product_images where product_id = p_product_id
    union
    select storage_path as path from public.product_media where product_id = p_product_id
    union
    select thumbnail_path as path from public.product_media
      where product_id = p_product_id and thumbnail_path is not null
  ) paths;

  delete from public.inventory
  where variant_id in (select id from public.product_variants where product_id = p_product_id);
  delete from public.product_variants where product_id = p_product_id;
  delete from public.products where id = p_product_id;

  insert into public.audit_logs (
    actor_id,
    actor_role,
    action,
    entity_type,
    entity_id,
    previous_data_sanitized,
    reason
  ) values (
    auth.uid(),
    private.current_app_role(),
    'product.delete',
    'product',
    p_product_id,
    pg_catalog.jsonb_build_object('name', product_name),
    'Exclusão permanente solicitada no painel de produtos'
  );

  return pg_catalog.jsonb_build_object(
    'deleted', true,
    'storagePaths', to_jsonb(storage_paths)
  );
end;
$$;

revoke all on function public.admin_delete_product(uuid) from public, anon;
grant execute on function public.admin_delete_product(uuid) to authenticated;

notify pgrst, 'reload schema';

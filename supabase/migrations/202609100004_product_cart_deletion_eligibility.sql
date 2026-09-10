-- Cart notices are retained by triggers; historical dependencies still block deletion.
create or replace function private.product_deletion_blockers(p_product_id uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  dependency record;
  has_rows boolean;
  blockers text[] := '{}'::text[];
begin
  if not exists (select 1 from public.products where id = p_product_id) then
    return array['Produto não encontrado'];
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
      on source_column.attrelid = constraint_row.conrelid and source_column.attnum = source_key.attnum
    where constraint_row.contype = 'f'
      and constraint_row.confdeltype <> 'c'
      and source_namespace.nspname = 'public'
      and target_namespace.nspname = 'public'
      and target_table.relname in ('products', 'product_variants')
      and target_key.position = 1
      and (target_table.relname, source_table.relname) not in (
        ('products', 'product_variants'),
        ('products', 'product_images'),
        ('products', 'product_media'),
        ('product_variants', 'inventory'),
        ('product_variants', 'cart_items'),
        ('product_variants', 'product_images'),
        ('product_variants', 'product_media')
      )
  loop
    if dependency.target_table = 'products' then
      execute format('select exists (select 1 from %I.%I where %I = $1)',
        dependency.source_schema, dependency.source_table, dependency.source_column)
      into has_rows using p_product_id;
    else
      execute format('select exists (select 1 from %I.%I where %I in (select id from public.product_variants where product_id = $1))',
        dependency.source_schema, dependency.source_table, dependency.source_column)
      into has_rows using p_product_id;
    end if;
    if has_rows then
      blockers := array_append(blockers, case dependency.source_table
        when 'order_items' then 'pedidos'
        when 'reviews' then 'avaliações'
        when 'inventory_movements' then 'histórico de estoque'
        when 'return_items' then 'devoluções'
        when 'purchase_order_items' then 'compras de estoque'
        else replace(dependency.source_table, '_', ' ')
      end);
    end if;
  end loop;
  return (select coalesce(array_agg(distinct blocker), '{}'::text[]) from unnest(blockers) blocker);
end;
$$;

create or replace function private.product_has_deletion_dependencies(p_product_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select cardinality(private.product_deletion_blockers(p_product_id)) > 0;
$$;


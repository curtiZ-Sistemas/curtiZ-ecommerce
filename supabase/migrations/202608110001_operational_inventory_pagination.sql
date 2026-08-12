-- Pagina e filtra o estoque antes do limite, preservando RLS por meio de uma
-- função protegida pela permissão operacional de leitura.

create or replace function public.operational_inventory_page(
  p_query text default '',
  p_filter text default 'all',
  p_offset integer default 0,
  p_limit integer default 20
)
returns table (
  variant_id uuid,
  product_name text,
  sku text,
  color_name text,
  size text,
  available_quantity integer,
  reserved_quantity integer,
  damaged_quantity integer,
  minimum_quantity integer,
  ideal_quantity integer,
  updated_at timestamptz,
  critical boolean,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('inventory.read');

  return query
  select
    inventory.variant_id,
    products.name,
    product_variants.sku::text,
    product_variants.color_name,
    product_variants.size,
    inventory.available_quantity,
    inventory.reserved_quantity,
    inventory.damaged_quantity,
    inventory.minimum_quantity,
    inventory.ideal_quantity,
    inventory.updated_at,
    inventory.available_quantity <= inventory.minimum_quantity,
    count(*) over ()
  from public.inventory as inventory
  join public.product_variants as product_variants
    on product_variants.id = inventory.variant_id
  join public.products as products
    on products.id = product_variants.product_id
  where
    (
      coalesce(trim(p_query), '') = ''
      or products.name ilike '%' || trim(p_query) || '%'
      or product_variants.sku::text ilike '%' || trim(p_query) || '%'
    )
    and case p_filter
      when 'critical' then inventory.available_quantity <= inventory.minimum_quantity
      when 'damaged' then inventory.damaged_quantity > 0
      else true
    end
  order by inventory.updated_at desc, inventory.variant_id
  offset greatest(coalesce(p_offset, 0), 0)
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
end;
$$;

revoke all on function public.operational_inventory_page(text, text, integer, integer)
  from public, anon;
grant execute on function public.operational_inventory_page(text, text, integer, integer)
  to authenticated;

notify pgrst, 'reload schema';

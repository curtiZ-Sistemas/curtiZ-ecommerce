-- Evita transferir todo o estoque para calcular apenas a quantidade crítica.

create or replace function public.operational_critical_stock_count()
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('inventory.read');
  return (
    select count(*)
    from public.inventory
    where available_quantity <= minimum_quantity
  );
end;
$$;

revoke all on function public.operational_critical_stock_count() from public, anon;
grant execute on function public.operational_critical_stock_count() to authenticated;

notify pgrst, 'reload schema';

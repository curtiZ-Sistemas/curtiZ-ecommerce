-- Separa as permissões de cadastro, estoque e arquivamento sem alterar migrations aplicadas.

create or replace function public.admin_save_product_authorized(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product_id uuid := nullif(p_payload->>'productId', '')::uuid;
  v_requires_stock_adjustment boolean := false;
begin
  perform private.require_permission('products.update');
  if v_product_id is null then
    perform private.require_permission('products.create');
  end if;
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

  if v_requires_stock_adjustment then
    perform private.require_permission('inventory.adjust');
  end if;

  return public.admin_save_product(p_payload);
end;
$$;

revoke all on function public.admin_save_product(jsonb) from authenticated;
revoke all on function public.admin_save_product_authorized(jsonb) from public, anon;
grant execute on function public.admin_save_product_authorized(jsonb) to authenticated;

create or replace function public.admin_set_product_status_authorized(
  p_product_id uuid,
  p_status public.product_status,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status = 'archived' then
    perform private.require_permission('products.archive');
  else
    perform private.require_permission('products.update');
  end if;

  return public.admin_set_product_status(p_product_id, p_status, p_reason);
end;
$$;

revoke all on function public.admin_set_product_status(uuid, public.product_status, text)
  from authenticated;
revoke all on function public.admin_set_product_status_authorized(uuid, public.product_status, text)
  from public, anon;
grant execute on function public.admin_set_product_status_authorized(uuid, public.product_status, text)
  to authenticated;

notify pgrst, 'reload schema';

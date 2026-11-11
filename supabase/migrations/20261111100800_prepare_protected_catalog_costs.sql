-- Preparation only: the panel must switch to this function before direct
-- client access to cost columns can be revoked.
create function public.admin_read_catalog_costs(p_product_ids uuid[])
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not private.user_has_role('admin'::public.app_role) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_product_ids is null or cardinality(p_product_ids) > 500 then
    raise exception 'invalid product ids' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'product_id', p.id,
    'product_cost', p.cost_price,
    'variants', coalesce((select jsonb_object_agg(v.id::text, v.cost_override)
      from public.product_variants v where v.product_id = p.id), '{}'::jsonb)
  )), '[]'::jsonb) into result
  from public.products p where p.id = any(p_product_ids);
  return result;
end;
$$;

revoke all on function public.admin_read_catalog_costs(uuid[]) from public, anon, authenticated;
grant execute on function public.admin_read_catalog_costs(uuid[]) to authenticated;
notify pgrst, 'reload schema';

create or replace function public.has_permission(permission_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_permission(permission_code);
$$;

create or replace function public.convert_order_reservations(p_order_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  select private.convert_order_reservations(p_order_id);
$$;

revoke all on function public.has_permission(text) from public, anon;
grant execute on function public.has_permission(text) to authenticated;
revoke all on function public.convert_order_reservations(uuid) from public, anon, authenticated;
grant execute on function public.convert_order_reservations(uuid) to service_role;

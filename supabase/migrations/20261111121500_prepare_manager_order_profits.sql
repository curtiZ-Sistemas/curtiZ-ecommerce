-- The manager panel must not rely on customer-readable order cost columns.
create or replace function public.manager_read_order_profits(p_order_ids uuid[])
returns table(order_id uuid, estimated_profit numeric)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.user_has_role('manager'::public.app_role)
     or private.customer_account_is_closed()
     or not private.has_permission('orders.read_all')
     or not private.has_permission('financial.read_summary') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_order_ids is null or cardinality(p_order_ids) > 500 then
    raise exception 'invalid order ids' using errcode = '22023';
  end if;
  return query select o.id, o.estimated_profit
    from public.orders o where o.id = any(p_order_ids);
end;
$$;
revoke all on function public.manager_read_order_profits(uuid[]) from public, anon, authenticated;
grant execute on function public.manager_read_order_profits(uuid[]) to authenticated;

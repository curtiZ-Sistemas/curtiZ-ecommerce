-- Restrict the cost reader to active operational users with order access.
create or replace function public.operational_read_shipment_costs(p_shipment_ids uuid[])
returns table(shipment_id uuid, shipping_cost numeric)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.user_has_role('operational'::public.app_role)
     or private.customer_account_is_closed()
     or not (private.has_permission('orders.read_all') or private.has_permission('orders.read_assigned')) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_shipment_ids is null or cardinality(p_shipment_ids) > 500 then
    raise exception 'invalid shipment ids' using errcode = '22023';
  end if;
  return query select s.id, s.shipping_cost from public.shipments s
    where s.id = any(p_shipment_ids);
end;
$$;
revoke all on function public.operational_read_shipment_costs(uuid[]) from public, anon, authenticated;
grant execute on function public.operational_read_shipment_costs(uuid[]) to authenticated;

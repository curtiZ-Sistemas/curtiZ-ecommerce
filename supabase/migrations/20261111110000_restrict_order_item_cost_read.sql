-- Customers need the sale price of their items, not the store's unit cost.
-- RLS still controls which rows may be read; preserve every other column.
do $$
begin
  if exists (
    select 1 from pg_attribute
    where attrelid = 'public.order_items'::regclass and attnum > 0 and not attisdropped
      and attname::text <> all(array['id','order_id','product_id','variant_id','product_name_snapshot',
        'sku_snapshot','color_snapshot','size_snapshot','quantity','unit_price','discount_amount','total','unit_cost_snapshot'])
  ) then raise exception 'order_items columns changed; review cost grants'; end if;
end;
$$;
revoke select on table public.order_items from authenticated;
revoke select (unit_cost_snapshot) on public.order_items from public, anon, authenticated;
grant select (
  id, order_id, product_id, variant_id, product_name_snapshot, sku_snapshot,
  color_snapshot, size_snapshot, quantity, unit_price, discount_amount, total
) on public.order_items to authenticated;

notify pgrst, 'reload schema';

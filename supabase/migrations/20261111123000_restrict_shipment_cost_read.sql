-- Keep customer shipment tracking available while hiding the carrier cost.
do $$
begin
  if exists (
    select 1 from pg_attribute
    where attrelid = 'public.shipments'::regclass and attnum > 0 and not attisdropped
      and attname::text <> all(array['id','order_id','provider','service','tracking_code','label_path','status',
        'package_snapshot','dispatched_at','delivered_at','metadata_sanitized','created_at','shipping_quote_id',
        'external_id','carrier','shipping_amount','shipping_cost','estimated_days','volume_index','operation_state',
        'operation_key','last_error_code','updated_at'])
  ) then raise exception 'shipments columns changed; review cost grants'; end if;
end;
$$;
revoke select on public.shipments from authenticated;
revoke select (shipping_cost) on public.shipments from public, anon, authenticated;
grant select (
  id, order_id, provider, service, tracking_code, label_path, status,
  package_snapshot, dispatched_at, delivered_at, metadata_sanitized, created_at,
  shipping_quote_id, external_id, carrier, shipping_amount, estimated_days,
  volume_index, operation_state, operation_key, last_error_code, updated_at
) on public.shipments to authenticated;
notify pgrst, 'reload schema';

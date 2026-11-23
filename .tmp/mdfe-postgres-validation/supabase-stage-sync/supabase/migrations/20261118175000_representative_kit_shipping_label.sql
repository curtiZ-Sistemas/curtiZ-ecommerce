create function public.read_representative_kit_printable_label(p_order uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare label text;
begin
  perform private.require_permission('representatives.kits.fulfill');
  select f.shipment_id into label
    from private.representative_kit_fulfillment f join private.representative_kit_orders o on o.id=f.order_id
    where o.id=p_order and o.state='paid' and o.stock_state='sold' and o.cancellation_requested_at is null
      and f.invoice_access_key is not null and f.invoice_cancellation_confirmed_at is null
      and f.invoice_confirmed_at > statement_timestamp()-interval '20 minutes'
      and f.shipment_status in ('label_created','dispatched','in_transit','delayed')
      and private.representative_kit_payment_allowed(o)
      and not exists (select 1 from private.representative_kit_refund_requests r where r.order_id=o.id);
  return label;
end;
$$;
revoke all on function public.read_representative_kit_printable_label(uuid) from public,anon,service_role;
grant execute on function public.read_representative_kit_printable_label(uuid) to authenticated;

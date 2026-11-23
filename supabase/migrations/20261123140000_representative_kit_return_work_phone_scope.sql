-- The buyer's phone is kept in the order snapshot for the delivery team. The returns
-- queue reads that snapshot too, so it must not hand the phone to staff who only hold
-- returns.read; only operators with orders.update_operational_status receive it.
create or replace function public.list_representative_kit_return_work()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_permission('returns.read');
  return (select coalesce(jsonb_agg(pending.summary),'[]'::jsonb) from (
    select private.representative_kit_return_summary(r) || jsonb_build_object('reason',r.reason,'sku',o.sku,
      'productName',o.product_name,'originalInvoiceKey',f.invoice_access_key,'refundInCents',r.refund_cents,
      'invoiceKey',r.invoice_key,'collectionMethod',o.collection_method,
      'ownDelivery',private.representative_kit_is_own_delivery(o),
      'deliveryAddress',case when o.shipping_snapshot -> 'deliveryAddress' is null then null
        when private.has_permission('orders.update_operational_status') then o.shipping_snapshot -> 'deliveryAddress'
        else (o.shipping_snapshot -> 'deliveryAddress') - 'phone' end,
      'canConfirmRefund',r.refund_prepared_by is not null and r.refund_prepared_by <> auth.uid()) as summary
    from private.representative_kit_returns r join private.representative_kit_orders o on o.id=r.order_id
    join private.representative_kit_fulfillment f on f.order_id=o.id
    order by r.created_at desc, r.id limit 50
  ) pending);
end;
$$;

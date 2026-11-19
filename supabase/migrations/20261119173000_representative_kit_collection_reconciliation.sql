alter table private.representative_kit_collection_payments add column checked_at timestamptz;

create function public.due_representative_kit_collection_payments()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(work)),'[]'::jsonb) from (
    select o.id as "orderId",p.point_order_id as "pointOrderId",p.point_key as "pointKey",
      o.collection_point_terminal as terminal,o.collection_method as method,false as confirmed,
      o.unit_price_cents*o.quantity+o.shipping_cents as "amountInCents"
    from private.representative_kit_collection_payments p join private.representative_kit_orders o on o.id=p.order_id
    where o.state='awaiting_receipt' and o.cancellation_requested_at is null
      and p.confirmed_at is null and p.point_order_id is not null and p.point_key is not null
      and p.point_status in ('created','at_terminal','processed')
      and (p.checked_at is null or p.checked_at<now()-interval '5 minutes')
    order by p.checked_at nulls first,p.order_id limit 3
  ) work;
$$;

create function public.defer_representative_kit_collection_payment(p_order uuid,p_point_key uuid)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  update private.representative_kit_collection_payments set checked_at=clock_timestamp()
    where order_id=p_order and point_key=p_point_key and confirmed_at is null;
  return found;
end;
$$;

create function public.due_representative_kit_collection_refunds()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(work)),'[]'::jsonb) from (
    select r.id as "refundId",r.amount_cents as "refundCents",r.baseline_refund_ids as "previousRefundIds",
      p.point_order_id as "pointOrderId",p.point_key as "pointKey",p.receipt_reference as receipt,
      o.collection_method as method,o.collection_point_terminal as terminal,false as confirmed,false as "maySend",
      o.unit_price_cents*o.quantity+o.shipping_cents as "amountInCents"
    from private.representative_kit_refund_requests r join private.representative_kit_orders o on o.id=r.order_id
    join private.representative_kit_collection_payments p on p.order_id=o.id
    where r.provider_refund_id is null and r.started_at is not null and r.baseline_refund_ids is not null
      and o.collection_method in ('pix','debit_card','credit_card') and p.confirmed_at is not null
      and p.point_key is not null and p.point_order_id is not null
      and (r.checked_at is null or r.checked_at<now()-interval '5 minutes')
    order by r.checked_at nulls first,r.id limit 3
  ) work;
$$;
revoke all on function public.due_representative_kit_collection_payments(),
  public.defer_representative_kit_collection_payment(uuid,uuid),public.due_representative_kit_collection_refunds()
  from public,anon,authenticated;
grant execute on function public.due_representative_kit_collection_payments(),
  public.defer_representative_kit_collection_payment(uuid,uuid),public.due_representative_kit_collection_refunds()
  to service_role;

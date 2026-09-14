begin;

create or replace function public.list_my_visible_orders(p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'invalid_order_limit' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(entry.payload order by entry.created_at desc), '[]'::jsonb)
  into result
  from (
    select candidate.created_at,
      jsonb_build_object(
        'id', candidate.id,
        'public_code', candidate.public_code,
        'status', candidate.status,
        'payment_status', candidate.payment_status,
        'subtotal', candidate.subtotal,
        'discount_total', candidate.discount_total,
        'shipping_total', candidate.shipping_total,
        'grand_total', candidate.grand_total,
        'shipping_address_snapshot', candidate.shipping_address_snapshot,
        'cpf_last_four', candidate.cpf_last_four,
        'placed_at', candidate.placed_at,
        'created_at', candidate.created_at,
        'cancellation_completed_at', candidate.cancellation_completed_at,
        'refund_status', candidate.refund_status,
        'refund_completed_at', candidate.refund_completed_at,
        'had_approved_payment', candidate.had_approved_payment,
        'customer_visible_until', case
          when candidate.status = 'cancelled'
            and not candidate.had_approved_payment
            and candidate.refund_status is null
            then candidate.cancellation_completed_at + interval '72 hours'
          when candidate.status in ('cancelled', 'refunded')
            and candidate.refund_status = 'completed'
            then candidate.refund_completed_at + interval '240 hours'
          else null
        end
      ) as payload
    from (
      select sale.*,
        payment.provider_payment_id,
        payment.status as latest_payment_status,
        payment.status_detail,
        payment.expires_at,
        payment.payment_method_summary,
        cancellation.completed_at as cancellation_completed_at,
        refund.status as refund_status,
        refund.completed_at as refund_completed_at,
        exists (
          select 1
          from public.payments approved_payment
          where approved_payment.order_id = sale.id
            and (
              approved_payment.status in ('approved', 'refunded')
              or approved_payment.paid_at is not null
            )
        ) as had_approved_payment
      from public.orders sale
      left join lateral (
        select current_payment.provider_payment_id, current_payment.status,
          current_payment.status_detail, current_payment.expires_at,
          current_payment.payment_method_summary
        from public.payments current_payment
        where current_payment.order_id = sale.id
        order by current_payment.created_at desc, current_payment.id desc
        limit 1
      ) payment on true
      left join lateral (
        select max(history.created_at) as completed_at
        from public.order_status_history history
        where history.order_id = sale.id
          and history.new_status = 'cancelled'
      ) cancellation on true
      left join lateral (
        select current_refund.status, current_refund.completed_at
        from public.payment_refunds current_refund
        where current_refund.order_id = sale.id
        order by current_refund.created_at desc, current_refund.id desc
        limit 1
      ) refund on true
      where sale.customer_id = auth.uid()
    ) candidate
    where case
      when candidate.status in ('refund_pending', 'manual_review')
        or candidate.refund_status in ('pending', 'failed') then true
      when candidate.status = 'refunded' then
        candidate.refund_status <> 'completed'
        or candidate.refund_completed_at is null
        or now() < candidate.refund_completed_at + interval '240 hours'
      when candidate.status = 'cancelled'
        and (candidate.had_approved_payment or candidate.refund_status is not null) then
        candidate.refund_status <> 'completed'
        or candidate.refund_completed_at is null
        or now() < candidate.refund_completed_at + interval '240 hours'
      when candidate.status = 'cancelled' then
        candidate.cancellation_completed_at is null
        or now() < candidate.cancellation_completed_at + interval '72 hours'
      else
        coalesce(candidate.status_detail, '') <> 'expired'
        and not (
          candidate.latest_payment_status in ('pending', 'rejected', 'cancelled')
          and candidate.expires_at is not null
          and candidate.expires_at <= now()
        )
        and nullif(trim(coalesce(candidate.payment_method_summary, '')), '') is not null
        and (
          nullif(trim(coalesce(candidate.provider_payment_id, '')), '') is not null
          or exists (
            select 1
            from public.payment_attempts attempt
            where attempt.order_id = candidate.id
          )
        )
    end
    order by candidate.created_at desc
    limit p_limit
  ) entry;

  return result;
end;
$$;

revoke all on function public.list_my_visible_orders(integer) from public, anon;
grant execute on function public.list_my_visible_orders(integer) to authenticated;

commit;

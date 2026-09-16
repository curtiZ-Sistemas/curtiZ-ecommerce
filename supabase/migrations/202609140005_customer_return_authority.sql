-- Customer returns must use the ownership-validating, serialized RPC.
drop policy if exists "customer requests returns" on public.returns;

create or replace function public.request_customer_return(
  p_order_item_id uuid,
  p_quantity integer,
  p_reason text,
  p_description text,
  p_resolution text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  customer_order_id uuid;
  available_quantity integer;
  new_return_id uuid;
begin
  if auth.uid() is null or not private.is_active_user() then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  select item.order_id, item.quantity
  into customer_order_id, available_quantity
  from public.order_items item
  join public.orders customer_order on customer_order.id = item.order_id
  where item.id = p_order_item_id
    and customer_order.customer_id = auth.uid()
    and customer_order.status = 'delivered'
  for update of item, customer_order;

  if customer_order_id is null then
    raise exception 'delivered_item_not_found' using errcode = 'P0002';
  end if;

  if p_quantity is null or p_quantity < 1 or p_quantity > available_quantity then
    raise exception 'invalid_return_quantity' using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.return_items existing_item
    join public.returns existing_return on existing_return.id = existing_item.return_id
    where existing_item.order_item_id = p_order_item_id
      and existing_return.customer_id = auth.uid()
      and existing_return.status not in ('rejected', 'completed', 'cancelled')
  ) then
    raise exception 'open_return_already_exists' using errcode = '23505';
  end if;

  if char_length(trim(p_reason)) not between 3 and 120
    or char_length(trim(p_description)) not between 10 and 2000
    or p_resolution not in ('exchange', 'refund', 'store_credit') then
    raise exception 'invalid_return_request' using errcode = '23514';
  end if;

  insert into public.returns(
    order_id, customer_id, reason, description, requested_resolution,
    eligibility_snapshot
  )
  values (
    customer_order_id, auth.uid(), trim(p_reason), trim(p_description), p_resolution,
    jsonb_build_object(
      'orderStatus', 'delivered',
      'requestedQuantity', p_quantity,
      'requiresManualReview', true,
      'evaluatedAt', now()
    )
  )
  returning id into new_return_id;

  insert into public.return_items(return_id, order_item_id, quantity)
  values (new_return_id, p_order_item_id, p_quantity);

  update public.orders
  set status = 'return_requested', updated_at = now()
  where id = customer_order_id and status = 'delivered';

  return new_return_id;
end;
$$;

notify pgrst, 'reload schema';

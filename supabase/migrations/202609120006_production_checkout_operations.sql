-- Bounded public stock lookup, customer-visible order pagination and serialized housekeeping.
begin;

create or replace function public.cart_variant_stock_availability(p_variant_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'variantId', requested.id,
        'unavailableAt', retired.retired_at,
        'available', coalesce(
          variant.active
          and product.status = 'active'
          and stock.available_quantity > 0,
          false
        )
      ) order by requested.position
    ),
    '[]'::jsonb
  )
  from unnest(p_variant_ids) with ordinality requested(id, position)
  left join public.product_variants variant on variant.id = requested.id
  left join public.products product on product.id = variant.product_id
  left join public.inventory stock on stock.variant_id = variant.id
  left join public.catalog_retired_variants retired on retired.variant_id = requested.id
  where requested.position <= 50;
$$;

revoke all on function public.cart_variant_stock_availability(uuid[]) from public;
grant execute on function public.cart_variant_stock_availability(uuid[]) to anon, authenticated;

create or replace function public.cart_variant_availability(p_variant_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.cart_variant_stock_availability(p_variant_ids);
$$;
revoke all on function public.cart_variant_availability(uuid[]) from public;
grant execute on function public.cart_variant_availability(uuid[]) to anon, authenticated;

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
    select sale.created_at,
      jsonb_build_object(
        'id', sale.id,
        'public_code', sale.public_code,
        'status', sale.status,
        'payment_status', sale.payment_status,
        'subtotal', sale.subtotal,
        'discount_total', sale.discount_total,
        'shipping_total', sale.shipping_total,
        'grand_total', sale.grand_total,
        'shipping_address_snapshot', sale.shipping_address_snapshot,
        'cpf_last_four', sale.cpf_last_four,
        'placed_at', sale.placed_at,
        'created_at', sale.created_at
      ) as payload
    from public.orders sale
    join lateral (
      select payment.id, payment.provider_payment_id, payment.status,
        payment.status_detail, payment.expires_at, payment.payment_method_summary
      from public.payments payment
      where payment.order_id = sale.id
      order by payment.created_at desc
      limit 1
    ) payment on true
    where sale.customer_id = auth.uid()
      and coalesce(payment.status_detail, '') <> 'expired'
      and not (
        payment.status in ('pending', 'rejected', 'cancelled')
        and payment.expires_at is not null
        and payment.expires_at <= now()
      )
      and nullif(trim(coalesce(payment.payment_method_summary, '')), '') is not null
      and (
        nullif(trim(coalesce(payment.provider_payment_id, '')), '') is not null
        or exists (
          select 1 from public.payment_attempts attempt where attempt.order_id = sale.id
        )
      )
    order by sale.created_at desc
    limit p_limit
  ) entry;

  return result;
end;
$$;

revoke all on function public.list_my_visible_orders(integer) from public, anon;
grant execute on function public.list_my_visible_orders(integer) to authenticated;

create or replace function private.expire_stale_mercadopago_orders(p_limit integer default 50)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate record;
  expired_count integer := 0;
begin
  if p_limit is null or p_limit not between 1 and 250 then
    raise exception 'invalid_expiration_limit' using errcode = '22023';
  end if;

  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('curtiz:expire-stale-mercadopago-orders', 0)
  ) then
    return 0;
  end if;

  for candidate in
    select payment.order_id
    from public.payments payment
    join public.orders sale on sale.id = payment.order_id
    where sale.status = 'pending_payment'
      and payment.provider = 'mercadopago'
      and payment.status in ('pending', 'rejected')
      and payment.expires_at <= now()
    order by payment.expires_at
    limit p_limit
  loop
    if private.expire_stale_mercadopago_order(candidate.order_id) then
      expired_count := expired_count + 1;
    end if;
  end loop;

  return expired_count;
end;
$$;

revoke all on function private.expire_stale_mercadopago_orders(integer)
  from public, anon, authenticated;

drop policy if exists "customer owns private objects" on storage.objects;
create policy "customer owns non-support private objects"
on storage.objects for select to authenticated
using (
  bucket_id = 'customer-private'
  and (storage.foldername(name))[1] = auth.uid()::text
  and coalesce((storage.foldername(name))[2], '') <> 'support'
);

drop policy if exists "customer removes private objects" on storage.objects;
create policy "customer removes non-support private objects"
on storage.objects for delete to authenticated
using (
  bucket_id = 'customer-private'
  and (storage.foldername(name))[1] = auth.uid()::text
  and coalesce((storage.foldername(name))[2], '') <> 'support'
);

drop policy if exists "support participants read attachment files" on storage.objects;
create policy "support participants read clean attachment files"
on storage.objects for select to authenticated
using (
  bucket_id = 'customer-private'
  and exists (
    select 1
    from public.support_attachments attachment
    join public.support_messages message on message.id = attachment.message_id
    join public.support_conversations conversation on conversation.id = message.conversation_id
    where attachment.storage_path = name
      and attachment.scan_status = 'clean'
      and private.can_access_support(conversation)
      and (conversation.customer_id <> auth.uid() or not message.is_internal_note)
  )
);

drop policy if exists "support authors remove failed attachment uploads" on storage.objects;
create policy "support authors remove unscanned attachment uploads"
on storage.objects for delete to authenticated
using (
  bucket_id = 'customer-private'
  and name like auth.uid()::text || '/support/%'
  and not exists (
    select 1 from public.support_attachments attachment
    where attachment.storage_path = name and attachment.scan_status = 'clean'
  )
);

drop policy if exists "support participants create attachment metadata" on public.support_attachments;
create policy "support participants create pending attachment metadata"
on public.support_attachments for insert to authenticated
with check (
  scan_status = 'pending'
  and storage_path like auth.uid()::text || '/support/%'
  and exists (
    select 1
    from public.support_messages message
    join public.support_conversations conversation on conversation.id = message.conversation_id
    where message.id = message_id
      and message.sender_id = auth.uid()
      and private.can_access_support(conversation)
  )
);

commit;

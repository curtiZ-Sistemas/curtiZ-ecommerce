-- Área customer: perfil, avaliações, notificações, cancelamentos e devoluções.

alter table public.profiles
  add column if not exists birth_date date,
  add column if not exists cpf_last_four char(4)
    check (cpf_last_four is null or cpf_last_four ~ '^[0-9]{4}$');

alter table public.profiles
  add constraint profiles_birth_date_reasonable
  check (birth_date is null or birth_date >= date '1900-01-01');

create unique index if not exists reviews_one_per_order_item
  on public.reviews(customer_id, order_item_id)
  where order_item_id is not null;

drop policy if exists "customer creates reviews" on public.reviews;
create policy "customer creates delivered purchase reviews" on public.reviews
  for insert to authenticated with check (
    customer_id = auth.uid()
    and private.is_active_user()
    and order_item_id is not null
    and verified_purchase
    and status = 'pending'
    and exists (
      select 1
      from public.order_items item
      join public.orders customer_order on customer_order.id = item.order_id
      where item.id = order_item_id
        and item.product_id = reviews.product_id
        and item.variant_id = reviews.variant_id
        and customer_order.customer_id = auth.uid()
        and customer_order.status = 'delivered'
    )
  );

create policy "customer reads own reviews" on public.reviews
  for select to authenticated using (customer_id = auth.uid());

create policy "customer edits own pending reviews" on public.reviews
  for update to authenticated using (
    customer_id = auth.uid() and status in ('pending', 'rejected')
  )
  with check (
    customer_id = auth.uid()
    and status = 'pending'
    and verified_purchase
    and moderated_by is null
  );

create policy "customer updates own notifications" on public.notifications
  for update to authenticated using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "customer reads own return items" on public.return_items
  for select to authenticated using (
    exists (
      select 1
      from public.returns customer_return
      where customer_return.id = return_id
        and customer_return.customer_id = auth.uid()
    )
  );

create table if not exists public.review_media (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews(id) on delete cascade,
  customer_id uuid not null references public.profiles(id) on delete cascade,
  storage_path text not null unique,
  media_type text not null check (media_type in ('image', 'video')),
  mime_type text not null check (
    mime_type in ('image/jpeg', 'image/png', 'image/webp', 'video/mp4')
  ),
  size_bytes integer not null check (size_bytes between 1 and 15728640),
  created_at timestamptz not null default now()
);

create index if not exists review_media_review_idx
  on public.review_media(review_id, created_at);

alter table public.review_media enable row level security;
alter table public.review_media force row level security;

create policy "customer owns review media" on public.review_media
  for all to authenticated using (
    customer_id = auth.uid()
    and exists (
      select 1 from public.reviews customer_review
      where customer_review.id = review_id
        and customer_review.customer_id = auth.uid()
    )
  )
  with check (
    customer_id = auth.uid()
    and exists (
      select 1 from public.reviews customer_review
      where customer_review.id = review_id
        and customer_review.customer_id = auth.uid()
        and customer_review.status in ('pending', 'rejected')
    )
  );

update storage.buckets
set
  file_size_limit = 15728640,
  allowed_mime_types = array['image/jpeg','image/png','image/webp','video/mp4','application/pdf']
where id = 'customer-private';

drop policy if exists "customer uploads private objects" on storage.objects;
create policy "customer uploads private objects" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'customer-private'
    and (storage.foldername(name))[1] = auth.uid()::text
    and lower(storage.extension(name)) in ('jpg','jpeg','png','webp','mp4','pdf')
  );

create policy "customer removes private objects" on storage.objects
  for delete to authenticated using (
    bucket_id = 'customer-private'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create or replace function public.request_customer_order_cancellation(p_order_id uuid)
returns public.order_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_status public.order_status;
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  select customer_order.status
  into previous_status
  from public.orders customer_order
  where customer_order.id = p_order_id
    and customer_order.customer_id = auth.uid()
  for update;

  if previous_status is null then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;

  if previous_status not in ('pending_payment', 'payment_approved', 'processing') then
    raise exception 'cancellation_not_allowed' using errcode = '23514';
  end if;

  update public.orders
  set status = 'cancellation_requested', updated_at = now()
  where id = p_order_id;

  insert into public.order_status_history(
    order_id, previous_status, new_status, reason, changed_by
  )
  values (
    p_order_id, previous_status, 'cancellation_requested',
    'Solicitação realizada pelo cliente.', auth.uid()
  );

  return 'cancellation_requested';
end;
$$;

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
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  select item.order_id, item.quantity
  into customer_order_id, available_quantity
  from public.order_items item
  join public.orders customer_order on customer_order.id = item.order_id
  where item.id = p_order_item_id
    and customer_order.customer_id = auth.uid()
    and customer_order.status = 'delivered';

  if customer_order_id is null then
    raise exception 'delivered_item_not_found' using errcode = 'P0002';
  end if;

  if p_quantity < 1 or p_quantity > available_quantity then
    raise exception 'invalid_return_quantity' using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.return_items existing_item
    join public.returns existing_return on existing_return.id = existing_item.return_id
    where existing_item.order_item_id = p_order_item_id
      and existing_return.customer_id = auth.uid()
      and existing_return.status not in ('rejected', 'resolved', 'cancelled')
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

create or replace function public.save_customer_address(
  p_id uuid,
  p_label text,
  p_recipient_name text,
  p_postal_code text,
  p_street text,
  p_number text,
  p_complement text,
  p_district text,
  p_city text,
  p_state text,
  p_is_default boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_id uuid;
  normalized_state text := upper(trim(p_state));
  normalized_postal_code text := regexp_replace(p_postal_code, '[^0-9]', '', 'g');
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  if char_length(trim(p_label)) not between 2 and 40
    or char_length(trim(p_recipient_name)) not between 3 and 120
    or normalized_postal_code !~ '^[0-9]{8}$'
    or char_length(trim(p_street)) not between 2 and 160
    or char_length(trim(p_number)) not between 1 and 20
    or char_length(trim(p_district)) not between 2 and 100
    or char_length(trim(p_city)) not between 2 and 100
    or normalized_state !~ '^[A-Z]{2}$' then
    raise exception 'invalid_address' using errcode = '23514';
  end if;

  if p_is_default then
    update public.addresses
    set is_default = false, updated_at = now()
    where user_id = auth.uid() and is_default;
  end if;

  if p_id is null then
    insert into public.addresses(
      user_id, label, recipient_name, postal_code, street, number, complement,
      district, city, state, is_default
    )
    values (
      auth.uid(), trim(p_label), trim(p_recipient_name), normalized_postal_code,
      trim(p_street), trim(p_number), nullif(trim(p_complement), ''),
      trim(p_district), trim(p_city), normalized_state, p_is_default
    )
    returning id into saved_id;
  else
    update public.addresses
    set
      label = trim(p_label),
      recipient_name = trim(p_recipient_name),
      postal_code = normalized_postal_code,
      street = trim(p_street),
      number = trim(p_number),
      complement = nullif(trim(p_complement), ''),
      district = trim(p_district),
      city = trim(p_city),
      state = normalized_state,
      is_default = p_is_default,
      updated_at = now()
    where id = p_id and user_id = auth.uid()
    returning id into saved_id;

    if saved_id is null then
      raise exception 'address_not_found' using errcode = 'P0002';
    end if;
  end if;

  if not exists (
    select 1 from public.addresses
    where user_id = auth.uid() and is_default
  ) then
    update public.addresses set is_default = true, updated_at = now()
    where id = saved_id;
  end if;

  return saved_id;
end;
$$;

revoke all on function public.request_customer_order_cancellation(uuid) from public;
revoke all on function public.request_customer_return(uuid, integer, text, text, text) from public;
revoke all on function public.save_customer_address(
  uuid, text, text, text, text, text, text, text, text, text, boolean
) from public;
grant execute on function public.request_customer_order_cancellation(uuid) to authenticated;
grant execute on function public.request_customer_return(uuid, integer, text, text, text)
  to authenticated;
grant execute on function public.save_customer_address(
  uuid, text, text, text, text, text, text, text, text, text, boolean
) to authenticated;

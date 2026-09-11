begin;

create table if not exists private.customer_checkout_identity (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  cpf_ciphertext text not null,
  cpf_last_four char(4) not null check (cpf_last_four ~ '^[0-9]{4}$'),
  updated_at timestamptz not null default now()
);
revoke all on table private.customer_checkout_identity from public, anon, authenticated;

create or replace function private.purge_checkout_identity_on_profile_disable()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'disabled' and old.status is distinct from new.status then
    delete from private.customer_checkout_identity where user_id=new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists purge_checkout_identity_on_profile_disable on public.profiles;
create trigger purge_checkout_identity_on_profile_disable
after update of status on public.profiles for each row
execute function private.purge_checkout_identity_on_profile_disable();
revoke all on function private.purge_checkout_identity_on_profile_disable() from public, anon, authenticated;

create or replace function public.save_my_checkout_identity(p_cpf_ciphertext text, p_cpf_last_four text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if nullif(trim(p_cpf_ciphertext),'') is null or p_cpf_last_four !~ '^[0-9]{4}$' then
    raise exception 'invalid_customer_identity' using errcode='22023';
  end if;
  insert into private.customer_checkout_identity(user_id,cpf_ciphertext,cpf_last_four)
  values(auth.uid(),p_cpf_ciphertext,p_cpf_last_four)
  on conflict(user_id) do update set cpf_ciphertext=excluded.cpf_ciphertext,
    cpf_last_four=excluded.cpf_last_four,updated_at=now();
  update public.profiles set cpf_last_four=p_cpf_last_four,updated_at=now() where id=auth.uid();
  return true;
end;
$$;
revoke all on function public.save_my_checkout_identity(text,text) from public, anon;
grant execute on function public.save_my_checkout_identity(text,text) to authenticated;

-- A cotacao valida carrinho, estoque e cupom sem materializar um pedido.
create or replace function public.preview_professional_checkout(
  p_lines jsonb,
  p_coupon_code text default null,
  p_postal_code text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_count integer;
  valid_count integer;
  subtotal numeric(12,2);
  discount_result jsonb := '{}'::jsonb;
  discount_cents bigint := 0;
  shipping_cents constant bigint := 1690;
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 50 then
    raise exception 'invalid_checkout_lines' using errcode = '22023';
  end if;

  select count(*), count(checked.variant_id), coalesce(sum(checked.line_total), 0)
  into requested_count, valid_count, subtotal
  from jsonb_to_recordset(p_lines) requested(product_id uuid, variant_id uuid, quantity integer)
  left join lateral (
    select variant.id variant_id,
      coalesce(variant.price_override, product.base_price) * requested.quantity line_total
    from public.product_variants variant
    join public.products product on product.id = variant.product_id
    join public.inventory stock on stock.variant_id = variant.id
    where variant.id = requested.variant_id
      and variant.product_id = requested.product_id
      and variant.active and product.status = 'active'
      and requested.quantity between 1 and 10
      and stock.available_quantity >= requested.quantity
  ) checked on true;

  if requested_count <> valid_count or subtotal <= 0 then
    raise exception 'checkout_line_unavailable' using errcode = 'P0001';
  end if;

  if nullif(trim(coalesce(p_coupon_code, '')), '') is not null then
    discount_result := public.preview_checkout_coupon(trim(p_coupon_code), p_lines, p_postal_code);
    discount_cents := coalesce((discount_result->>'discountInCents')::bigint, 0);
  end if;

  return jsonb_build_object(
    'subtotalInCents', round(subtotal * 100)::bigint,
    'discountInCents', discount_cents,
    'couponName', coalesce(discount_result->>'name', ''),
    'shippingInCents', shipping_cents,
    'amountInCents', round(subtotal * 100)::bigint - discount_cents + shipping_cents
  );
end;
$$;

revoke all on function public.preview_professional_checkout(jsonb,text,text) from public, anon;
grant execute on function public.preview_professional_checkout(jsonb,text,text) to authenticated;

-- Somente a confirmacao de um metodo de pagamento pode transformar o checkout em pedido.
create or replace function public.confirm_professional_checkout_order(
  p_idempotency_key uuid,
  p_customer_id uuid,
  p_payment_method_id text,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_cpf_ciphertext text,
  p_cpf_last_four text,
  p_shipping_address jsonb,
  p_lines jsonb,
  p_coupon_code text default null,
  p_reservation_minutes integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  created jsonb;
  created_order_id uuid;
  normalized_method text := lower(trim(coalesce(p_payment_method_id, '')));
  address_snapshot jsonb;
  effective_ciphertext text := nullif(trim(p_cpf_ciphertext), '');
  effective_last_four text := nullif(trim(p_cpf_last_four), '');
  stored_order public.orders%rowtype;
  requested_line_count integer;
  matching_line_count integer;
begin
  if p_customer_id is null then raise exception 'customer_required' using errcode = '22023'; end if;
  perform pg_catalog.set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_customer_id, 'role', 'authenticated')::text,
    true
  );
  if auth.uid() is distinct from p_customer_id then
    raise exception 'customer_context_failed' using errcode = '42501';
  end if;
  if normalized_method !~ '^[a-z0-9_-]{2,50}$' then
    raise exception 'invalid_payment_method' using errcode = '22023';
  end if;
  address_snapshot := p_shipping_address || jsonb_build_object(
    'recipient_name', trim(p_customer_name), 'postal_code', p_shipping_address->>'postalCode',
    'street', p_shipping_address->>'street', 'number', p_shipping_address->>'number',
    'complement', coalesce(p_shipping_address->>'complement', ''),
    'district', p_shipping_address->>'district', 'city', p_shipping_address->>'city',
    'state', upper(p_shipping_address->>'state'), 'phone', nullif(trim(p_customer_phone), '')
  );
  if effective_ciphertext is null or effective_last_four is null then
    select cpf_ciphertext,cpf_last_four into effective_ciphertext,effective_last_four
    from private.customer_checkout_identity where user_id=auth.uid();
  else
    perform public.save_my_checkout_identity(effective_ciphertext,effective_last_four);
  end if;
  if effective_ciphertext is null or effective_last_four !~ '^[0-9]{4}$' then
    raise exception 'customer_identity_required' using errcode='22023';
  end if;
  created := public.create_professional_checkout_order(
    p_idempotency_key, p_customer_name, p_customer_email, p_customer_phone,
    effective_ciphertext, effective_last_four, address_snapshot, p_lines,
    p_coupon_code, p_reservation_minutes
  );
  created_order_id := (created->>'orderId')::uuid;
  if coalesce((created->>'reused')::boolean,false) then
    select * into stored_order from public.orders where id=created_order_id and customer_id=auth.uid();
    if stored_order.id is null
      or stored_order.customer_name_snapshot <> trim(p_customer_name)
      or stored_order.customer_email_snapshot::text <> lower(trim(p_customer_email))
      or coalesce(stored_order.customer_phone_snapshot,'') <> coalesce(nullif(trim(p_customer_phone),''),'')
      or stored_order.shipping_address_snapshot <> address_snapshot then
      raise exception 'idempotency_conflict' using errcode='22023';
    end if;
    select jsonb_array_length(p_lines),count(*) into requested_line_count,matching_line_count
    from public.order_items item
    join jsonb_to_recordset(p_lines) requested(product_id uuid,variant_id uuid,quantity integer)
      on requested.product_id=item.product_id and requested.variant_id=item.variant_id and requested.quantity=item.quantity
    where item.order_id=created_order_id;
    if requested_line_count <> matching_line_count
      or requested_line_count <> (select count(*) from public.order_items where order_id=created_order_id) then
      raise exception 'idempotency_conflict' using errcode='22023';
    end if;
  end if;
  if exists(select 1 from public.orders where id=created_order_id
    and commercial_rules_snapshot ? 'paymentMethodSelected'
    and commercial_rules_snapshot->>'paymentMethodSelected' <> normalized_method) then
    raise exception 'idempotency_conflict' using errcode='22023';
  end if;
  update public.orders
  set commercial_rules_snapshot = coalesce(commercial_rules_snapshot, '{}'::jsonb)
      || jsonb_build_object('paymentMethodSelected', normalized_method), updated_at = now()
  where id = created_order_id and customer_id = auth.uid();
  update public.payments
  set payment_method_summary = 'selected:' || normalized_method, updated_at = now()
  where order_id = created_order_id and provider = 'mercadopago';
  return created;
end;
$$;

revoke all on function public.create_professional_checkout_order(uuid,text,text,text,text,text,jsonb,jsonb,text,integer)
  from authenticated;
revoke all on function public.create_mercadopago_test_order(uuid,text,text,text,text,text,jsonb,jsonb,integer)
  from authenticated;
revoke all on function public.confirm_professional_checkout_order(uuid,uuid,text,text,text,text,text,text,jsonb,jsonb,text,integer)
  from public, anon, authenticated;
grant execute on function public.confirm_professional_checkout_order(uuid,uuid,text,text,text,text,text,text,jsonb,jsonb,text,integer)
  to service_role;

create table if not exists public.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  payment_id uuid not null references public.payments(id) on delete cascade,
  provider text not null,
  provider_payment_id text unique,
  idempotency_key uuid not null,
  payment_method text not null,
  status public.payment_status not null default 'pending',
  status_detail text,
  amount numeric(12,2) not null check (amount > 0),
  currency char(3) not null default 'BRL',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider, idempotency_key)
);
create index if not exists payment_attempts_order_idx on public.payment_attempts(order_id, created_at desc);
alter table public.payment_attempts enable row level security;
alter table public.payment_attempts force row level security;
drop policy if exists "customer reads own payment attempts" on public.payment_attempts;
create policy "customer reads own payment attempts" on public.payment_attempts
  for select to authenticated using (
    exists(select 1 from public.orders sale where sale.id = order_id and sale.customer_id = auth.uid())
  );
drop policy if exists "finance reads payment attempts" on public.payment_attempts;
create policy "finance reads payment attempts" on public.payment_attempts
  for select to authenticated using (private.has_permission('finance.reconcile'));
grant select on public.payment_attempts to authenticated;
grant all privileges on public.payment_attempts to service_role;

create or replace function public.begin_mercadopago_payment_attempt(
  p_order_id uuid, p_idempotency_key uuid, p_payment_method text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  local_payment public.payments%rowtype;
  attempt public.payment_attempts%rowtype;
begin
  select payment.* into local_payment
  from public.payments payment join public.orders sale on sale.id=payment.order_id
  where payment.order_id=p_order_id and payment.provider='mercadopago' and sale.status='pending_payment'
  for update of payment;
  if local_payment.id is null then raise exception 'payment_not_eligible' using errcode='P0001'; end if;
  insert into public.payment_attempts(order_id,payment_id,provider,idempotency_key,payment_method,status,amount,currency)
  values(p_order_id,local_payment.id,'mercadopago',p_idempotency_key,lower(trim(p_payment_method)),'pending',local_payment.amount,local_payment.currency)
  on conflict(provider,idempotency_key) do update set updated_at=now()
  returning * into attempt;
  if attempt.order_id <> p_order_id then raise exception 'idempotency_conflict' using errcode='42501'; end if;
  if attempt.payment_method <> lower(trim(p_payment_method)) then
    raise exception 'idempotency_conflict' using errcode='22023';
  end if;
  return jsonb_build_object('id',attempt.id,'providerPaymentId',attempt.provider_payment_id,'status',attempt.status);
end;
$$;
revoke all on function public.begin_mercadopago_payment_attempt(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.begin_mercadopago_payment_attempt(uuid,uuid,text) to service_role;

-- Enderecos Casa/Trabalho recebem sufixo amigavel de forma atomica no servidor.
create or replace function public.save_customer_address(
  p_id uuid, p_label text, p_recipient_name text, p_postal_code text, p_street text,
  p_number text, p_complement text, p_district text, p_city text, p_state text,
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
  base_label text := regexp_replace(trim(p_label), '\s+[0-9]+$', '');
  final_label text;
  next_suffix integer;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('address-save:' || auth.uid()::text, 0));
  if base_label not in ('Casa', 'Trabalho') then base_label := trim(p_label); end if;
  if char_length(base_label) not between 2 and 40
    or char_length(trim(p_recipient_name)) not between 3 and 120
    or normalized_postal_code !~ '^[0-9]{8}$'
    or char_length(trim(p_street)) not between 2 and 160
    or char_length(trim(p_number)) not between 1 and 20
    or char_length(trim(p_district)) not between 2 and 100
    or char_length(trim(p_city)) not between 2 and 100
    or normalized_state !~ '^[A-Z]{2}$' then
    raise exception 'invalid_address' using errcode = '23514';
  end if;
  final_label := trim(p_label);
  if p_id is null then
    if base_label in ('Casa','Trabalho') then
      select coalesce(max(case when label = base_label then 1
        when label ~ ('^' || base_label || ' [0-9]+$') then substring(label from '([0-9]+)$')::integer
        else 0 end), 0) + 1 into next_suffix
      from public.addresses where user_id = auth.uid()
        and (label = base_label or label ~ ('^' || base_label || ' [0-9]+$'));
      final_label := case when next_suffix = 1 then base_label else base_label || ' ' || next_suffix end;
    end if;
  end if;
  if p_is_default then
    update public.addresses set is_default = false, updated_at = now()
    where user_id = auth.uid() and is_default;
  end if;
  if p_id is null then
    insert into public.addresses(user_id,label,recipient_name,postal_code,street,number,complement,district,city,state,is_default)
    values(auth.uid(),final_label,trim(p_recipient_name),normalized_postal_code,trim(p_street),trim(p_number),
      nullif(trim(p_complement),''),trim(p_district),trim(p_city),normalized_state,p_is_default)
    returning id into saved_id;
  else
    update public.addresses set label=final_label,recipient_name=trim(p_recipient_name),postal_code=normalized_postal_code,
      street=trim(p_street),number=trim(p_number),complement=nullif(trim(p_complement),''),district=trim(p_district),
      city=trim(p_city),state=normalized_state,is_default=p_is_default,updated_at=now()
    where id=p_id and user_id=auth.uid() returning id into saved_id;
    if saved_id is null then raise exception 'address_not_found' using errcode = 'P0002'; end if;
  end if;
  if not exists(select 1 from public.addresses where user_id=auth.uid() and is_default) then
    update public.addresses set is_default=true,updated_at=now() where id=saved_id;
  end if;
  return saved_id;
end;
$$;

revoke all on function public.save_customer_address(uuid,text,text,text,text,text,text,text,text,text,boolean) from public, anon;
grant execute on function public.save_customer_address(uuid,text,text,text,text,text,text,text,text,text,boolean) to authenticated;

-- Uma recusa preserva o pedido e a reserva para permitir nova tentativa no mesmo pedido.
create or replace function public.finalize_mercadopago_payment(
  p_provider_event_id text, p_provider_payment_id text, p_external_reference text,
  p_amount numeric, p_currency text, p_status public.payment_status,
  p_paid_at timestamptz default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  local_payment public.payments%rowtype;
  previous_order_status public.order_status;
begin
  select * into local_payment from public.payments
  where external_reference = p_external_reference for update;
  if local_payment.id is null or local_payment.amount <> p_amount or local_payment.currency <> p_currency then
    update public.payment_events set processing_status='manual_review',processed_at=now(),error_summary='payment_mismatch'
    where provider='mercadopago' and provider_event_id=p_provider_event_id;
    return 'manual_review';
  end if;
  update public.payments set provider_payment_id=p_provider_payment_id,status=p_status,
    paid_at=case when p_status='approved' then coalesce(p_paid_at,paid_at,now()) else paid_at end,updated_at=now()
  where id=local_payment.id;
  update public.payment_attempts set status=p_status,updated_at=now()
  where provider='mercadopago' and provider_payment_id=p_provider_payment_id;
  if p_status='approved' and local_payment.status <> 'approved' then
    perform private.convert_order_reservations(local_payment.order_id);
    update public.orders set status='payment_approved',payment_status='approved',placed_at=coalesce(placed_at,now()),updated_at=now()
    where id=local_payment.order_id and status='pending_payment';
  elsif p_status='cancelled' then
    select status into previous_order_status from public.orders where id=local_payment.order_id for update;
    perform private.release_order_reservations(local_payment.order_id);
    update public.orders set status='cancelled',payment_status='cancelled',updated_at=now()
    where id=local_payment.order_id and status='pending_payment';
    if previous_order_status='pending_payment' then
      insert into public.order_status_history(order_id,previous_status,new_status,reason)
      values(local_payment.order_id,previous_order_status,'cancelled','Pagamento cancelado pelo provedor');
    end if;
  elsif p_status='rejected' then
    update public.orders set payment_status='rejected',updated_at=now()
    where id=local_payment.order_id and status='pending_payment';
  elsif p_status in ('charged_back','in_review') then
    update public.orders set status='manual_review',payment_status=p_status,updated_at=now()
    where id=local_payment.order_id;
  elsif p_status='refunded' then
    update public.orders set status='refunded',payment_status='refunded',updated_at=now()
    where id=local_payment.order_id;
  else
    update public.orders set payment_status=p_status,updated_at=now() where id=local_payment.order_id;
  end if;
  update public.payment_events set processing_status='processed',processed_at=now(),error_summary=null
  where provider='mercadopago' and provider_event_id=p_provider_event_id;
  return 'processed';
end;
$$;

revoke all on function public.finalize_mercadopago_payment(text,text,text,numeric,text,public.payment_status,timestamptz)
  from public, anon, authenticated;
grant execute on function public.finalize_mercadopago_payment(text,text,text,numeric,text,public.payment_status,timestamptz)
  to service_role;

commit;
notify pgrst, 'reload schema';

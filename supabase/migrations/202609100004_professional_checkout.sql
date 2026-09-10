begin;

alter table public.payments
  add column if not exists status_detail text,
  add column if not exists expires_at timestamptz,
  add column if not exists pix_copy_paste text,
  add column if not exists pix_qr_code_base64 text,
  add column if not exists boleto_url text,
  add column if not exists digitable_line text;

create or replace function private.enforce_customer_address_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('address-limit:' || new.user_id::text, 0));
  if (select count(*) from public.addresses where user_id = new.user_id) >= 3 then
    raise exception 'address_limit_reached' using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists enforce_customer_address_limit on public.addresses;
create trigger enforce_customer_address_limit before insert on public.addresses
for each row execute function private.enforce_customer_address_limit();
revoke all on function private.enforce_customer_address_limit() from public, anon, authenticated;

create or replace function public.delete_customer_address(p_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare deleted_default boolean; replacement_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  select is_default into deleted_default from public.addresses
  where id = p_id and user_id = auth.uid() for update;
  if deleted_default is null then raise exception 'address_not_found' using errcode = 'P0002'; end if;
  delete from public.addresses where id = p_id and user_id = auth.uid();
  if deleted_default then
    select id into replacement_id from public.addresses where user_id = auth.uid()
    order by updated_at desc, created_at desc limit 1 for update;
    update public.addresses set is_default = true, updated_at = now() where id = replacement_id;
  end if;
  return true;
end;
$$;
revoke all on function public.delete_customer_address(uuid) from public, anon;
grant execute on function public.delete_customer_address(uuid) to authenticated;

create or replace function public.preview_checkout_coupon(p_code text, p_lines jsonb, p_postal_code text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare coupon public.coupons%rowtype; subtotal numeric(12,2); eligible_subtotal numeric(12,2);
  requested_count integer; valid_count integer; total_uses integer; customer_uses integer; discount numeric(12,2);
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 50 then
    raise exception 'invalid_coupon_lines' using errcode = '22023';
  end if;
  select * into coupon from public.coupons where code = trim(p_code);
  if coupon.id is null or not coupon.active or coupon.requires_manager_approval
    or now() not between coupon.starts_at and coupon.ends_at then
    raise exception 'invalid_coupon' using errcode = 'P0001';
  end if;
  select count(*), count(checked.variant_id), coalesce(sum(checked.line_total), 0),
    coalesce(sum(checked.line_total) filter (where
      not exists(select 1 from public.coupon_scopes scope where scope.coupon_id = coupon.id)
      or exists(select 1 from public.coupon_scopes scope where scope.coupon_id = coupon.id and (
        scope.variant_id = checked.variant_id or scope.product_id = checked.product_id
        or scope.collection_id = checked.collection_id
        or scope.category_id = checked.category_id
        or exists(select 1 from public.product_categories pc where pc.product_id = checked.product_id and pc.category_id = scope.category_id)
        or (scope.region_prefix is not null and regexp_replace(p_postal_code, '[^0-9]', '', 'g') like scope.region_prefix || '%')
      ))), 0)
  into requested_count, valid_count, subtotal, eligible_subtotal
  from jsonb_to_recordset(p_lines) requested(product_id uuid, variant_id uuid, quantity integer)
  left join lateral (
    select variant.id variant_id, product.id product_id, product.category_id, product.collection_id,
      coalesce(variant.price_override, product.base_price) * requested.quantity line_total
    from public.product_variants variant join public.products product on product.id = variant.product_id
    where variant.id = requested.variant_id and variant.product_id = requested.product_id and variant.active
      and product.status = 'active' and requested.quantity between 1 and 10
  ) checked on true;
  if requested_count <> valid_count or subtotal <= 0 or eligible_subtotal <= 0
    or subtotal < coupon.minimum_order_value then raise exception 'invalid_coupon' using errcode = 'P0001'; end if;
  select count(*) into total_uses from public.coupon_redemptions where coupon_id = coupon.id;
  select count(*) into customer_uses from public.coupon_redemptions where coupon_id = coupon.id and customer_id = auth.uid();
  if (coupon.usage_limit is not null and total_uses >= coupon.usage_limit)
    or (coupon.usage_limit_per_customer is not null and customer_uses >= coupon.usage_limit_per_customer) then
    raise exception 'coupon_limit_reached' using errcode = 'P0001';
  end if;
  discount := case coupon.discount_type when 'percentage' then round(eligible_subtotal * coupon.discount_value / 100, 2)
    when 'fixed' then least(eligible_subtotal, coupon.discount_value) else 0 end;
  if coupon.maximum_discount is not null then discount := least(discount, coupon.maximum_discount); end if;
  if discount <= 0 then raise exception 'invalid_coupon' using errcode = 'P0001'; end if;
  return jsonb_build_object('name', coupon.name, 'discountInCents', round(discount * 100)::bigint);
end;
$$;
revoke all on function public.preview_checkout_coupon(text,jsonb,text) from public, anon;
grant execute on function public.preview_checkout_coupon(text,jsonb,text) to authenticated;

create or replace function public.apply_checkout_coupon(p_order_id uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare sale public.orders%rowtype; coupon public.coupons%rowtype; discount numeric(12,2); eligible_subtotal numeric(12,2);
  total_uses integer; customer_uses integer;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  select * into sale from public.orders where id = p_order_id and customer_id = auth.uid() for update;
  if sale.id is null or sale.status <> 'pending_payment' then raise exception 'order_not_eligible' using errcode = 'P0001'; end if;
  if sale.coupon_id is not null then
    return jsonb_build_object('name', (select name from public.coupons where id = sale.coupon_id), 'discountInCents', round(sale.discount_total * 100)::bigint, 'amountInCents', round(sale.grand_total * 100)::bigint);
  end if;
  select * into coupon from public.coupons where code = trim(p_code) for update;
  if coupon.id is null or not coupon.active or coupon.requires_manager_approval
    or now() not between coupon.starts_at and coupon.ends_at
    or sale.subtotal < coupon.minimum_order_value then
    raise exception 'invalid_coupon' using errcode = 'P0001';
  end if;
  select count(*) into total_uses from public.coupon_redemptions where coupon_id = coupon.id;
  select count(*) into customer_uses from public.coupon_redemptions where coupon_id = coupon.id and customer_id = auth.uid();
  if (coupon.usage_limit is not null and total_uses >= coupon.usage_limit)
    or (coupon.usage_limit_per_customer is not null and customer_uses >= coupon.usage_limit_per_customer) then
    raise exception 'coupon_limit_reached' using errcode = 'P0001';
  end if;
  select coalesce(sum(item.total) filter (where
    not exists(select 1 from public.coupon_scopes scope where scope.coupon_id = coupon.id)
    or exists(select 1 from public.coupon_scopes scope where scope.coupon_id = coupon.id and (
      scope.variant_id = item.variant_id or scope.product_id = item.product_id
      or scope.collection_id = product.collection_id or scope.category_id = product.category_id
      or exists(select 1 from public.product_categories pc where pc.product_id = item.product_id and pc.category_id = scope.category_id)
      or (scope.region_prefix is not null and regexp_replace(sale.shipping_address_snapshot->>'postalCode', '[^0-9]', '', 'g') like scope.region_prefix || '%')
    ))), 0) into eligible_subtotal
  from public.order_items item join public.products product on product.id = item.product_id where item.order_id = sale.id;
  discount := case coupon.discount_type
    when 'percentage' then round(eligible_subtotal * coupon.discount_value / 100, 2)
    when 'fixed' then least(eligible_subtotal, coupon.discount_value)
    else 0 end;
  if coupon.maximum_discount is not null then discount := least(discount, coupon.maximum_discount); end if;
  if discount <= 0 then raise exception 'invalid_coupon' using errcode = 'P0001'; end if;
  update public.orders set coupon_id = coupon.id, discount_total = discount,
    grand_total = subtotal - discount + shipping_total, updated_at = now() where id = sale.id;
  update public.payments set amount = sale.subtotal - discount + sale.shipping_total, updated_at = now()
    where order_id = sale.id and provider_payment_id is null;
  insert into public.coupon_redemptions(coupon_id, customer_id, order_id, discount_amount)
    values(coupon.id, auth.uid(), sale.id, discount) on conflict(coupon_id, order_id) do nothing;
  return jsonb_build_object('name', coupon.name, 'discountInCents', round(discount * 100)::bigint,
    'amountInCents', round((sale.subtotal - discount + sale.shipping_total) * 100)::bigint);
end;
$$;
revoke all on function public.apply_checkout_coupon(uuid,text) from public, anon;
grant execute on function public.apply_checkout_coupon(uuid,text) to authenticated;

create or replace function public.create_professional_checkout_order(
  p_idempotency_key uuid, p_customer_name text, p_customer_email text, p_customer_phone text,
  p_cpf_ciphertext text, p_cpf_last_four text, p_shipping_address jsonb, p_lines jsonb,
  p_coupon_code text default null, p_reservation_minutes integer default 30
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare created jsonb; coupon_result jsonb;
begin
  created := public.create_mercadopago_test_order(
    p_idempotency_key, p_customer_name, p_customer_email, p_customer_phone,
    p_cpf_ciphertext, p_cpf_last_four, p_shipping_address, p_lines, p_reservation_minutes
  );
  update public.profiles set full_name = trim(p_customer_name), phone = nullif(trim(p_customer_phone), ''),
    cpf_last_four = p_cpf_last_four, updated_at = now() where id = auth.uid();
  if nullif(trim(coalesce(p_coupon_code, '')), '') is not null then
    coupon_result := public.apply_checkout_coupon((created->>'orderId')::uuid, p_coupon_code);
    created := created || coupon_result;
  else
    created := created || jsonb_build_object('discountInCents', 0, 'name', '');
  end if;
  return created;
end;
$$;
revoke all on function public.create_professional_checkout_order(uuid,text,text,text,text,text,jsonb,jsonb,text,integer) from public, anon;
grant execute on function public.create_professional_checkout_order(uuid,text,text,text,text,text,jsonb,jsonb,text,integer) to authenticated;

commit;
notify pgrst, 'reload schema';

-- Sincroniza o carrinho local com a conta autenticada sem confiar em preço ou estoque do navegador.

create index if not exists carts_customer_active_idx
  on public.carts(customer_id, updated_at desc)
  where status = 'active';

create or replace function public.merge_customer_cart(
  p_lines jsonb default '[]'::jsonb,
  p_source_cart_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_cart_id uuid;
  v_items jsonb;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text, 0)
  );

  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) > 50 then
    raise exception 'invalid_cart_payload' using errcode = '22023';
  end if;

  select cart.id
  into v_cart_id
  from public.carts cart
  where cart.customer_id = v_user_id
    and cart.status = 'active'
  order by cart.updated_at desc
  limit 1
  for update;

  if v_cart_id is null then
    insert into public.carts(customer_id, status)
    values (v_user_id, 'active')
    returning id into v_cart_id;
  end if;

  with requested as (
    select
      nullif(trim(item.product_id), '') as product_id,
      nullif(trim(item.color), '') as color,
      nullif(trim(item.size), '') as size,
      least(greatest(item.quantity, 1), 99) as quantity
    from jsonb_to_recordset(p_lines) as item(
      product_id text,
      color text,
      size text,
      quantity integer,
      requested_price_cents integer
    )
  ),
  resolved as (
    select
      variant.id as variant_id,
      least(
        sum(requested.quantity)::integer,
        greatest(stock.available_quantity - stock.reserved_quantity, 0),
        99
      ) as quantity,
      coalesce(variant.price_override, product.base_price) as current_price
    from requested
    join public.products product
      on product.id::text = requested.product_id
      and product.status = 'active'
    join public.product_variants variant
      on variant.product_id = product.id
      and variant.active
      and lower(variant.color_name) = lower(requested.color)
      and lower(variant.size) = lower(requested.size)
    join public.inventory stock on stock.variant_id = variant.id
    group by
      variant.id,
      variant.price_override,
      product.base_price,
      stock.available_quantity,
      stock.reserved_quantity
    having greatest(stock.available_quantity - stock.reserved_quantity, 0) > 0
  )
  insert into public.cart_items(cart_id, variant_id, quantity, unit_price_snapshot)
  select v_cart_id, variant_id, quantity, current_price
  from resolved
  on conflict (cart_id, variant_id)
  do update set
    quantity = least(
      case
        when p_source_cart_id = v_cart_id
          then greatest(public.cart_items.quantity, excluded.quantity)
        else public.cart_items.quantity + excluded.quantity
      end,
      coalesce((
        select greatest(inventory.available_quantity - inventory.reserved_quantity, 0)
        from public.inventory inventory
        where inventory.variant_id = excluded.variant_id
      ), 0),
      99
    ),
    unit_price_snapshot = excluded.unit_price_snapshot,
    updated_at = now();

  update public.carts
  set updated_at = now(), expires_at = greatest(expires_at, now() + interval '30 days')
  where id = v_cart_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'productId', product.id,
        'slug', product.slug,
        'variantId', variant.id,
        'name', product.name,
        'imagePath', image.storage_path,
        'color', variant.color_name,
        'size', variant.size,
        'quantity', least(
          item.quantity,
          greatest(stock.available_quantity - stock.reserved_quantity, 0)
        ),
        'maxQuantity', least(
          greatest(stock.available_quantity - stock.reserved_quantity, 0),
          99
        ),
        'unitPriceInCents',
          round(coalesce(variant.price_override, product.base_price) * 100)::integer
      )
      order by item.created_at
    ),
    '[]'::jsonb
  )
  into v_items
  from public.cart_items item
  join public.product_variants variant
    on variant.id = item.variant_id
    and variant.active
  join public.products product
    on product.id = variant.product_id
    and product.status = 'active'
  join public.inventory stock
    on stock.variant_id = variant.id
    and stock.available_quantity > stock.reserved_quantity
  left join lateral (
    select product_image.storage_path
    from public.product_images product_image
    where product_image.product_id = product.id
      and (product_image.variant_id is null or product_image.variant_id = variant.id)
    order by
      (product_image.variant_id = variant.id) desc,
      product_image.is_primary desc,
      product_image.sort_order,
      product_image.created_at
    limit 1
  ) image on true
  where item.cart_id = v_cart_id;

  return jsonb_build_object('items', v_items, 'cartId', v_cart_id);
end;
$$;

revoke all on function public.merge_customer_cart(jsonb, uuid) from public;
grant execute on function public.merge_customer_cart(jsonb, uuid) to authenticated;

create or replace function public.validate_checkout_lines(p_lines jsonb)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with requested as (
    select
      item.product_id,
      item.variant_id,
      least(greatest(item.quantity, 1), 99) as quantity
    from jsonb_to_recordset(p_lines) as item(
      product_id text,
      variant_id text,
      quantity integer
    )
  ),
  checked as (
    select
      requested.product_id,
      requested.variant_id,
      requested.quantity,
      product.status = 'active'
        and variant.active
        and greatest(stock.available_quantity - stock.reserved_quantity, 0) >= requested.quantity
        as available,
      round(coalesce(variant.price_override, product.base_price) * 100)::integer
        as unit_price_cents
    from requested
    left join public.product_variants variant
      on variant.id::text = requested.variant_id
    left join public.products product
      on product.id = variant.product_id
      and product.id::text = requested.product_id
    left join public.inventory stock on stock.variant_id = variant.id
  )
  select jsonb_build_object(
    'valid',
      auth.uid() is not null
      and count(*) = jsonb_array_length(p_lines)
      and count(*) > 0
      and bool_and(coalesce(available, false)),
    'subtotalInCents',
      coalesce(sum(unit_price_cents * quantity) filter (where available), 0),
    'lines',
      coalesce(jsonb_agg(jsonb_build_object(
        'productId', product_id,
        'variantId', variant_id,
        'quantity', quantity,
        'available', coalesce(available, false),
        'unitPriceInCents', unit_price_cents
      )), '[]'::jsonb)
  )
  from checked;
$$;

revoke all on function public.validate_checkout_lines(jsonb) from public;
grant execute on function public.validate_checkout_lines(jsonb) to authenticated;

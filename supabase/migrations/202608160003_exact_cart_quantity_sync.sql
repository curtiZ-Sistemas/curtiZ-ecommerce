-- Corrige a atualização exata de quantidades sem alterar migrations já aplicadas.

create or replace function public.sync_customer_cart(
  p_lines jsonb,
  p_source_cart_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  cart_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) > 50 then
    raise exception 'invalid_cart_payload' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_lines) as requested(value)
    where jsonb_typeof(requested.value) is distinct from 'object'
      or jsonb_typeof(requested.value->'quantity') is distinct from 'number'
      or (requested.value->>'quantity') !~ '^[0-9]+$'
      or (requested.value->>'quantity')::integer not between 1 and 99
      or nullif(trim(requested.value->>'product_id'), '') is null
      or nullif(trim(requested.value->>'color'), '') is null
      or nullif(trim(requested.value->>'size'), '') is null
  ) then
    raise exception 'invalid_cart_line' using errcode = '22023';
  end if;

  -- A função base valida catálogo/estoque, recalcula preços e mantém lock por usuário.
  result := public.merge_customer_cart(p_lines, p_source_cart_id);
  cart_id := nullif(result->>'cartId', '')::uuid;

  -- Na primeira sincronização, preserva e mescla o carrinho que já existia na conta.
  -- Depois de receber o id canônico, a quantidade enviada passa a ser exata.
  if cart_id is not null and p_source_cart_id = cart_id then
    with requested as (
      select
        nullif(trim(item.product_id), '') as product_id,
        nullif(trim(item.color), '') as color,
        nullif(trim(item.size), '') as size,
        item.quantity
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
          greatest(stock.available_quantity, 0),
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
        stock.available_quantity
      having greatest(stock.available_quantity, 0) > 0
    )
    update public.cart_items item
    set quantity = resolved.quantity,
        unit_price_snapshot = resolved.current_price,
        updated_at = now()
    from resolved
    where item.cart_id = cart_id
      and item.variant_id = resolved.variant_id;

    delete from public.cart_items item
    where item.cart_id = cart_id
      and not exists (
        select 1
        from jsonb_to_recordset(p_lines) as requested(
          product_id text,
          color text,
          size text,
          quantity integer,
          requested_price_cents integer
        )
        join public.products product
          on product.id::text = nullif(trim(requested.product_id), '')
        join public.product_variants variant
          on variant.product_id = product.id
          and lower(variant.color_name) = lower(nullif(trim(requested.color), ''))
          and lower(variant.size) = lower(nullif(trim(requested.size), ''))
        where variant.id = item.variant_id
      );

    result := public.merge_customer_cart('[]'::jsonb, cart_id);
  end if;

  return result;
end;
$$;

revoke all on function public.merge_customer_cart(jsonb, uuid) from authenticated;
revoke all on function public.sync_customer_cart(jsonb, uuid) from public, anon;
grant execute on function public.sync_customer_cart(jsonb, uuid) to authenticated;

notify pgrst, 'reload schema';

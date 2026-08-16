-- Mantém o carrinho autenticado equivalente ao dispositivo após a primeira mesclagem.
-- A função histórica continua preservada; esta camada trata remoções e limpeza total.

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

  result := public.merge_customer_cart(p_lines, p_source_cart_id);
  cart_id := nullif(result->>'cartId', '')::uuid;

  -- Um id diferente representa a primeira mesclagem de um carrinho local com o remoto.
  -- Depois que o cliente recebe o id canônico, a lista enviada passa a ser a fonte exata.
  if cart_id is not null and p_source_cart_id = cart_id then
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

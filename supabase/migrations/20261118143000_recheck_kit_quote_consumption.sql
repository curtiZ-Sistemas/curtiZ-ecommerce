-- Revalidate live eligibility while the eventual order transaction holds locks.
create or replace function private.consume_representative_kit_shipping_quote(
  p_quote uuid, p_actor uuid, p_variant uuid, p_quantity integer, p_address uuid, p_cart_fingerprint text
) returns private.representative_kit_shipping_checkout_quotes language plpgsql set search_path = '' as $$
declare
  selected private.representative_kit_shipping_checkout_quotes;
begin
  perform 1 from public.profiles p
    join public.representatives r on r.user_id = p.id
    where p.id = p_actor and p.status = 'active'
      and r.status in ('approved_waiting_kit', 'active', 'unqualified')
    for share of p, r;
  if not found then return null; end if;

  perform 1 from public.product_variants v
    join public.products p on p.id = v.product_id
    join private.bling_catalog_metadata m on m.product_id = p.id
    where v.id = p_variant and v.active and p.status = 'active' and m.pairs_per_sku > 1
    for share of v, p, m;
  if not found then return null; end if;

  perform 1 from public.addresses a
    join private.representative_kit_shipping_checkout_quotes q on q.address_id = a.id
    where q.id = p_quote and a.id = p_address and a.user_id = p_actor
      and a.country = 'BR' and a.state = 'MG' and q.postal_code ~ '^3[0-9]{7}$'
      and a.updated_at = q.address_updated_at
      and regexp_replace(a.postal_code, '[^0-9]', '', 'g') = q.postal_code
    for share of a;
  if not found then return null; end if;

  perform 1 from public.inventory i
    where i.variant_id = p_variant and p_quantity between 1 and 99
      and i.available_quantity >= p_quantity
    for update;
  if not found then return null; end if;

  update private.representative_kit_shipping_checkout_quotes q set used_at = now()
    where q.id = p_quote and q.actor_id = p_actor and q.variant_id = p_variant and q.quantity = p_quantity
      and q.address_id = p_address and q.cart_fingerprint = p_cart_fingerprint
      and q.expires_at > now() and q.used_at is null
    returning q.* into selected;
  return selected;
end;
$$;
revoke all on function private.consume_representative_kit_shipping_quote(uuid,uuid,uuid,integer,uuid,text)
  from public, anon, authenticated, service_role;

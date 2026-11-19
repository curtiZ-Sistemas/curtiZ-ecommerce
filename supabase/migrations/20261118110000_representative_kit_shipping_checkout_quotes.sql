create table private.representative_kit_shipping_checkout_quotes (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id) on delete cascade,
  quantity integer not null check (quantity between 1 and 99),
  address_id uuid not null references public.addresses(id) on delete cascade,
  address_updated_at timestamptz not null,
  postal_code text not null check (postal_code ~ '^[0-9]{8}$'),
  cart_fingerprint text not null check (cart_fingerprint ~ '^[0-9a-f]{64}$'),
  service_id text not null check (length(service_id) between 1 and 50),
  service text not null check (length(btrim(service)) between 1 and 200),
  carrier text not null check (length(btrim(carrier)) between 1 and 200),
  amount_in_cents integer not null check (amount_in_cents >= 0),
  cost_in_cents integer not null check (cost_in_cents >= 0),
  estimated_days integer not null check (estimated_days between 0 and 365),
  packages jsonb not null check (jsonb_typeof(packages) = 'array'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null check (expires_at > created_at),
  used_at timestamptz
);
alter table private.representative_kit_shipping_checkout_quotes enable row level security;
alter table private.representative_kit_shipping_checkout_quotes force row level security;
revoke all on private.representative_kit_shipping_checkout_quotes from public, anon, authenticated, service_role;

create index representative_kit_shipping_quotes_actor_expiry
  on private.representative_kit_shipping_checkout_quotes(actor_id, expires_at);
create index representative_kit_shipping_quotes_variant
  on private.representative_kit_shipping_checkout_quotes(variant_id);
create index representative_kit_shipping_quotes_address
  on private.representative_kit_shipping_checkout_quotes(address_id);

create function public.issue_representative_kit_shipping_quote(
  p_actor uuid, p_variant uuid, p_quantity integer, p_address uuid, p_postal_code text,
  p_cart_fingerprint text, p_service_id text, p_service text, p_carrier text,
  p_amount_in_cents integer, p_cost_in_cents integer, p_estimated_days integer,
  p_packages jsonb, p_expires_at timestamptz
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  address_version timestamptz;
  issued private.representative_kit_shipping_checkout_quotes;
begin
  if p_expires_at is null or p_expires_at <= now() then
    return null;
  end if;
  select a.updated_at into address_version
    from public.addresses a
    join public.profiles p on p.id = a.user_id and p.status = 'active'
    join public.representatives r on r.user_id = a.user_id
    where a.id = p_address and a.user_id = p_actor and a.country = 'BR'
      and regexp_replace(a.postal_code, '[^0-9]', '', 'g') = p_postal_code
      and r.status in ('approved_waiting_kit', 'active', 'unqualified')
    for share of a;
  if not found then
    return null;
  end if;

  delete from private.representative_kit_shipping_checkout_quotes
    where actor_id = p_actor and expires_at <= now();
  insert into private.representative_kit_shipping_checkout_quotes (
    actor_id, variant_id, quantity, address_id, address_updated_at, postal_code, cart_fingerprint,
    service_id, service, carrier, amount_in_cents, cost_in_cents, estimated_days, packages, expires_at
  ) values (
    p_actor, p_variant, p_quantity, p_address, address_version, p_postal_code, p_cart_fingerprint,
    p_service_id, p_service, p_carrier, p_amount_in_cents, p_cost_in_cents, p_estimated_days,
    p_packages, least(p_expires_at, now() + interval '30 minutes')
  ) returning * into issued;

  return jsonb_build_object('id', issued.id, 'serviceId', issued.service_id, 'service', issued.service,
    'carrier', issued.carrier, 'amountInCents', issued.amount_in_cents, 'estimatedDays', issued.estimated_days,
    'expiresAt', issued.expires_at);
end;
$$;
revoke all on function public.issue_representative_kit_shipping_quote(uuid,uuid,integer,uuid,text,text,text,text,text,integer,integer,integer,jsonb,timestamptz)
  from public, anon, authenticated;
grant execute on function public.issue_representative_kit_shipping_quote(uuid,uuid,integer,uuid,text,text,text,text,text,integer,integer,integer,jsonb,timestamptz)
  to service_role;

-- Call within the order-creation transaction so a failed order rolls back consumption.
create function private.consume_representative_kit_shipping_quote(
  p_quote uuid, p_actor uuid, p_variant uuid, p_quantity integer, p_address uuid, p_cart_fingerprint text
) returns private.representative_kit_shipping_checkout_quotes language plpgsql set search_path = '' as $$
declare
  selected private.representative_kit_shipping_checkout_quotes;
begin
  perform 1 from public.addresses a
    join private.representative_kit_shipping_checkout_quotes q on q.address_id = a.id
    where q.id = p_quote and a.id = p_address and a.user_id = p_actor and a.country = 'BR'
      and a.updated_at = q.address_updated_at
      and regexp_replace(a.postal_code, '[^0-9]', '', 'g') = q.postal_code
    for share of a;
  if not found then
    return null;
  end if;

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

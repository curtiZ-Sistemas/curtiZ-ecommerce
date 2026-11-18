-- Apply regional restrictions only to the representative kit channel.
alter table private.representative_resale_fiscal_rule_versions
  add constraint representative_resale_rule_mg_only
  check (origin_state = 'MG' and destination_state = 'MG') not valid;

alter table private.representative_kit_shipping_checkout_quotes
  add constraint representative_kit_shipping_quote_mg_only
  check (postal_code ~ '^3[0-9]{7}$') not valid;

create function private.guard_representative_kit_quote_mg()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.addresses a
    where a.id = new.address_id and a.user_id = new.actor_id
      and a.country = 'BR' and a.state = 'MG'
      and regexp_replace(a.postal_code, '[^0-9]', '', 'g') = new.postal_code
  ) then
    raise exception 'representative_kit_address_outside_mg' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_representative_kit_quote_mg() from public, anon, authenticated, service_role;
create trigger representative_kit_quote_mg
  before insert or update on private.representative_kit_shipping_checkout_quotes
  for each row execute function private.guard_representative_kit_quote_mg();

create function private.is_representative_kit_mg_snapshot(p_snapshot jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(p_snapshot->'address'->>'state' = 'MG'
    and regexp_replace(p_snapshot->'address'->>'postalCode', '[^0-9]', '', 'g') ~ '^3[0-9]{7}$', false);
$$;
revoke all on function private.is_representative_kit_mg_snapshot(jsonb) from public, anon, authenticated, service_role;

create function private.guard_representative_kit_shipping_snapshot_mg()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.shipping_snapshot->'address' is not null
    and not private.is_representative_kit_mg_snapshot(new.shipping_snapshot) then
    raise exception 'representative_kit_address_outside_mg' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_representative_kit_shipping_snapshot_mg() from public, anon, authenticated, service_role;
create trigger representative_kit_shipping_snapshot_mg
  before insert or update of shipping_snapshot on public.kit_orders
  for each row execute function private.guard_representative_kit_shipping_snapshot_mg();

-- Keep recovery and refunds available for existing transactions.
create or replace function public.claim_kit_test_creation(p_actor uuid,p_order uuid,p_fingerprint text,p_lock uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; tx private.kit_test_transactions;
begin
  result:=public.claim_kit_test_payment(p_actor,p_order,p_fingerprint,p_lock);
  select * into tx from private.kit_test_transactions where order_id=p_order for update;
  if tx.state<>'reserved' then raise exception 'kit_not_payable'; end if;
  if not exists(select 1 from public.kit_orders where id=p_order and shipping_snapshot->'address' is not null) then
    raise exception 'kit_address_required';
  end if;
  if not exists(select 1 from public.kit_orders where id=p_order and private.is_representative_kit_mg_snapshot(shipping_snapshot)) then
    raise exception 'representative_kit_address_outside_mg' using errcode='23514';
  end if;
  return result||jsonb_build_object('state',tx.state,'refundedInCents',tx.refunded_cents);
end;
$$;

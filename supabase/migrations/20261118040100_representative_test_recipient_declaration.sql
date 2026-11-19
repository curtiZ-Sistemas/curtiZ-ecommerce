-- A declaration is an unverified snapshot for an isolated TEST order. It is
-- not fiscal approval and creates no production payment, invoice or shipment.
create table private.kit_test_recipient_declarations (
  order_id uuid primary key references private.kit_test_transactions(order_id),
  actor_id uuid not null references public.profiles(id),
  schema_version integer not null check (schema_version = 1),
  declared_scenario jsonb not null,
  declared_at timestamptz not null default now(),
  check (jsonb_typeof(declared_scenario) = 'object')
);
alter table private.kit_test_recipient_declarations enable row level security;
alter table private.kit_test_recipient_declarations force row level security;
revoke all on private.kit_test_recipient_declarations from public, anon, authenticated, service_role;

create function private.protect_kit_test_recipient_declaration()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'kit_test_declaration_is_append_only' using errcode = '23514';
end;
$$;
revoke all on function private.protect_kit_test_recipient_declaration() from public, anon, authenticated, service_role;
create trigger protect_kit_test_recipient_declaration before update or delete on private.kit_test_recipient_declarations
  for each row execute function private.protect_kit_test_recipient_declaration();

create function public.create_kit_test_checkout_with_declaration(
  p_actor uuid, p_variant uuid, p_quantity integer, p_quote uuid,
  p_fingerprint text, p_key uuid, p_address uuid, p_scenario jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb; transaction_row private.kit_test_transactions; prior private.kit_test_recipient_declarations;
  snapshot_state text;
begin
  if jsonb_typeof(p_scenario) is distinct from 'object'
    or p_scenario - array['personType','purpose','icmsStatus','destinationState'] <> '{}'::jsonb
    or jsonb_typeof(p_scenario->'personType') is distinct from 'string'
    or jsonb_typeof(p_scenario->'purpose') is distinct from 'string'
    or jsonb_typeof(p_scenario->'icmsStatus') is distinct from 'string'
    or jsonb_typeof(p_scenario->'destinationState') is distinct from 'string'
    or p_scenario->>'personType' not in ('individual','business')
    or p_scenario->>'purpose' <> 'resale'
    or p_scenario->>'icmsStatus' not in ('taxpayer','registration_exempt','non_taxpayer','unknown')
    or p_scenario->>'destinationState' not in ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO') then
    raise exception 'invalid_kit_test_declaration' using errcode = '23514';
  end if;

  result := public.create_kit_test_checkout(p_actor,p_variant,p_quantity,p_quote,p_fingerprint,p_key,p_address);
  select * into transaction_row from private.kit_test_transactions
    where order_id = (result->>'orderId')::uuid and actor_id = p_actor for update;
  if not found then raise exception 'kit_test_declaration_access_denied' using errcode = '42501'; end if;
  select shipping_snapshot->'address'->>'state' into snapshot_state from public.kit_orders where id = transaction_row.order_id;
  if snapshot_state is distinct from p_scenario->>'destinationState' then
    raise exception 'kit_test_declaration_state_mismatch' using errcode = '23514';
  end if;
  select * into prior from private.kit_test_recipient_declarations where order_id = transaction_row.order_id;
  if found then
    if prior.actor_id is distinct from p_actor or prior.declared_scenario is distinct from p_scenario then
      raise exception 'kit_test_declaration_conflict' using errcode = '23514';
    end if;
  else
    if transaction_row.state <> 'reserved' or transaction_row.payment_started_at is not null then
      raise exception 'kit_test_declaration_too_late' using errcode = '23514';
    end if;
    insert into private.kit_test_recipient_declarations(order_id,actor_id,schema_version,declared_scenario)
      values(transaction_row.order_id,p_actor,1,p_scenario);
  end if;
  return result || jsonb_build_object('declarationState','unverified');
end;
$$;
revoke all on function public.create_kit_test_checkout_with_declaration(uuid,uuid,integer,uuid,text,uuid,uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.create_kit_test_checkout_with_declaration(uuid,uuid,integer,uuid,text,uuid,uuid,jsonb)
  to service_role;

create function public.read_kit_test_recipient_declaration(p_actor uuid,p_order uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('scenario',d.declared_scenario,'schemaVersion',d.schema_version,
    'declaredAt',d.declared_at,'verification','unverified')
  from private.kit_test_recipient_declarations d
  join private.kit_test_transactions t on t.order_id=d.order_id and t.actor_id=d.actor_id
  where d.order_id=p_order and d.actor_id=p_actor;
$$;
revoke all on function public.read_kit_test_recipient_declaration(uuid,uuid) from public, anon, authenticated;
grant execute on function public.read_kit_test_recipient_declaration(uuid,uuid) to service_role;

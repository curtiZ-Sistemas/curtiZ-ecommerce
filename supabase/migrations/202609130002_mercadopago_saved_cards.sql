-- Provider references and operation state only. No card credentials or temporary tokens.
begin;
create table public.payment_provider_customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null default 'mercadopago' check (provider = 'mercadopago'),
  payment_mode text not null check (payment_mode in ('test', 'production')),
  provider_customer_id text check (provider_customer_id ~ '^[a-zA-Z0-9_+-]{1,100}$'),
  creation_key uuid not null default gen_random_uuid(),
  state text not null default 'new' check (state in ('new', 'creating', 'ready')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(provider, payment_mode, user_id), unique(provider, payment_mode, provider_customer_id),
  check ((state = 'ready') = (provider_customer_id is not null))
);
create table public.payment_provider_card_operations (
  id uuid primary key,
  customer_id uuid not null references public.payment_provider_customers(id) on delete cascade,
  order_id uuid not null references public.orders(id),
  state text not null default 'processing' check (state in ('processing', 'succeeded', 'failed')),
  provider_card_id text check (provider_card_id ~ '^[a-zA-Z0-9_+-]{1,100}$'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index provider_card_one_active_save on public.payment_provider_card_operations(customer_id) where state = 'processing';
alter table public.payment_provider_customers enable row level security;
alter table public.payment_provider_card_operations enable row level security;
revoke all on public.payment_provider_customers, public.payment_provider_card_operations from public, anon, authenticated;
grant select on public.payment_provider_customers, public.payment_provider_card_operations to authenticated;
grant all on public.payment_provider_customers, public.payment_provider_card_operations to service_role;
create policy "own provider customer reference" on public.payment_provider_customers for select to authenticated using (user_id = auth.uid());
create policy "own card operation state" on public.payment_provider_card_operations for select to authenticated using (
  exists(select 1 from public.payment_provider_customers customer where customer.id = customer_id and customer.user_id = auth.uid()));

create function public.claim_mercadopago_customer(p_user_id uuid, p_mode text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare customer public.payment_provider_customers%rowtype; claimed boolean := false;
begin
  if p_user_id is null or p_mode not in ('test', 'production') then raise exception 'invalid_customer_context'; end if;
  insert into public.payment_provider_customers(user_id, payment_mode) values(p_user_id, p_mode)
    on conflict(provider, payment_mode, user_id) do nothing;
  select * into customer from public.payment_provider_customers where user_id = p_user_id and payment_mode = p_mode for update;
  if customer.state = 'new' then
    update public.payment_provider_customers set state = 'creating', updated_at = now() where id = customer.id;
    claimed := true;
  end if;
  return jsonb_build_object('id', customer.id, 'providerCustomerId', customer.provider_customer_id,
    'creationKey', customer.creation_key, 'claimed', claimed);
end; $$;
create function public.finish_mercadopago_customer(p_id uuid, p_key uuid, p_provider_id text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.payment_provider_customers set provider_customer_id = p_provider_id,
    state = case when p_provider_id is null then 'new' else 'ready' end, updated_at = now()
  where id = p_id and creation_key = p_key and state = 'creating';
  if not found and not exists(select 1 from public.payment_provider_customers where id = p_id and creation_key = p_key
    and provider_customer_id = p_provider_id and state = 'ready') then raise exception 'customer_operation_conflict'; end if;
end; $$;
create function public.claim_mercadopago_card_save(p_user_id uuid, p_customer_id uuid, p_order_id uuid, p_key uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare operation public.payment_provider_card_operations%rowtype;
begin
  perform 1 from public.payment_provider_customers where id = p_customer_id and user_id = p_user_id and state = 'ready' for update;
  if not found then raise exception 'customer_not_owned' using errcode = '42501'; end if;
  perform 1 from public.orders where id = p_order_id and customer_id = p_user_id and payment_status = 'approved';
  if not found then raise exception 'approved_order_required' using errcode = '42501'; end if;
  select * into operation from public.payment_provider_card_operations where id = p_key for update;
  if operation.id is not null then
    if operation.customer_id <> p_customer_id or operation.order_id <> p_order_id then raise exception 'card_operation_conflict' using errcode = '42501'; end if;
    return jsonb_build_object('claimed', false, 'state', operation.state, 'cardId', operation.provider_card_id);
  end if;
  if exists(select 1 from public.payment_provider_card_operations where customer_id = p_customer_id and state = 'processing') then
    raise exception 'card_save_in_progress' using errcode = 'P0001';
  end if;
  insert into public.payment_provider_card_operations(id, customer_id, order_id) values(p_key, p_customer_id, p_order_id);
  return jsonb_build_object('claimed', true, 'state', 'processing');
end; $$;
create function public.finish_mercadopago_card_save(p_key uuid, p_card_id text, p_failed boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.payment_provider_card_operations set
    state = case when p_failed then 'failed' else 'succeeded' end, provider_card_id = p_card_id, updated_at = now()
  where id = p_key and state = 'processing';
end; $$;
create function public.audit_mercadopago_card_delete(p_user_id uuid, p_customer_id uuid, p_card_id text, p_request_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.payment_provider_customers where id = p_customer_id and user_id = p_user_id) then
    raise exception 'customer_not_owned' using errcode = '42501';
  end if;
  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, new_data_sanitized, request_id)
  values(p_user_id, 'customer', 'saved_card.delete', 'payment_provider_customers', p_customer_id,
    jsonb_build_object('provider', 'mercadopago', 'provider_card_id', p_card_id), p_request_id);
end; $$;

create table private.mercadopago_card_rate_limits (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  window_started_at timestamptz not null, attempts integer not null check (attempts > 0)
);
alter table private.mercadopago_card_rate_limits enable row level security;
revoke all on private.mercadopago_card_rate_limits from public, anon, authenticated;
create function public.enforce_mercadopago_card_rate_limit(p_user_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare count_requests integer;
begin
  insert into private.mercadopago_card_rate_limits values(p_user_id, clock_timestamp(), 1)
  on conflict(user_id) do update set
    attempts = case when private.mercadopago_card_rate_limits.window_started_at < clock_timestamp() - interval '1 minute'
      then 1 else private.mercadopago_card_rate_limits.attempts + 1 end,
    window_started_at = case when private.mercadopago_card_rate_limits.window_started_at < clock_timestamp() - interval '1 minute'
      then clock_timestamp() else private.mercadopago_card_rate_limits.window_started_at end
  returning attempts into count_requests;
  return count_requests <= 20;
end; $$;
revoke all on function public.claim_mercadopago_customer(uuid,text), public.finish_mercadopago_customer(uuid,uuid,text),
  public.claim_mercadopago_card_save(uuid,uuid,uuid,uuid), public.finish_mercadopago_card_save(uuid,text,boolean),
  public.audit_mercadopago_card_delete(uuid,uuid,text,uuid), public.enforce_mercadopago_card_rate_limit(uuid) from public, anon, authenticated;
grant execute on function public.claim_mercadopago_customer(uuid,text), public.finish_mercadopago_customer(uuid,uuid,text),
  public.claim_mercadopago_card_save(uuid,uuid,uuid,uuid), public.finish_mercadopago_card_save(uuid,text,boolean),
  public.audit_mercadopago_card_delete(uuid,uuid,text,uuid), public.enforce_mercadopago_card_rate_limit(uuid) to service_role;
commit;
notify pgrst, 'reload schema';

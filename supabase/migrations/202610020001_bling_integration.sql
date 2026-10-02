begin;

-- Dados de integração permanecem fora da API pública. Apenas RPCs restritas
-- ao service_role podem ler tokens, eventos ou jobs.
create table private.bling_request_budget (
  environment text not null,
  window_kind text not null check (window_kind in ('second','day','oauth')),
  window_start timestamptz not null,
  used integer not null default 0,
  primary key (environment, window_kind, window_start)
);
revoke all on private.bling_request_budget from public, anon, authenticated;

create table private.bling_accounts (
  environment text primary key check (environment in ('sandbox','production')),
  company_id text not null,
  company_name text not null,
  api_checked_at timestamptz,
  api_healthy boolean,
  verified_at timestamptz not null default now()
);
revoke all on private.bling_accounts from public, anon, authenticated;

create table private.bling_order_links (
  -- Keep ERP references when the existing local retention flow archives orders.
  order_id uuid primary key,
  external_order_id bigint unique,
  external_contact_id bigint,
  invoice_id bigint unique,
  invoice_status text not null default 'not_requested'
    check (invoice_status in ('not_requested','awaiting_data','pending','processing','authorized','rejected','cancelled','error')),
  invoice_number text,
  invoice_access_key text,
  email_provider_id text unique,
  email_accepted_at timestamptz,
  email_first_attempt_at timestamptz,
  erp_status text not null default 'pending'
    check (erp_status in ('pending','synced','reconciliation_required','failed')),
  last_error_code text,
  last_synced_at timestamptz,
  external_observed_at timestamptz,
  updated_at timestamptz not null default now()
);
revoke all on private.bling_order_links from public, anon, authenticated;

create table private.bling_product_links (
  variant_id uuid primary key,
  removed boolean not null default false,
  external_product_id bigint not null unique,
  sku text not null,
  source text not null default 'curtiz',
  local_version integer,
  sync_status text not null default 'matched' check (sync_status in ('matched','pending','synced','failed','reconciliation_required')),
  last_error_code text,
  last_synced_at timestamptz,
  updated_at timestamptz not null default now()
);
revoke all on private.bling_product_links from public, anon, authenticated;

create table private.bling_webhook_events (
  event_id text primary key,
  event_type text not null,
  company_id text,
  resource_id text,
  payload jsonb not null,
  payload_hash text not null,
  status text not null default 'pending' check (status in ('pending','processed','ignored','failed')),
  attempts integer not null default 0,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error_code text
);
create index bling_webhook_pending_idx on private.bling_webhook_events(received_at) where status='pending';
revoke all on private.bling_webhook_events from public, anon, authenticated;

create or replace function public.claim_bling_request_slot(p_environment text,p_oauth boolean default false)
returns integer language plpgsql security definer set search_path = '' as $$
declare instant timestamptz; last_request timestamptz; last_oauth timestamptz; account_key text;
  day_start timestamptz; oldest_bucket timestamptz;
  day_used integer;
begin
  if p_environment not in ('sandbox','production') then raise exception 'invalid_environment'; end if;
  -- One lock for all environments; an account may be connected to both.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('bling-rate'));
  instant := clock_timestamp();
  -- Hourly buckets include the partial oldest hour: a conservative rolling 24h quota.
  day_start := date_trunc('hour', instant);
  select company_id into account_key from private.bling_accounts where environment=p_environment;
  account_key := coalesce(account_key,'unverified');
  select max(window_start) into last_request from private.bling_request_budget
    where environment=account_key and window_kind='second';
  if last_request > instant - interval '334 milliseconds' then
    return ceil(extract(epoch from last_request + interval '334 milliseconds' - instant)*1000)::integer;
  end if;
  if p_oauth then
    select max(window_start) into last_oauth from private.bling_request_budget where window_kind='oauth';
    if last_oauth > instant - interval '3100 milliseconds' then
      return ceil(extract(epoch from last_oauth + interval '3100 milliseconds' - instant)*1000)::integer;
    end if;
  end if;
  select sum(used),min(window_start) into day_used,oldest_bucket from private.bling_request_budget
    where environment=account_key and window_kind='day' and window_start>=day_start-interval '24 hours';
  if coalesce(day_used,0)>=120000 then
    return greatest(1000,ceil(extract(epoch from oldest_bucket + interval '25 hours' - instant)*1000)::integer);
  end if;
  delete from private.bling_request_budget where (window_kind in ('second','oauth') and window_start<instant-interval '1 minute')
    or (window_kind='day' and window_start<day_start-interval '24 hours');
  insert into private.bling_request_budget(environment,window_kind,window_start,used)
    values(account_key,'day',day_start,1)
    on conflict(environment,window_kind,window_start) do update set used=private.bling_request_budget.used+1;
  insert into private.bling_request_budget(environment,window_kind,window_start,used)
    values(account_key,'second',instant,1)
    on conflict(environment,window_kind,window_start) do update set used=private.bling_request_budget.used+1;
  if p_oauth then
    insert into private.bling_request_budget(environment,window_kind,window_start,used) values(account_key,'oauth',instant,1);
  end if;
  return 0;
end;
$$;

create or replace function public.save_bling_refresh(p_environment text,p_lock_id uuid,
  p_access_token_ciphertext text,p_refresh_token_ciphertext text,p_access_token_expires_at timestamptz,
  p_refresh_token_expires_at timestamptz)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update private.integration_credentials set access_token_ciphertext=p_access_token_ciphertext,
    refresh_token_ciphertext=p_refresh_token_ciphertext, access_token_expires_at=p_access_token_expires_at,
    refresh_token_expires_at=p_refresh_token_expires_at,status='connected',last_error_code=null,
    refresh_lock_id=null,refresh_locked_until=null,updated_at=now()
  where provider='bling' and environment=p_environment and refresh_lock_id=p_lock_id
    and refresh_locked_until>now() and status='connected';
  return found;
end;
$$;

create or replace function public.save_bling_connection(p_environment text,
  p_access_token_ciphertext text,p_refresh_token_ciphertext text,p_access_token_expires_at timestamptz,
  p_refresh_token_expires_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into private.integration_credentials(provider,environment,access_token_ciphertext,refresh_token_ciphertext,
    access_token_expires_at,refresh_token_expires_at,status)
  values('bling',p_environment,p_access_token_ciphertext,p_refresh_token_ciphertext,
    p_access_token_expires_at,p_refresh_token_expires_at,'connected')
  on conflict(provider,environment) do update set
    access_token_ciphertext=excluded.access_token_ciphertext,refresh_token_ciphertext=excluded.refresh_token_ciphertext,
    access_token_expires_at=excluded.access_token_expires_at,refresh_token_expires_at=excluded.refresh_token_expires_at,
    status='connected',refresh_lock_id=null,refresh_locked_until=null,last_error_code=null,updated_at=now();
end;
$$;

create or replace function public.mark_bling_reconnect_required(p_environment text)
returns void language sql security definer set search_path = '' as $$
  update private.integration_credentials set status='refresh_required',last_error_code='reconnect_required',
    updated_at=now() where provider='bling' and environment=p_environment and status <> 'disconnected';
$$;

create or replace function public.save_bling_account(p_environment text,p_company_id text,p_company_name text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_environment not in ('sandbox','production') or length(p_company_id) not between 1 and 100
    or length(p_company_name) not between 1 and 200 then raise exception 'invalid_account'; end if;
  -- Existing IDs are scoped to their company. Reconnecting another company requires a reviewed migration.
  if exists(select 1 from private.bling_accounts where environment=p_environment and company_id<>p_company_id)
    or exists(select 1 from private.bling_accounts where company_id<>p_company_id)
    then raise exception 'company_mismatch'; end if;
  insert into private.bling_accounts(environment,company_id,company_name)
  values(p_environment,p_company_id,p_company_name)
  on conflict(environment) do update set company_id=excluded.company_id,
    company_name=excluded.company_name,verified_at=now();
end;
$$;

create or replace function public.read_bling_account(p_environment text)
returns jsonb language sql security definer set search_path = '' stable as $$
  select jsonb_build_object('companyId',company_id,'companyName',company_name,'verifiedAt',verified_at,
    'apiCheckedAt',api_checked_at,'apiHealthy',api_healthy)
  from private.bling_accounts where environment=p_environment;
$$;

create or replace function public.record_bling_api_health(p_environment text,p_healthy boolean)
returns void language sql security definer set search_path = '' as $$
  update private.bling_accounts set api_checked_at=now(),api_healthy=p_healthy where environment=p_environment;
$$;

create or replace function public.disconnect_bling_connection(p_environment text,p_lock_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update private.integration_credentials set status='disconnected',access_token_ciphertext='',refresh_token_ciphertext='',
    refresh_lock_id=null,refresh_locked_until=null,updated_at=now()
  where provider='bling' and environment=p_environment and refresh_lock_id=p_lock_id and refresh_locked_until>now();
  return found;
end;
$$;

create or replace function private.enqueue_bling_paid_order()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.provider='mercadopago' and new.status='approved'
    and (tg_op='INSERT' or (tg_op='UPDATE' and old.status is distinct from 'approved')) then
    insert into private.bling_order_links(order_id) values(new.order_id) on conflict do nothing;
    insert into public.background_jobs(queue,job_type,payload_sanitized,idempotency_key)
    values('bling','bling.order.create',jsonb_build_object('orderId',new.order_id),
      'bling:create-order:' || new.order_id::text) on conflict(idempotency_key) do nothing;
  end if;
  return new;
end;
$$;
create trigger enqueue_bling_paid_order after insert or update of status on public.payments
  for each row execute function private.enqueue_bling_paid_order();
revoke all on function private.enqueue_bling_paid_order() from public, anon, authenticated;

create or replace function public.accept_bling_webhook(p_event_id text,p_event_type text,p_company_id text,
  p_resource_id text,p_payload jsonb,p_payload_hash text)
returns text language plpgsql security definer set search_path = '' as $$
declare existing_hash text;
begin
  if length(p_event_id)>200 or length(p_event_type)>100 or p_event_id='' then return 'invalid'; end if;
  insert into private.bling_webhook_events(event_id,event_type,company_id,resource_id,payload,payload_hash)
  values(p_event_id,p_event_type,p_company_id,p_resource_id,p_payload,p_payload_hash)
  on conflict(event_id) do nothing;
  if not found then
    select payload_hash into existing_hash from private.bling_webhook_events where event_id=p_event_id;
    return case when existing_hash=p_payload_hash then 'duplicate' else 'conflict' end;
  end if;
  insert into public.background_jobs(queue,job_type,payload_sanitized,idempotency_key)
  values('bling','bling.webhook.reconcile',jsonb_build_object('eventId',p_event_id),
    'bling:webhook:' || p_event_id) on conflict(idempotency_key) do nothing;
  return 'accepted';
end;
$$;

create or replace function public.claim_bling_job(p_lock_id uuid,p_order_enabled boolean,p_invoice_enabled boolean,
  p_send_enabled boolean,p_product_enabled boolean,p_create_enabled boolean,p_stock_enabled boolean,p_email_enabled boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare selected public.background_jobs%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('bling-job-claim'));
  with expired as (
    update public.background_jobs set status='failed',error_summary='lease_expired_reconciliation_required',locked_at=null,lock_id=null
    where queue='bling' and status='running' and locked_at<now()-interval '5 minutes' and attempts>=5
    returning id,attempts
  ) insert into private.bling_job_history(job_id,attempt,outcome,error_code)
    select id,attempts,'failed','lease_expired_reconciliation_required' from expired;
  select * into selected from public.background_jobs
  where queue='bling' and (p_order_enabled or job_type<>'bling.order.create')
    and not exists(select 1 from public.background_jobs running where running.queue='bling'
      and running.status='running' and running.locked_at>=now()-interval '5 minutes')
    and (p_invoice_enabled or job_type<>'bling.invoice.generate')
    and (p_send_enabled or job_type<>'bling.invoice.send')
    and (p_product_enabled or job_type<>'bling.product.sync')
    and (p_create_enabled or job_type<>'bling.product.create')
    and (p_stock_enabled or job_type<>'bling.stock.sync')
    and (p_email_enabled or job_type<>'bling.invoice.email')
    and (job_type<>'bling.product.sync' or not exists (
      select 1 from public.background_jobs running
      where running.queue='bling' and running.job_type='bling.product.sync' and running.status='running'
        and running.payload_sanitized->>'variantId'=public.background_jobs.payload_sanitized->>'variantId'
        and running.locked_at>=now()-interval '5 minutes'
    ))
    and (job_type<>'bling.stock.sync' or not exists (
      select 1 from public.background_jobs running
      where running.queue='bling' and running.job_type='bling.stock.sync' and running.status='running'
        and running.payload_sanitized->>'variantId'=public.background_jobs.payload_sanitized->>'variantId'
        and running.locked_at>=now()-interval '5 minutes'
    ))
    and ((status='pending' and available_at<=now())
    or (status='running' and locked_at<now()-interval '5 minutes'))
  order by available_at,id for update skip locked limit 1;
  if selected.id is null then return null; end if;
  update public.background_jobs set status='running',attempts=attempts+1,locked_at=now(),lock_id=p_lock_id,
    error_summary=null where id=selected.id;
  return jsonb_build_object('id',selected.id,'jobType',selected.job_type,
    'payload',selected.payload_sanitized,'attempts',selected.attempts+1);
end;
$$;

create or replace function public.renew_bling_job_lease(p_job_id uuid,p_lock_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.background_jobs set locked_at=now() where id=p_job_id and queue='bling' and status='running'
    and lock_id=p_lock_id and locked_at>=now()-interval '5 minutes';
  return found;
end;
$$;

create table private.bling_job_history (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.background_jobs(id) on delete restrict,
  attempt integer not null,
  outcome text not null,
  error_code text,
  occurred_at timestamptz not null default now()
);
create index bling_job_history_job_idx on private.bling_job_history(job_id,occurred_at desc);
revoke all on private.bling_job_history from public,anon,authenticated;

create or replace function public.finish_bling_job(p_job_id uuid,p_lock_id uuid,p_outcome text,p_error_code text default null,
  p_retry_after_ms integer default 0)
returns boolean language plpgsql security definer set search_path = '' as $$
declare finished_attempt integer;
begin
  if p_outcome not in ('completed','retry','failed') then raise exception 'invalid_outcome'; end if;
  update public.background_jobs set
    status=case when p_outcome='completed' then 'completed'::public.job_status
      when p_outcome='retry' and attempts<5 then 'pending'::public.job_status else 'failed'::public.job_status end,
    available_at=case when p_outcome='retry' then now()+make_interval(secs=>greatest(ceil(least(greatest(p_retry_after_ms,0),86400000)/1000.0)::integer,
      least(3600,30*power(2,least(attempts,6))::integer)+floor(random()*15)::integer))
      else available_at end,
    completed_at=case when p_outcome='completed' then now() else null end,
    error_summary=case when p_outcome='completed' then null else left(coalesce(p_error_code,'bling_job_failed'),120) end,
    locked_at=null,lock_id=null
  where id=p_job_id and queue='bling' and status='running' and lock_id=p_lock_id returning attempts into finished_attempt;
  if finished_attempt is null then return false; end if;
  insert into private.bling_job_history(job_id,attempt,outcome,error_code)
  values(p_job_id,finished_attempt,p_outcome,left(p_error_code,120));
  return true;
end;
$$;

create or replace function public.read_bling_operational_status()
returns jsonb language sql security definer set search_path = '' stable as $$
  select jsonb_build_object(
    'queued',(select count(*) from public.background_jobs where queue='bling' and status='pending'),
    'running',(select count(*) from public.background_jobs where queue='bling' and status='running'),
    'failed',(select count(*) from public.background_jobs where queue='bling' and status='failed'),
    'ordersSynced',(select count(*) from private.bling_order_links where erp_status='synced'),
    'ordersPending',(select count(*) from private.bling_order_links where erp_status<>'synced'),
    'productsMatched',(select count(*) from private.bling_product_links),
    'lastWebhookAt',(select max(received_at) from private.bling_webhook_events),
    'lastSyncAt',(select max(last_synced_at) from private.bling_order_links));
$$;

create or replace function public.read_bling_order_link(p_order_id uuid)
returns jsonb language sql security definer set search_path = '' stable as $$
  select to_jsonb(link) from private.bling_order_links link where order_id=p_order_id;
$$;

create or replace function public.read_bling_product_links(p_variant_ids uuid[])
returns jsonb language sql security definer set search_path = '' stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('variantId',variant_id,'externalProductId',external_product_id,
    'sku',sku,'status',sync_status)), '[]'::jsonb)
  from private.bling_product_links where variant_id=any(p_variant_ids);
$$;

create or replace function public.read_bling_product_link(p_variant_id uuid)
returns jsonb language sql security definer set search_path = '' stable as $$
  select to_jsonb(link) from private.bling_product_links link where variant_id=p_variant_id;
$$;

create or replace function public.match_bling_products(p_matches jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare entry jsonb; matching_variant public.product_variants%rowtype; external_id bigint; matched integer := 0;
  existing_id bigint;
begin
  if jsonb_typeof(p_matches)<>'array' or jsonb_array_length(p_matches)>100 then raise exception 'invalid_matches'; end if;
  for entry in select value from jsonb_array_elements(p_matches) loop
    external_id := (entry->>'externalProductId')::bigint;
    if external_id<=0 then raise exception 'invalid_external_id'; end if;
    select * into matching_variant from public.product_variants where sku=(entry->>'sku')::extensions.citext for update;
    if matching_variant.id is null then raise exception 'sku_missing'; end if;
    select external_product_id into existing_id from private.bling_product_links where variant_id=matching_variant.id;
    if existing_id is not null and existing_id<>external_id then raise exception 'sku_link_conflict'; end if;
    insert into private.bling_product_links(variant_id,external_product_id,sku,source,local_version,sync_status,last_synced_at)
    values(matching_variant.id,external_id,matching_variant.sku::text,'curtiz',null,'matched',now())
    on conflict(variant_id) do update set sku=excluded.sku,last_synced_at=now();
    insert into public.background_jobs(queue,job_type,payload_sanitized,idempotency_key)
    values('bling','bling.product.sync',jsonb_build_object('variantId',matching_variant.id),
      'bling:product:initial:' || matching_variant.id::text)
    on conflict(idempotency_key) do nothing;
    insert into public.background_jobs(queue,job_type,payload_sanitized,idempotency_key)
    values('bling','bling.stock.sync',jsonb_build_object('variantId',matching_variant.id),
      'bling:stock:initial:' || matching_variant.id::text)
    on conflict(idempotency_key) do nothing;
    matched := matched+1;
  end loop;
  return matched;
end;
$$;

create or replace function public.enqueue_bling_product_create(p_variant_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_permission('technical.integrations.manage');
  if not exists(select 1 from public.product_variants where id=p_variant_id) or exists(
    select 1 from private.bling_product_links where variant_id=p_variant_id) then return false; end if;
  insert into public.background_jobs(queue,job_type,payload_sanitized,idempotency_key)
  values('bling','bling.product.create',jsonb_build_object('variantId',p_variant_id),
    'bling:create-product:' || p_variant_id::text) on conflict(idempotency_key) do nothing;
  return found;
end;
$$;

create or replace function private.enqueue_bling_variant_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from private.bling_product_links where variant_id=new.id) then return new; end if;
  if tg_op='UPDATE' and (new.sku,new.color_name,new.size,new.price_override,new.active)
    is not distinct from (old.sku,old.color_name,old.size,old.price_override,old.active) then return new; end if;
  update private.bling_product_links set sync_status='pending',updated_at=now() where variant_id=new.id;
  insert into public.background_jobs(queue,job_type,payload_sanitized,idempotency_key)
  values('bling','bling.product.sync',jsonb_build_object('variantId',new.id),
    'bling:product:' || new.id::text || ':' || extract(epoch from clock_timestamp())::text)
  on conflict(idempotency_key) do nothing;
  return new;
end;
$$;
create trigger enqueue_bling_variant_change after insert or update on public.product_variants
  for each row execute function private.enqueue_bling_variant_change();
revoke all on function private.enqueue_bling_variant_change() from public,anon,authenticated;

create or replace function private.archive_bling_removed_variant()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update private.bling_product_links set removed=true,sync_status='pending',updated_at=now() where variant_id=old.id;
  if found then
    insert into public.background_jobs(queue,job_type,payload_sanitized,idempotency_key)
    values('bling','bling.product.sync',jsonb_build_object('variantId',old.id),
      'bling:archive-product:' || old.id::text) on conflict(idempotency_key) do nothing;
  end if;
  return old;
end;
$$;
create trigger archive_bling_removed_variant before delete on public.product_variants
  for each row execute function private.archive_bling_removed_variant();
revoke all on function private.archive_bling_removed_variant() from public,anon,authenticated;

create or replace function private.enqueue_bling_product_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if (new.name,new.status,new.base_price,new.weight_grams,new.height_cm,new.width_cm,new.length_cm)
    is not distinct from (old.name,old.status,old.base_price,old.weight_grams,old.height_cm,old.width_cm,old.length_cm)
    then return new; end if;
  for v_id in select link.variant_id from private.bling_product_links link
    join public.product_variants v on v.id=link.variant_id where v.product_id=new.id loop
    update private.bling_product_links set sync_status='pending',updated_at=now() where variant_id=v_id;
    insert into public.background_jobs(queue,job_type,payload_sanitized,idempotency_key)
    values('bling','bling.product.sync',jsonb_build_object('variantId',v_id),
      'bling:product:' || v_id::text || ':' || extract(epoch from clock_timestamp())::text)
    on conflict(idempotency_key) do nothing;
  end loop;
  return new;
end;
$$;
create trigger enqueue_bling_product_change after update on public.products
  for each row execute function private.enqueue_bling_product_change();
revoke all on function private.enqueue_bling_product_change() from public,anon,authenticated;

create or replace function private.enqueue_bling_stock_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='UPDATE' and new.available_quantity+new.reserved_quantity = old.available_quantity+old.reserved_quantity
    then
      update private.bling_product_links set local_version=new.version where variant_id=new.variant_id and local_version=old.version;
      return new;
    end if;
  if not exists(select 1 from private.bling_product_links where variant_id=new.variant_id) then return new; end if;
  insert into public.background_jobs(queue,job_type,payload_sanitized,idempotency_key)
  values('bling','bling.stock.sync',jsonb_build_object('variantId',new.variant_id),
    'bling:stock:' || new.variant_id::text || ':' || new.version::text)
  on conflict(idempotency_key) do nothing;
  return new;
end;
$$;
create trigger enqueue_bling_stock_change after insert or update on public.inventory
  for each row execute function private.enqueue_bling_stock_change();
revoke all on function private.enqueue_bling_stock_change() from public,anon,authenticated;

create or replace function public.mark_bling_stock_synced(p_variant_id uuid,p_expected_version integer,p_expected_quantity integer)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update private.bling_product_links link set local_version=inventory.version,last_synced_at=now()
  from public.inventory inventory where link.variant_id=p_variant_id and inventory.variant_id=p_variant_id
    and inventory.version>=p_expected_version and inventory.available_quantity+inventory.reserved_quantity=p_expected_quantity;
  return found;
end;
$$;

create or replace function public.mark_bling_product_status(p_variant_id uuid,p_status text,p_sku text,
  p_expected_updated_at timestamptz,p_error_code text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('synced','failed','reconciliation_required') then raise exception 'invalid_status'; end if;
  update private.bling_product_links set sync_status=p_status,
    sku=case when p_status='synced' then p_sku else sku end,
    last_error_code=case when p_status='synced' then null else left(p_error_code,120) end,
    last_synced_at=case when p_status='synced' then now() else last_synced_at end,updated_at=now()
  where variant_id=p_variant_id and updated_at=p_expected_updated_at;
  return found;
end;
$$;

create or replace function public.read_bling_webhook_event(p_event_id text)
returns jsonb language sql security definer set search_path = '' stable as $$
  select to_jsonb(event) from private.bling_webhook_events event where event_id=p_event_id;
$$;

create or replace function public.finish_bling_webhook_event(p_event_id text,p_status text,p_error_code text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('processed','ignored','failed') then raise exception 'invalid_status'; end if;
  update private.bling_webhook_events set status=p_status,attempts=attempts+1,
    processed_at=case when p_status='failed' then null else now() end,
    last_error_code=case when p_status='failed' then left(coalesce(p_error_code,'reconcile_failed'),120) else null end
  where event_id=p_event_id;
  return found;
end;
$$;

create or replace function public.save_bling_order_link(p_order_id uuid,p_external_order_id bigint,
  p_external_contact_id bigint)
returns boolean language plpgsql security definer set search_path = '' as $$
declare eligible boolean;
begin
  select o.payment_status='approved' and o.status not in
    ('cancelled','refunded','manual_review','cancellation_requested','refund_pending')
    and not exists(select 1 from public.payment_refunds r where r.order_id=o.id and r.status='completed')
    into eligible from public.orders o where o.id=p_order_id;
  update private.bling_order_links set external_order_id=p_external_order_id,
    external_contact_id=p_external_contact_id,erp_status=case when eligible then 'synced' else 'reconciliation_required' end,
    last_error_code=case when eligible then null else 'commercial_change_requires_reconciliation' end,
    last_synced_at=now(),updated_at=now()
  where order_id=p_order_id and (external_order_id is null or external_order_id=p_external_order_id);
  if not found then return false; end if;
  if not coalesce(eligible,false) then return true; end if;
  insert into public.background_jobs(queue,job_type,payload_sanitized,idempotency_key)
  values('bling','bling.invoice.generate',jsonb_build_object('orderId',p_order_id),
    'bling:generate-invoice:' || p_order_id::text) on conflict(idempotency_key) do nothing;
  return true;
end;
$$;

create or replace function public.assert_bling_order_writable(p_order_id uuid)
returns boolean language sql security definer set search_path = '' stable as $$
  select exists(select 1 from public.orders o join public.payments p on p.order_id=o.id
    where o.id=p_order_id and o.payment_status='approved' and p.provider='mercadopago' and p.status='approved'
      and p.provider_payment_id is not null and p.amount=o.grand_total and p.currency=o.currency
      and o.currency='BRL' and o.status not in ('pending_payment','cancelled','refunded','manual_review','cancellation_requested','refund_pending')
      and not exists(select 1 from public.payment_refunds r where r.order_id=o.id and r.status='completed'));
$$;

create or replace function public.save_bling_invoice_draft(p_order_id uuid,p_invoice_id bigint)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update private.bling_order_links set invoice_id=p_invoice_id,
    invoice_status=case when invoice_id is null then 'pending' else invoice_status end,updated_at=now()
  where order_id=p_order_id and external_order_id is not null
    and (invoice_id is null or invoice_id=p_invoice_id);
  if not found then return false; end if;
  if not exists(select 1 from private.bling_order_links link join public.orders o on o.id=link.order_id
    where o.id=p_order_id and link.erp_status='synced' and o.payment_status='approved'
      and o.status not in ('cancelled','refunded','manual_review','cancellation_requested','refund_pending')) then return true; end if;
  insert into public.background_jobs(queue,job_type,payload_sanitized,idempotency_key)
  values('bling','bling.invoice.send',jsonb_build_object('orderId',p_order_id),
    'bling:send-invoice:' || p_order_id::text) on conflict(idempotency_key) do nothing;
  return true;
end;
$$;

create or replace function public.mark_bling_invoice_issue(p_order_id uuid,p_status text,p_error_code text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('awaiting_data','error') then raise exception 'invalid_status'; end if;
  update private.bling_order_links set invoice_status=p_status,last_error_code=left(p_error_code,120),updated_at=now()
  where order_id=p_order_id and invoice_status not in ('authorized','cancelled');
end;
$$;

-- Called only by the service after verifying the existing sale and observing its invoice.
create or replace function public.confirm_bling_order_reconciliation(p_order_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.orders where id=p_order_id for update;
  if not public.assert_bling_order_writable(p_order_id) then return false; end if;
  update private.bling_order_links set erp_status='synced',
    last_error_code=case when invoice_status in ('rejected','cancelled','error') then last_error_code else null end,
    last_synced_at=now(),updated_at=now() where order_id=p_order_id and external_order_id is not null;
  if not found then return false; end if;
  with confirmed as (
    update public.background_jobs j set status='completed',completed_at=now(),error_summary=null
    from private.bling_order_links link where link.order_id=p_order_id and j.queue='bling'
      and j.payload_sanitized->>'orderId'=p_order_id::text and j.status='failed'
      and (j.job_type='bling.order.create'
        or j.job_type='bling.invoice.generate' and link.invoice_id is not null
        or j.job_type='bling.invoice.send' and link.invoice_status='authorized')
    returning j.id,j.attempts
  ) insert into private.bling_job_history(job_id,attempt,outcome)
    select id,attempts,'reconciled' from confirmed;
  return true;
end;
$$;

create or replace function public.mark_bling_order_issue(p_order_id uuid,p_status text,p_error_code text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('pending','failed','reconciliation_required') then raise exception 'invalid_status'; end if;
  update private.bling_order_links set erp_status=p_status,last_error_code=left(p_error_code,120),updated_at=now()
  where order_id=p_order_id and external_order_id is null;
end;
$$;

create or replace function public.observe_bling_invoice(p_invoice_id bigint,p_order_code text,p_situation integer,
  p_invoice_number text,p_access_key text,p_observed_at timestamptz)
returns boolean language plpgsql security definer set search_path = '' as $$
declare mapped_status text; linked_order_id uuid; item record;
begin
  mapped_status := case p_situation when 1 then 'pending' when 2 then 'cancelled'
    when 3 then 'processing' when 4 then 'rejected' when 5 then 'authorized'
    when 6 then 'authorized' when 7 then 'processing' when 8 then 'processing'
    when 9 then 'rejected' when 10 then 'processing' when 11 then 'rejected' else 'error' end;
  update private.bling_order_links link set invoice_id=p_invoice_id,invoice_status=mapped_status,
    invoice_number=case when mapped_status='authorized' then nullif(p_invoice_number,'') else link.invoice_number end,
    invoice_access_key=case when mapped_status='authorized' then nullif(p_access_key,'') else link.invoice_access_key end,
    last_error_code=case when mapped_status='rejected' then 'fiscal_rejected_' || p_situation::text
      when mapped_status='cancelled' then 'fiscal_cancelled' else link.last_error_code end,
    external_observed_at=p_observed_at,updated_at=now()
  from public.orders o where o.id=link.order_id and o.public_code=p_order_code
    and link.external_order_id is not null
    and (link.invoice_id is null or link.invoice_id=p_invoice_id)
    and (link.external_observed_at is null or link.external_observed_at<=p_observed_at)
  returning link.order_id into linked_order_id;
  if linked_order_id is null then
    -- A later observation already won: acknowledge this event without overwriting it.
    return exists(select 1 from private.bling_order_links link join public.orders o on o.id=link.order_id
      where link.invoice_id=p_invoice_id and o.public_code=p_order_code and link.external_observed_at>p_observed_at);
  end if;
  if mapped_status='authorized' then
    insert into public.background_jobs(queue,job_type,payload_sanitized,idempotency_key)
    values('bling','bling.invoice.email',jsonb_build_object('orderId',linked_order_id),
      'bling:invoice-email:' || linked_order_id::text || ':' || p_invoice_id::text)
    on conflict(idempotency_key) do nothing;
    update public.shipments set operation_state='pending',last_error_code=null,updated_at=now()
    where order_id=linked_order_id and operation_state='awaiting_invoice';
    update public.background_jobs j set status='pending',attempts=0,error_summary=null,available_at=now(),completed_at=null
    where j.queue='shipping' and j.status='failed' and j.error_summary='fiscal_shipping_blocked'
      and exists(select 1 from public.shipments s where s.id::text=j.payload_sanitized->>'shipmentId'
        and s.order_id=linked_order_id and s.operation_state='pending');
    for item in select distinct variant_id from public.order_items where order_id=linked_order_id loop
      insert into public.background_jobs(queue,job_type,payload_sanitized,idempotency_key)
      values('bling','bling.stock.sync',jsonb_build_object('variantId',item.variant_id),
        'bling:stock:invoice:' || p_invoice_id::text || ':' || item.variant_id::text)
      on conflict(idempotency_key) do nothing;
    end loop;
  end if;
  return true;
end;
$$;

create or replace function public.list_bling_order_issues(p_filter text default 'all',p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path = '' stable as $$
declare result jsonb;
begin
  if not (private.has_permission('operations.documents.read') or private.has_permission('orders.read_all')
    or private.has_permission('technical.integrations.manage'))
    then raise exception 'permission_denied' using errcode='42501'; end if;
  if p_filter not in ('all','pending','failed','invoice') or p_limit not between 1 and 100 then
    raise exception 'invalid_filter'; end if;
  select coalesce(jsonb_agg(to_jsonb(items) order by items.placed_at desc),'[]'::jsonb) into result
  from (select o.id as "orderId",o.public_code as "publicCode",o.placed_at,
    link.external_order_id as "externalOrderId",link.invoice_id as "invoiceId",
    link.erp_status as "erpStatus",link.invoice_status as "invoiceStatus",
    link.last_error_code as "lastErrorCode",
    job.status::text as "jobStatus",job.error_summary as "jobError",
    (select coalesce(jsonb_agg(to_jsonb(h)),'[]'::jsonb) from (
      select history.attempt,history.outcome,history.error_code,history.occurred_at
      from private.bling_job_history history join public.background_jobs hj on hj.id=history.job_id
      where hj.queue='bling' and hj.payload_sanitized->>'orderId'=o.id::text
      order by history.occurred_at desc limit 10) h) as history
    from private.bling_order_links link join public.orders o on o.id=link.order_id
    left join lateral (select j.status,j.error_summary from public.background_jobs j
      where j.queue='bling' and j.payload_sanitized->>'orderId'=o.id::text
      order by (j.status='failed') desc,j.created_at desc limit 1) job on true
    where p_filter='all' or (p_filter='pending' and link.erp_status='pending')
      or (p_filter='failed' and (link.erp_status in ('failed','reconciliation_required') or job.status='failed'))
      or (p_filter='invoice' and link.erp_status='synced' and link.invoice_status not in ('authorized','cancelled'))
    order by o.placed_at desc nulls last limit p_limit) items;
  return result;
end;
$$;

create or replace function public.retry_bling_order(p_order_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare current_status text;
begin
  if not (private.has_permission('operations.tasks.execute') or private.has_permission('technical.integrations.manage')
    or private.has_permission('orders.update_operational_status')) then raise exception 'permission_denied' using errcode='42501'; end if;
  select erp_status into current_status from private.bling_order_links where order_id=p_order_id for update;
  if current_status is null or current_status='reconciliation_required' then return false; end if;
  if not exists(select 1 from public.orders where id=p_order_id and payment_status='approved'
    and status not in ('cancelled','refunded','manual_review','cancellation_requested','refund_pending')) then return false; end if;
  update public.background_jobs set status='pending',available_at=now(),attempts=0,error_summary=null,
    lock_id=null,locked_at=null
  where queue='bling' and payload_sanitized->>'orderId'=p_order_id::text and status='failed'
    and job_type in ('bling.order.create','bling.invoice.generate','bling.invoice.send')
    and error_summary not in ('uncertain_write','external_order_mismatch','lease_expired_reconciliation_required');
  if not found then return false; end if;
  update private.bling_order_links set erp_status=case when external_order_id is null then 'pending' else 'synced' end,
    last_error_code=null,updated_at=now()
  where order_id=p_order_id;
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
  values(auth.uid(),private.current_app_role(),'integration.bling.order_retry','order',p_order_id,'{}');
  return true;
end;
$$;

create or replace function public.enqueue_bling_order_reconciliation(p_order_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not (private.has_permission('operations.tasks.execute') or private.has_permission('technical.integrations.manage')
    or private.has_permission('orders.update_operational_status')) then raise exception 'permission_denied' using errcode='42501'; end if;
  if not exists(select 1 from public.orders o join private.bling_order_links link on link.order_id=o.id
    where o.id=p_order_id and o.payment_status='approved' and o.status not in
    ('cancelled','refunded','manual_review','cancellation_requested','refund_pending')) then return false; end if;
  insert into public.background_jobs(queue,job_type,payload_sanitized,idempotency_key)
  values('bling','bling.order.reconcile',jsonb_build_object('orderId',p_order_id),'bling:reconcile:' || p_order_id::text)
  on conflict(idempotency_key) do update set status='pending',attempts=0,error_summary=null,available_at=now(),completed_at=null
    where background_jobs.status in ('completed','failed');
  if not found then return false; end if;
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
  values(auth.uid(),private.current_app_role(),'integration.bling.order_reconcile','order',p_order_id,'{}');
  return true;
end;
$$;

create or replace function public.list_my_bling_invoice_states(p_order_ids uuid[])
returns jsonb language plpgsql security definer set search_path = '' stable as $$
declare result jsonb;
begin
  if auth.uid() is null or not private.is_active_user() or coalesce(array_length(p_order_ids,1),0)>50 then
    raise exception 'permission_denied' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('orderId',o.id,
    'available',link.invoice_status='authorized' and link.invoice_access_key is not null,
    'number',case when link.invoice_status='authorized' then link.invoice_number else null end)), '[]'::jsonb)
  into result from public.orders o join private.bling_order_links link on link.order_id=o.id
  where o.id=any(p_order_ids) and o.customer_id=auth.uid();
  return result;
end;
$$;

create or replace function public.list_bling_catalog_states(p_product_id uuid)
returns jsonb language plpgsql security definer set search_path = '' stable as $$
begin
  if not (private.has_permission('products.read') or private.has_permission('products.update')
    or private.has_permission('technical.integrations.manage')) then raise exception 'permission_denied' using errcode='42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('variantId',v.id,'sku',v.sku,
    'externalProductId',link.external_product_id,'status',coalesce(link.sync_status,case when job.status='failed' then 'failed' else 'unlinked' end),
    'stockStatus',case when link.external_product_id is null then 'unlinked'
      when job.status='failed' and job.job_type='bling.stock.sync' then 'failed'
      when link.local_version=inventory.version then 'synced' else 'pending' end,
    'errorCode',coalesce(link.last_error_code,job.error_summary),'lastSyncedAt',link.last_synced_at)),'[]'::jsonb)
    from public.product_variants v left join private.bling_product_links link on link.variant_id=v.id
    left join public.inventory inventory on inventory.variant_id=v.id
    left join lateral(select j.status,j.error_summary,j.job_type from public.background_jobs j where j.queue='bling'
      and j.payload_sanitized->>'variantId'=v.id::text order by (j.status='failed') desc,j.created_at desc limit 1) job on true
    where v.product_id=p_product_id);
end;
$$;

create or replace function public.enqueue_bling_product_reconciliation(p_variant_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not (private.has_permission('products.update') or private.has_permission('technical.integrations.manage'))
    then raise exception 'permission_denied' using errcode='42501'; end if;
  if not exists(select 1 from public.product_variants where id=p_variant_id) then return false; end if;
  insert into public.background_jobs(queue,job_type,payload_sanitized,idempotency_key)
  values('bling','bling.product.reconcile',jsonb_build_object('variantId',p_variant_id),'bling:reconcile-product:' || p_variant_id::text)
  on conflict(idempotency_key) do update set status='pending',attempts=0,error_summary=null,available_at=now(),completed_at=null
    where background_jobs.status in ('completed','failed');
  if not found then return false; end if;
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
  values(auth.uid(),private.current_app_role(),'integration.bling.product_reconcile','product_variant',p_variant_id,'{}');
  return true;
end;
$$;

create or replace function public.confirm_bling_product_reconciliation(p_variant_id uuid,p_external_product_id bigint,p_sku text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update private.bling_product_links set sync_status='pending',last_error_code=null,sku=p_sku,updated_at=now()
    where variant_id=p_variant_id and external_product_id=p_external_product_id and not removed
      and exists(select 1 from public.product_variants v where v.id=p_variant_id and lower(v.sku::text)=lower(p_sku));
  if not found then return false; end if;
  update public.background_jobs set status='pending',attempts=0,available_at=now(),error_summary=null,completed_at=null
    where queue='bling' and payload_sanitized->>'variantId'=p_variant_id::text
      and job_type in ('bling.product.sync','bling.stock.sync') and status='failed';
  with confirmed as (
    update public.background_jobs set status='completed',completed_at=now(),error_summary=null
      where queue='bling' and payload_sanitized->>'variantId'=p_variant_id::text and job_type='bling.product.create' and status='failed'
      returning id,attempts
  ) insert into private.bling_job_history(job_id,attempt,outcome) select id,attempts,'reconciled' from confirmed;
  return true;
end;
$$;

create or replace function public.retry_bling_catalog_sync(p_variant_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not (private.has_permission('products.update') or private.has_permission('technical.integrations.manage'))
    then raise exception 'permission_denied' using errcode='42501'; end if;
  perform 1 from private.bling_product_links where variant_id=p_variant_id and sync_status<>'reconciliation_required' for update;
  if not found then return false; end if;
  update public.background_jobs set status='pending',attempts=0,error_summary=null,available_at=now(),completed_at=null
    where queue='bling' and job_type in ('bling.product.sync','bling.stock.sync')
      and payload_sanitized->>'variantId'=p_variant_id::text and status='failed'
      and error_summary not in ('uncertain_write','external_sku_changed','lease_expired_reconciliation_required');
  if not found then return false; end if;
  update private.bling_product_links set sync_status='pending',last_error_code=null,updated_at=now() where variant_id=p_variant_id;
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
  values(auth.uid(),private.current_app_role(),'integration.bling.catalog_retry','product_variant',p_variant_id,'{}');
  return true;
end;
$$;

create or replace function public.read_bling_management_summary()
returns jsonb language plpgsql security definer set search_path = '' stable as $$
begin
  perform private.require_permission('financial.read_summary');
  return jsonb_build_object('synced',(select count(*) from private.bling_order_links where erp_status='synced'),
    'pending',(select count(*) from private.bling_order_links where erp_status='pending'),
    'failed',(select count(*) from private.bling_order_links where erp_status in ('failed','reconciliation_required')
      or invoice_status in ('rejected','error')));
end;
$$;

create table private.bling_shipping_policy (
  singleton boolean primary key default true check (singleton),
  invoice_required boolean not null default false
);

create or replace function public.record_bling_email_acceptance(p_order_id uuid,p_provider_id text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if length(p_provider_id) not between 1 and 200 then raise exception 'invalid_provider_id'; end if;
  update private.bling_order_links set email_provider_id=p_provider_id,email_accepted_at=now()
    where order_id=p_order_id and (email_provider_id is null or email_provider_id=p_provider_id);
  return found;
end;
$$;
insert into private.bling_shipping_policy(singleton) values(true);
revoke all on private.bling_shipping_policy from public,anon,authenticated,service_role;

create or replace function public.set_bling_shipping_policy(p_required boolean)
returns void language sql security definer set search_path = '' as $$
  -- Activation is sticky; disabling requires the database owner and a reviewed release.
  update private.bling_shipping_policy set invoice_required=invoice_required or coalesce(p_required,false);
$$;

create or replace function public.begin_bling_email_attempt(p_order_id uuid)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare started_at timestamptz;
begin
  update private.bling_order_links set email_first_attempt_at=coalesce(email_first_attempt_at,now())
  where order_id=p_order_id and invoice_status='authorized' and email_provider_id is null
  returning email_first_attempt_at into started_at;
  return started_at;
end;
$$;

create or replace function public.read_bling_shipping_clearance(p_order_id uuid)
returns jsonb language sql security definer set search_path = '' stable as $$
  select jsonb_build_object('required',policy.invoice_required,
    'allowed',not policy.invoice_required or (link.invoice_status='authorized' and link.erp_status='synced'
      and link.invoice_access_key ~ '^[0-9]{44}$'),
    'accessKey',case when policy.invoice_required and link.invoice_status='authorized' then link.invoice_access_key else null end)
  from private.bling_shipping_policy policy left join private.bling_order_links link on link.order_id=p_order_id;
$$;

create or replace function private.guard_bling_shipment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (new.operation_state is distinct from old.operation_state and new.operation_state in ('creating','purchasing','generating','generated'))
    or (new.status is distinct from old.status and new.status='dispatched') then
    if (select invoice_required from private.bling_shipping_policy where singleton) and not exists(
      select 1 from private.bling_order_links link join public.orders o on o.id=link.order_id
      where link.order_id=new.order_id and link.invoice_status='authorized' and link.erp_status='synced'
        and link.invoice_access_key ~ '^[0-9]{44}$' and o.payment_status='approved'
        and o.status not in ('cancelled','refunded','manual_review','cancellation_requested','refund_pending')) then
      raise exception 'fiscal_shipping_blocked' using errcode='23514';
    end if;
  end if;
  return new;
end;
$$;
create trigger guard_bling_shipment before update of operation_state,status on public.shipments
  for each row execute function private.guard_bling_shipment();
revoke all on function private.guard_bling_shipment() from public,anon,authenticated;

create or replace function private.guard_bling_order_dispatch()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status and (new.status='shipped' or new.status='delivered' and old.status<>'shipped')
    and (select invoice_required from private.bling_shipping_policy where singleton) then
    if not exists(select 1 from private.bling_order_links link where link.order_id=new.id
      and link.invoice_status='authorized' and link.erp_status='synced' and link.invoice_access_key ~ '^[0-9]{44}$')
      or new.payment_status<>'approved' then raise exception 'fiscal_shipping_blocked' using errcode='23514'; end if;
  end if;
  return new;
end;
$$;
create trigger guard_bling_order_dispatch before update of status on public.orders
  for each row execute function private.guard_bling_order_dispatch();
revoke all on function private.guard_bling_order_dispatch() from public,anon,authenticated;

create or replace function private.reconcile_bling_commercial_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target_order uuid;
begin
  if tg_table_name='orders' then
    target_order:=new.id;
    if new.status::text not in ('cancelled','cancellation_requested','refund_pending','refunded','manual_review') then return new; end if;
  elsif tg_table_name='payments' then
    target_order:=new.order_id;
    if new.status::text not in ('refunded','charged_back','cancelled') then return new; end if;
  else
    target_order:=new.order_id;
    if new.status::text<>'completed' then return new; end if;
  end if;
  update private.bling_order_links set erp_status='reconciliation_required',
    last_error_code='commercial_change_requires_reconciliation',updated_at=now()
  where order_id=target_order;
  return new;
end;
$$;
create trigger reconcile_bling_order_change after update of status on public.orders
  for each row when (old.status is distinct from new.status) execute function private.reconcile_bling_commercial_change();
create trigger reconcile_bling_payment_change after update of status on public.payments
  for each row when (old.status is distinct from new.status) execute function private.reconcile_bling_commercial_change();
create trigger reconcile_bling_refund_change after insert or update of status on public.payment_refunds
  for each row execute function private.reconcile_bling_commercial_change();
revoke all on function private.reconcile_bling_commercial_change() from public,anon,authenticated;

create or replace function public.read_my_bling_invoice_document(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path = '' stable as $$
begin
  if auth.uid() is null or not private.is_active_user() then raise exception 'permission_denied' using errcode='42501'; end if;
  return (select jsonb_build_object('accessKey',link.invoice_access_key,'invoiceId',link.invoice_id)
    from private.bling_order_links link join public.orders o on o.id=link.order_id
    where o.id=p_order_id and o.customer_id=auth.uid() and link.invoice_status='authorized'
      and link.invoice_access_key ~ '^[0-9]{44}$');
end;
$$;

-- Private data has no client policies; access is limited to the explicit RPCs.
do $$ declare relation text; begin
  foreach relation in array array['bling_request_budget','bling_accounts','bling_order_links','bling_product_links',
    'bling_webhook_events','bling_job_history','bling_shipping_policy'] loop
    execute 'alter table private.' || relation || ' enable row level security';
    execute 'alter table private.' || relation || ' force row level security';
  end loop;
end $$;

do $$ declare signature text; begin
  foreach signature in array array[
    'public.claim_bling_request_slot(text,boolean)',
    'public.disconnect_bling_connection(text,uuid)',
    'public.record_bling_api_health(text,boolean)',
    'public.assert_bling_order_writable(uuid)',
    'public.confirm_bling_order_reconciliation(uuid)',
    'public.renew_bling_job_lease(uuid,uuid)',
    'public.set_bling_shipping_policy(boolean)',
    'public.read_bling_shipping_clearance(uuid)',
    'public.read_my_bling_invoice_document(uuid)',
    'public.enqueue_bling_order_reconciliation(uuid)',
    'public.list_bling_catalog_states(uuid)',
    'public.enqueue_bling_product_reconciliation(uuid)',
    'public.confirm_bling_product_reconciliation(uuid,bigint,text)',
    'public.retry_bling_catalog_sync(uuid)',
    'public.read_bling_management_summary()',
    'public.record_bling_email_acceptance(uuid,text)',
    'public.begin_bling_email_attempt(uuid)',
    'public.save_bling_refresh(text,uuid,text,text,timestamptz,timestamptz)',
    'public.save_bling_connection(text,text,text,timestamptz,timestamptz)',
    'public.mark_bling_reconnect_required(text)',
    'public.save_bling_account(text,text,text)',
    'public.read_bling_account(text)',
    'public.accept_bling_webhook(text,text,text,text,jsonb,text)',
    'public.claim_bling_job(uuid,boolean,boolean,boolean,boolean,boolean,boolean,boolean)',
    'public.finish_bling_job(uuid,uuid,text,text,integer)',
    'public.read_bling_operational_status()'
    ,'public.read_bling_order_link(uuid)'
    ,'public.read_bling_product_links(uuid[])'
    ,'public.read_bling_product_link(uuid)'
    ,'public.match_bling_products(jsonb)'
    ,'public.enqueue_bling_product_create(uuid)'
    ,'public.mark_bling_product_status(uuid,text,text,timestamptz,text)'
    ,'public.mark_bling_stock_synced(uuid,integer,integer)'
    ,'public.read_bling_webhook_event(text)'
    ,'public.finish_bling_webhook_event(text,text,text)'
    ,'public.save_bling_order_link(uuid,bigint,bigint)'
    ,'public.save_bling_invoice_draft(uuid,bigint)'
    ,'public.mark_bling_invoice_issue(uuid,text,text)'
    ,'public.mark_bling_order_issue(uuid,text,text)'
    ,'public.observe_bling_invoice(bigint,text,integer,text,text,timestamptz)'
    ,'public.list_bling_order_issues(text,integer)'
    ,'public.retry_bling_order(uuid)'
    ,'public.list_my_bling_invoice_states(uuid[])'
  ] loop
    execute 'revoke all on function ' || signature || ' from public, anon, authenticated';
    execute 'grant execute on function ' || signature || ' to service_role';
  end loop;
end $$;

revoke all on function public.list_bling_order_issues(text,integer) from service_role;
grant execute on function public.list_bling_order_issues(text,integer) to authenticated;
revoke all on function public.retry_bling_order(uuid) from service_role;
grant execute on function public.retry_bling_order(uuid) to authenticated;
revoke all on function public.enqueue_bling_product_create(uuid) from service_role;
grant execute on function public.enqueue_bling_product_create(uuid) to authenticated;
revoke all on function public.list_my_bling_invoice_states(uuid[]) from service_role;
grant execute on function public.list_my_bling_invoice_states(uuid[]) to authenticated;
revoke all on function public.read_my_bling_invoice_document(uuid) from service_role;
grant execute on function public.read_my_bling_invoice_document(uuid) to authenticated;
revoke all on function public.enqueue_bling_order_reconciliation(uuid) from service_role;
grant execute on function public.enqueue_bling_order_reconciliation(uuid) to authenticated;
revoke all on function public.list_bling_catalog_states(uuid) from service_role;
grant execute on function public.list_bling_catalog_states(uuid) to authenticated;
revoke all on function public.enqueue_bling_product_reconciliation(uuid) from service_role;
grant execute on function public.enqueue_bling_product_reconciliation(uuid) to authenticated;
revoke all on function public.retry_bling_catalog_sync(uuid) from service_role;
grant execute on function public.retry_bling_catalog_sync(uuid) to authenticated;
revoke all on function public.read_bling_management_summary() from service_role;
grant execute on function public.read_bling_management_summary() to authenticated;

commit;

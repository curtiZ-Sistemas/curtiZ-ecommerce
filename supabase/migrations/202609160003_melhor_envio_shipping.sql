begin;

-- Tokens OAuth ficam cifrados pela aplicacao. A tabela nao possui politica de acesso
-- para clientes/painel e so pode ser usada pelo backend com service_role.
create table if not exists private.integration_credentials (
  provider text not null,
  environment text not null check (environment in ('sandbox','production')),
  access_token_ciphertext text not null,
  refresh_token_ciphertext text not null,
  access_token_expires_at timestamptz not null,
  refresh_token_expires_at timestamptz,
  status text not null default 'connected' check (status in ('connected','refresh_required','disconnected','error')),
  refresh_lock_id uuid,
  refresh_locked_until timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(provider,environment)
);
revoke all on private.integration_credentials from public, anon, authenticated;

create table if not exists private.integration_oauth_states (
  state_hash text primary key,
  provider text not null,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  environment text not null check (environment in ('sandbox','production')),
  return_path text not null default '/tecnico',
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists integration_oauth_states_expiry_idx
  on private.integration_oauth_states(expires_at) where consumed_at is null;
revoke all on private.integration_oauth_states from public, anon, authenticated;

create or replace function public.read_integration_credential(p_provider text,p_environment text)
returns jsonb language sql security definer set search_path = '' stable as $$
  select jsonb_build_object('access_token_ciphertext',access_token_ciphertext,
    'refresh_token_ciphertext',refresh_token_ciphertext,'access_token_expires_at',access_token_expires_at,
    'refresh_token_expires_at',refresh_token_expires_at,'status',status,'environment',environment)
  from private.integration_credentials where provider=p_provider and environment=p_environment;
$$;
create or replace function public.save_integration_credential(p_provider text,p_environment text,
  p_access_token_ciphertext text,p_refresh_token_ciphertext text,p_access_token_expires_at timestamptz,
  p_refresh_token_expires_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into private.integration_credentials(provider,environment,access_token_ciphertext,refresh_token_ciphertext,
    access_token_expires_at,refresh_token_expires_at,status,last_error_code)
  values(p_provider,p_environment,p_access_token_ciphertext,p_refresh_token_ciphertext,p_access_token_expires_at,
    p_refresh_token_expires_at,'connected',null)
  on conflict(provider,environment) do update set
    access_token_ciphertext=excluded.access_token_ciphertext,refresh_token_ciphertext=excluded.refresh_token_ciphertext,
    access_token_expires_at=excluded.access_token_expires_at,refresh_token_expires_at=excluded.refresh_token_expires_at,
    status='connected',last_error_code=null,updated_at=now();
end;
$$;
create or replace function public.claim_integration_refresh(p_provider text,p_environment text,p_lock_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update private.integration_credentials
  set refresh_lock_id=p_lock_id,refresh_locked_until=now()+interval '30 seconds',updated_at=now()
  where provider=p_provider and environment=p_environment and status <> 'disconnected'
    and (refresh_locked_until is null or refresh_locked_until < now() or refresh_lock_id=p_lock_id);
  return found;
end;
$$;
create or replace function public.release_integration_refresh(p_provider text,p_environment text,p_lock_id uuid)
returns void language sql security definer set search_path = '' as $$
  update private.integration_credentials set refresh_lock_id=null,refresh_locked_until=null,updated_at=now()
  where provider=p_provider and environment=p_environment and refresh_lock_id=p_lock_id;
$$;
revoke all on function public.read_integration_credential(text,text) from public,anon,authenticated;
revoke all on function public.save_integration_credential(text,text,text,text,timestamptz,timestamptz) from public,anon,authenticated;
revoke all on function public.claim_integration_refresh(text,text,uuid) from public,anon,authenticated;
revoke all on function public.release_integration_refresh(text,text,uuid) from public,anon,authenticated;
grant execute on function public.read_integration_credential(text,text) to service_role;
grant execute on function public.save_integration_credential(text,text,text,text,timestamptz,timestamptz) to service_role;
grant execute on function public.claim_integration_refresh(text,text,uuid) to service_role;
grant execute on function public.release_integration_refresh(text,text,uuid) to service_role;

create or replace function public.create_integration_oauth_state(p_state_hash text,p_provider text,p_actor_id uuid,
  p_environment text,p_return_path text,p_expires_at timestamptz)
returns void language sql security definer set search_path = '' as $$
  insert into private.integration_oauth_states(state_hash,provider,actor_id,environment,return_path,expires_at)
  values(p_state_hash,p_provider,p_actor_id,p_environment,p_return_path,p_expires_at);
$$;
create or replace function public.consume_integration_oauth_state(p_state_hash text,p_provider text,p_actor_id uuid,p_environment text)
returns text language plpgsql security definer set search_path = '' as $$
declare result text;
begin
  update private.integration_oauth_states set consumed_at=now()
  where state_hash=p_state_hash and provider=p_provider and actor_id=p_actor_id and environment=p_environment
    and consumed_at is null and expires_at>now()
  returning return_path into result;
  return result;
end;
$$;
create or replace function public.disconnect_integration_credential(p_provider text,p_environment text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update private.integration_credentials set status='disconnected',access_token_ciphertext='',refresh_token_ciphertext='',
    refresh_lock_id=null,refresh_locked_until=null,updated_at=now()
  where provider=p_provider and environment=p_environment;
  return found;
end;
$$;
revoke all on function public.create_integration_oauth_state(text,text,uuid,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.consume_integration_oauth_state(text,text,uuid,text) from public,anon,authenticated;
revoke all on function public.disconnect_integration_credential(text,text) from public,anon,authenticated;
grant execute on function public.create_integration_oauth_state(text,text,uuid,text,text,timestamptz) to service_role;
grant execute on function public.consume_integration_oauth_state(text,text,uuid,text) to service_role;
grant execute on function public.disconnect_integration_credential(text,text) to service_role;

alter table public.shipping_quotes
  alter column cart_id drop not null,
  add column if not exists customer_id uuid references public.profiles(id) on delete cascade,
  add column if not exists service_id text,
  add column if not exists carrier text,
  add column if not exists cost numeric(12,2) check (cost >= 0),
  add column if not exists destination_postal_code text,
  add column if not exists cart_fingerprint text,
  add column if not exists provider_environment text check (provider_environment in ('sandbox','production')),
  add column if not exists provider_payload jsonb not null default '{}'::jsonb,
  add column if not exists used_at timestamptz,
  add column if not exists order_id uuid references public.orders(id);

alter table public.shipping_quotes drop constraint if exists shipping_quotes_owner_check;
alter table public.shipping_quotes add constraint shipping_quotes_owner_check
  check (cart_id is not null or customer_id is not null) not valid;
alter table public.shipping_quotes validate constraint shipping_quotes_owner_check;
create index if not exists shipping_quotes_customer_expiry_idx
  on public.shipping_quotes(customer_id,expires_at desc) where used_at is null;
create unique index if not exists shipping_quotes_order_uidx
  on public.shipping_quotes(order_id) where order_id is not null;

drop policy if exists "customer reads own shipping quotes" on public.shipping_quotes;
create policy "customer reads own shipping quotes" on public.shipping_quotes
  for select to authenticated using (
    customer_id=auth.uid() or exists(select 1 from public.carts c where c.id=cart_id and c.customer_id=auth.uid())
  );

alter table public.shipments
  add column if not exists shipping_quote_id uuid references public.shipping_quotes(id),
  add column if not exists external_id text,
  add column if not exists carrier text,
  add column if not exists shipping_amount numeric(12,2) check (shipping_amount >= 0),
  add column if not exists shipping_cost numeric(12,2) check (shipping_cost >= 0),
  add column if not exists estimated_days integer check (estimated_days > 0),
  add column if not exists volume_index integer not null default 0 check (volume_index >= 0),
  add column if not exists operation_state text not null default 'pending'
    check (operation_state in ('pending','awaiting_invoice','creating','created','purchasing','purchased','generating','generated','posted','delivered','cancelling','cancelled','reconciliation_required','failed')),
  add column if not exists operation_key uuid not null default gen_random_uuid(),
  add column if not exists last_error_code text,
  add column if not exists updated_at timestamptz not null default now();
create unique index if not exists shipments_provider_external_uidx
  on public.shipments(provider,external_id) where external_id is not null;
create unique index if not exists shipments_quote_volume_uidx
  on public.shipments(shipping_quote_id,volume_index) where shipping_quote_id is not null;

alter type public.shipment_status add value if not exists 'cancelled';

create table if not exists public.shipping_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_key text not null,
  payload_hash text not null,
  signature_valid boolean not null,
  event_type text not null,
  occurred_at timestamptz,
  processing_status text not null default 'received' check (processing_status in ('received','processed','ignored','failed')),
  error_code text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique(provider,provider_event_key)
);
alter table public.shipping_webhook_events enable row level security;
alter table public.shipping_webhook_events force row level security;
create policy "technical reads shipping webhooks" on public.shipping_webhook_events
  for select to authenticated using (private.has_permission('technical.health.read'));
revoke insert,update,delete,truncate on public.shipping_webhook_events from anon,authenticated;
grant select on public.shipping_webhook_events to authenticated;

create or replace function public.apply_melhor_envio_webhook(
  p_event_key text,p_payload_hash text,p_event_type text,p_external_id text,
  p_status text,p_occurred_at timestamptz,p_tracking_code text default null
)
returns text language plpgsql security definer set search_path = '' as $$
declare webhook public.shipping_webhook_events%rowtype; shipment public.shipments%rowtype;
  current_rank integer; target_rank integer;
begin
  insert into public.shipping_webhook_events(provider,provider_event_key,payload_hash,signature_valid,event_type,occurred_at)
  values('melhorenvio',p_event_key,p_payload_hash,true,p_event_type,p_occurred_at)
  on conflict(provider,provider_event_key) do nothing;
  select * into webhook from public.shipping_webhook_events
    where provider='melhorenvio' and provider_event_key=p_event_key for update;
  if webhook.payload_hash<>p_payload_hash then return 'hash_conflict'; end if;
  if webhook.processing_status in ('processed','ignored') then return 'duplicate'; end if;
  begin
    select * into shipment from public.shipments
      where provider='melhorenvio' and external_id=p_external_id for update;
    if shipment.id is null then
      update public.shipping_webhook_events set processing_status='ignored',processed_at=now()
        where id=webhook.id;
      return 'ignored';
    end if;
    if p_status is not null then
      current_rank := case shipment.status::text when 'pending' then 0 when 'label_created' then 2 when 'ready' then 3
        when 'dispatched' then 4 when 'in_transit' then 5 when 'delayed' then 6 when 'delivered' then 7
        when 'returned' then 8 when 'cancelled' then 8 else 0 end;
      target_rank := case p_status when 'pending' then 0 when 'label_created' then 2 when 'ready' then 3
        when 'dispatched' then 4 when 'in_transit' then 5 when 'delayed' then 6 when 'delivered' then 7
        when 'returned' then 8 when 'cancelled' then 8 else -1 end;
      if target_rank>=current_rank then
        update public.shipments set status=p_status::public.shipment_status,
          operation_state=case when p_status='delivered' then 'delivered' when p_status='cancelled' then 'cancelled'
            when p_status in ('dispatched','in_transit','delayed','returned') then 'posted' else operation_state end,
          tracking_code=coalesce(nullif(p_tracking_code,''),tracking_code),
          dispatched_at=case when p_status='dispatched' then p_occurred_at else dispatched_at end,
          delivered_at=case when p_status='delivered' then p_occurred_at else delivered_at end,updated_at=now()
        where id=shipment.id;
        insert into public.tracking_events(shipment_id,provider_event_id,status,description,occurred_at)
        values(shipment.id,p_event_key,p_status::public.shipment_status,'Atualização de transporte: '||p_status,p_occurred_at)
        on conflict(shipment_id,provider_event_id) do nothing;
      end if;
    end if;
    update public.shipping_webhook_events set processing_status='processed',error_code=null,processed_at=now()
      where id=webhook.id;
    return 'processed';
  exception when others then
    update public.shipping_webhook_events set processing_status='failed',error_code='webhook_processing_failed'
      where id=webhook.id;
    return 'failed';
  end;
end;
$$;
revoke all on function public.apply_melhor_envio_webhook(text,text,text,text,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.apply_melhor_envio_webhook(text,text,text,text,text,timestamptz,text) to service_role;

-- Confirma a cotacao sob lock e corrige o valor inicialmente materializado pelo
-- fluxo legado. O cliente fornece somente o UUID opaco; CEP/fingerprint/valor
-- precisam coincidir com a cotacao persistida pelo backend.
create or replace function public.confirm_shipping_checkout_order(
  p_idempotency_key uuid,p_customer_id uuid,p_payment_method_id text,
  p_customer_name text,p_customer_email text,p_customer_phone text,
  p_cpf_ciphertext text,p_cpf_last_four text,p_shipping_address jsonb,p_lines jsonb,
  p_shipping_quote_id uuid,p_cart_fingerprint text,p_coupon_code text default null,
  p_reservation_minutes integer default 30
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare selected public.shipping_quotes%rowtype; created jsonb; created_order_id uuid;
  normalized_postal text; exact_replay boolean := false;
begin
  if p_customer_id is null then raise exception 'customer_required' using errcode='22023'; end if;
  perform pg_catalog.set_config('request.jwt.claims',jsonb_build_object('sub',p_customer_id,'role','authenticated')::text,true);
  normalized_postal := regexp_replace(coalesce(p_shipping_address->>'postalCode',''),'[^0-9]','','g');
  select * into selected from public.shipping_quotes where id=p_shipping_quote_id for update;
  if selected.id is null or selected.customer_id is distinct from p_customer_id then
    raise exception 'shipping_quote_not_found' using errcode='P0002';
  end if;
  if selected.used_at is not null then
    select exists(select 1 from public.idempotency_keys checkout_key
      where checkout_key.scope='mercadopago.checkout.test' and checkout_key.key=p_idempotency_key::text
        and checkout_key.resource_id=selected.order_id) into exact_replay;
    if not exact_replay then raise exception 'shipping_quote_expired' using errcode='P0001'; end if;
  elsif selected.expires_at <= now() then
    raise exception 'shipping_quote_expired' using errcode='P0001';
  end if;
  if selected.provider <> 'melhorenvio' or selected.destination_postal_code <> normalized_postal
    or (not exact_replay and selected.cart_fingerprint <> p_cart_fingerprint)
    or selected.amount < 0 or selected.cost is null or selected.cost < 0
    or selected.service_id is null or selected.carrier is null or selected.provider_environment is null then
    raise exception 'shipping_quote_changed' using errcode='P0001';
  end if;
  created := public.confirm_professional_checkout_order(
    p_idempotency_key,p_customer_id,p_payment_method_id,p_customer_name,p_customer_email,p_customer_phone,
    p_cpf_ciphertext,p_cpf_last_four,p_shipping_address,p_lines,p_coupon_code,p_reservation_minutes
  );
  created_order_id := (created->>'orderId')::uuid;
  if exact_replay and created_order_id is distinct from selected.order_id then
    raise exception 'idempotency_conflict' using errcode='22023';
  end if;
  update public.orders set shipping_total=selected.amount,shipping_cost=selected.cost,
    grand_total=subtotal-discount_total+selected.amount,
    commercial_rules_snapshot=coalesce(commercial_rules_snapshot,'{}'::jsonb)||jsonb_build_object(
      'shippingProvider',selected.provider,'shippingQuoteId',selected.id,'shippingServiceId',selected.service_id,
      'shippingService',selected.service,'shippingCarrier',selected.carrier,'shippingEstimatedDays',selected.estimated_days,
      'shippingEnvironment',selected.provider_environment),updated_at=now()
  where id=created_order_id and customer_id=p_customer_id;
  update public.payments payment set amount=sale.grand_total,updated_at=now()
    from public.orders sale where sale.id=created_order_id and payment.order_id=sale.id
      and payment.provider_payment_id is null and payment.status='pending';
  update public.shipping_quotes set used_at=coalesce(used_at,now()),order_id=created_order_id where id=selected.id;
  return created||jsonb_build_object('shippingInCents',round(selected.amount*100)::bigint,
    'amountInCents',(select round(grand_total*100)::bigint from public.orders where id=created_order_id));
end;
$$;
revoke all on function public.confirm_shipping_checkout_order(uuid,uuid,text,text,text,text,text,text,jsonb,jsonb,uuid,text,text,integer)
  from public,anon,authenticated;
grant execute on function public.confirm_shipping_checkout_order(uuid,uuid,text,text,text,text,text,text,jsonb,jsonb,uuid,text,text,integer)
  to service_role;

create or replace function private.enqueue_melhor_envio_after_payment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare sale public.orders%rowtype; quote public.shipping_quotes%rowtype; shipment_id uuid;
  package_count integer; package_index integer; restricted_multi_volume boolean;
begin
  if new.status <> 'approved' or old.status='approved' then return new; end if;
  select * into sale from public.orders where id=new.order_id;
  if sale.commercial_rules_snapshot->>'shippingProvider' <> 'melhorenvio' then return new; end if;
  select * into quote from public.shipping_quotes where id=(sale.commercial_rules_snapshot->>'shippingQuoteId')::uuid;
  if quote.id is null then return new; end if;
  package_count := coalesce(jsonb_array_length(quote.provider_payload->'packages'),0);
  restricted_multi_volume := (quote.service_id in ('1','2','17') or lower(quote.carrier) like '%j&t%'
    or lower(quote.carrier) like '%loggi%') and package_count>1;
  for package_index in 0..(case when restricted_multi_volume then package_count-1 else 0 end) loop
    insert into public.shipments(order_id,provider,service,shipping_quote_id,carrier,shipping_amount,shipping_cost,
      estimated_days,volume_index,package_snapshot,operation_state,metadata_sanitized)
    values(sale.id,'melhorenvio',quote.service,quote.id,quote.carrier,
      case when package_index=0 then quote.amount else 0 end,case when package_index=0 then quote.cost else 0 end,
      quote.estimated_days,package_index,
      case when restricted_multi_volume then jsonb_build_array(quote.provider_payload->'packages'->package_index)
        else quote.provider_payload->'packages' end,
      case when quote.provider_environment='sandbox' then 'pending' else 'awaiting_invoice' end,
      jsonb_build_object('serviceId',quote.service_id,'environment',quote.provider_environment,'volumeIndex',package_index,
        'separateVolume',restricted_multi_volume,'packageCount',package_count))
    on conflict(shipping_quote_id,volume_index) where shipping_quote_id is not null do update set updated_at=now()
    returning id into shipment_id;
    insert into public.order_shipments(order_id,shipment_id) values(sale.id,shipment_id) on conflict do nothing;
    if quote.provider_environment='sandbox' then
      insert into public.background_jobs(queue,job_type,payload_sanitized,idempotency_key)
      values('shipping','melhorenvio.create',jsonb_build_object('shipmentId',shipment_id),
        'melhorenvio:create:'||shipment_id::text) on conflict(idempotency_key) do nothing;
    end if;
  end loop;
  return new;
end;
$$;
drop trigger if exists enqueue_melhor_envio_after_payment on public.payments;
create trigger enqueue_melhor_envio_after_payment after update of status on public.payments
for each row execute function private.enqueue_melhor_envio_after_payment();
revoke all on function private.enqueue_melhor_envio_after_payment() from public,anon,authenticated;

create or replace function private.enqueue_melhor_envio_cancellation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare shipment_record record;
begin
  if new.status <> 'cancellation_requested' or old.status='cancellation_requested' then return new; end if;
  for shipment_record in select id,operation_state from public.shipments
    where order_id=new.id and provider='melhorenvio' and external_id is not null
  loop
    if shipment_record.operation_state in ('purchased','generated') then
      insert into public.background_jobs(queue,job_type,payload_sanitized,idempotency_key)
      values('shipping','melhorenvio.cancel',jsonb_build_object('shipmentId',shipment_record.id),
        'melhorenvio:cancel:'||shipment_record.id::text) on conflict(idempotency_key) do nothing;
    elsif shipment_record.operation_state in ('posted','delivered') then
      insert into public.background_jobs(queue,job_type,payload_sanitized,idempotency_key)
      values('shipping','melhorenvio.cancellation_intervention',jsonb_build_object('shipmentId',shipment_record.id),
        'melhorenvio:cancellation-intervention:'||shipment_record.id::text) on conflict(idempotency_key) do nothing;
    end if;
  end loop;
  return new;
end;
$$;
drop trigger if exists enqueue_melhor_envio_cancellation on public.orders;
create trigger enqueue_melhor_envio_cancellation after update of status on public.orders
for each row execute function private.enqueue_melhor_envio_cancellation();
revoke all on function private.enqueue_melhor_envio_cancellation() from public,anon,authenticated;

alter table public.background_jobs add column if not exists lock_id uuid;

create or replace function public.claim_melhor_envio_job(p_lock_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare selected public.background_jobs%rowtype;
begin
  select * into selected from public.background_jobs
  where queue='shipping' and job_type in ('melhorenvio.create','melhorenvio.cancel')
    and status='pending' and available_at<=now()
  order by available_at,id for update skip locked limit 1;
  if selected.id is null then return null; end if;
  update public.background_jobs set status='running',attempts=attempts+1,locked_at=now(),lock_id=p_lock_id,
    error_summary=null where id=selected.id;
  return jsonb_build_object('id',selected.id,'jobType',selected.job_type,'payload',selected.payload_sanitized);
end;
$$;

create or replace function public.finish_melhor_envio_job(p_job_id uuid,p_lock_id uuid,p_success boolean,p_error_code text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.background_jobs set status=case when p_success then 'completed'::public.job_status else 'failed'::public.job_status end,
    completed_at=case when p_success then now() else null end,error_summary=case when p_success then null else left(coalesce(p_error_code,'shipping_job_failed'),120) end,
    locked_at=null,lock_id=null
  where id=p_job_id and status='running' and lock_id=p_lock_id;
  return found;
end;
$$;
revoke all on function public.claim_melhor_envio_job(uuid) from public,anon,authenticated;
revoke all on function public.finish_melhor_envio_job(uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.claim_melhor_envio_job(uuid) to service_role;
grant execute on function public.finish_melhor_envio_job(uuid,uuid,boolean,text) to service_role;

commit;
notify pgrst, 'reload schema';

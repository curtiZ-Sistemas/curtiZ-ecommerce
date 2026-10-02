-- Two transactional messages only. No historical backfill and no browser send API.
create table private.transactional_email_runtime (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  activated_at timestamptz,
  checked_at timestamptz not null default now()
);
insert into private.transactional_email_runtime(singleton) values(true);

create table private.transactional_emails (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  kind text not null check(kind in ('purchase_confirmed','review_requested')),
  job_id uuid unique references public.background_jobs(id) on delete restrict,
  state text not null default 'pending' check(state in ('pending','accepted','delivered','bounced','complained','failed','suppressed','cancelled','reconciliation_required')),
  event_at timestamptz not null default now(),
  due_at timestamptz not null,
  payload jsonb,
  first_attempt_at timestamptz,
  provider_id text unique,
  accepted_at timestamptz,
  last_event text,
  unique(order_id,kind),
  check(payload is null or jsonb_typeof(payload)='object')
);
create table private.transactional_email_attempts (
  id bigint generated always as identity primary key,
  message_id uuid not null references private.transactional_emails(id),
  attempt integer not null,
  outcome text not null,
  error_code text,
  occurred_at timestamptz not null default now()
);
create index transactional_email_attempts_message_idx on private.transactional_email_attempts(message_id,occurred_at desc);
alter table private.transactional_email_runtime enable row level security;
alter table private.transactional_email_runtime force row level security;
alter table private.transactional_emails enable row level security;
alter table private.transactional_emails force row level security;
alter table private.transactional_email_attempts enable row level security;
alter table private.transactional_email_attempts force row level security;
revoke all on private.transactional_email_runtime,private.transactional_emails,private.transactional_email_attempts from public,anon,authenticated,service_role;

create function private.transactional_email_eligible(p_order_id uuid,p_kind text)
returns boolean language sql security definer set search_path='' stable as $$
  select exists(select 1 from public.orders o where o.id=p_order_id
    and o.currency='BRL' and o.payment_status='approved' and o.status in ('payment_approved','processing','picking','ready_to_ship','shipped','delivered')
    and exists(select 1 from public.payments p where p.order_id=o.id and p.provider='mercadopago'
      and p.status='approved' and p.provider_payment_id is not null and p.currency=o.currency and p.amount=o.grand_total)
    and (p_kind='purchase_confirmed' or (p_kind='review_requested' and o.customer_id is not null and o.status='delivered'
      and not exists(select 1 from public.shipments s where s.order_id=o.id and s.status<>'delivered')
      and exists(select 1 from public.order_items i where i.order_id=o.id
        and not exists(select 1 from public.reviews r where r.order_item_id=i.id and r.customer_id=o.customer_id)))))
$$;

create function private.enqueue_transactional_email(p_order_id uuid,p_kind text)
returns void language plpgsql security definer set search_path='' as $$
declare message_id uuid; job_id uuid; due timestamptz;
begin
  if not exists(select 1 from private.transactional_email_runtime where enabled)
    or not private.transactional_email_eligible(p_order_id,p_kind) then return; end if;
  due:=now()+case when p_kind='review_requested' then interval '24 hours' else interval '0' end;
  insert into private.transactional_emails(order_id,kind,due_at) values(p_order_id,p_kind,due)
    on conflict(order_id,kind) do nothing returning id into message_id;
  if message_id is null then return; end if;
  insert into public.background_jobs(queue,job_type,payload_sanitized,idempotency_key,available_at)
    values('transactional_email','resend.'||p_kind,jsonb_build_object('messageId',message_id),
      'resend:'||p_kind||':'||p_order_id::text,due) returning id into job_id;
  update private.transactional_emails set job_id=enqueue_transactional_email.job_id where id=message_id;
end;
$$;

create function private.enqueue_order_transactional_email()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_table_name='payments' then
    if new.provider='mercadopago' and new.status='approved' and (tg_op='INSERT' or old.status is distinct from new.status) then
      perform private.enqueue_transactional_email(new.order_id,'purchase_confirmed');
    end if;
  else
    if new.payment_status='approved' and (tg_op='INSERT' or old.payment_status is distinct from new.payment_status
      or (old.status in ('draft','pending_payment','manual_review') and old.status is distinct from new.status)) then
      perform private.enqueue_transactional_email(new.id,'purchase_confirmed');
    end if;
    if new.status='delivered' and (tg_op='INSERT' or old.status is distinct from new.status) then
      perform private.enqueue_transactional_email(new.id,'review_requested');
    end if;
  end if;
  return new;
exception when others then
  -- Email storage failure must not roll back payment/order transitions. No PII.
  raise warning 'transactional_email_enqueue_failed';
  return new;
end;
$$;
create trigger enqueue_order_transactional_email after insert or update of status,payment_status on public.orders
  for each row execute function private.enqueue_order_transactional_email();
create trigger enqueue_payment_transactional_email after insert or update of status on public.payments
  for each row execute function private.enqueue_order_transactional_email();

-- Applies to both logistics webhooks and operational updates. Never backfill old deliveries.
create function private.sync_complete_order_delivery()
returns trigger language plpgsql security definer set search_path='' as $$
declare previous public.order_status;
begin
  if new.status<>'delivered' or (tg_op='UPDATE' and old.status='delivered') then return new; end if;
  select status into previous from public.orders where id=new.order_id for update;
  if previous not in ('payment_approved','processing','picking','ready_to_ship','shipped') then return new; end if;
  if exists(select 1 from public.shipments where order_id=new.order_id and status<>'delivered') then return new; end if;
  update public.orders set status='delivered',updated_at=now() where id=new.order_id and payment_status='approved';
  if found then
    insert into public.order_status_history(order_id,previous_status,new_status,reason)
      values(new.order_id,previous,'delivered','Entrega integral confirmada pelas remessas');
  end if;
  return new;
end;
$$;
create trigger sync_complete_order_delivery after insert or update of status on public.shipments
  for each row execute function private.sync_complete_order_delivery();

create function private.preserve_shipment_delivery()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.status='delivered' and new.status not in ('delivered','returned','cancelled') then
    new.status:=old.status; new.operation_state:=old.operation_state;
  end if;
  if old.delivered_at is not null then new.delivered_at:=old.delivered_at; end if;
  if new.status='delivered' then new.delivered_at:=coalesce(new.delivered_at,now()); end if;
  return new;
end;
$$;
create trigger preserve_shipment_delivery before update of status,delivered_at on public.shipments
  for each row execute function private.preserve_shipment_delivery();

create function public.sync_transactional_email_runtime(p_enabled boolean,p_configured boolean)
returns void language plpgsql security definer set search_path='' as $$
declare active boolean:=p_enabled and p_configured; failures bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('transactional-email-claim'));
  update private.transactional_email_runtime set
    activated_at=case when active and not enabled then now() else activated_at end,enabled=active,checked_at=now();
  if not active then
    update private.transactional_emails set state=case when first_attempt_at is null then 'cancelled' else 'reconciliation_required' end
      where state='pending';
    update public.background_jobs j set status=case when m.state='cancelled' then 'cancelled'::public.job_status else 'failed'::public.job_status end,
      error_summary=case when m.state='cancelled' then 'email_disabled' else 'email_reconciliation_required' end,locked_at=null,lock_id=null
      from private.transactional_emails m where m.job_id=j.id and j.status in ('pending','running') and m.provider_id is null;
  end if;
  select count(*) into failures from public.background_jobs where queue='transactional_email' and status='failed';
  insert into public.integration_health(provider,state,checked_at,error_summary,metadata_sanitized)
    values('resend_store',case when not p_enabled then 'not_configured'::public.integration_state
      when not p_configured then 'awaiting_credentials'::public.integration_state when failures>0 then 'degraded'::public.integration_state
      else 'online'::public.integration_state end,now(),
      case when not p_enabled then 'email_disabled' when not p_configured then 'email_configuration_missing'
        when failures>0 then 'email_processing_failed' else null end,
      jsonb_build_object('enabled',p_enabled,'configured',p_configured,'failedJobs',failures))
    on conflict(provider) do update set state=excluded.state,checked_at=excluded.checked_at,
      error_summary=excluded.error_summary,metadata_sanitized=excluded.metadata_sanitized;
end;
$$;

create function public.claim_transactional_email(p_lock_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare job public.background_jobs%rowtype; message private.transactional_emails%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('transactional-email-claim'));
  if not exists(select 1 from private.transactional_email_runtime where enabled) then return null; end if;
  -- Never replay an uncertain write after the provider's 24h window (1h safety margin).
  update private.transactional_emails set state='reconciliation_required'
    where state='pending' and first_attempt_at<now()-interval '23 hours';
  update public.background_jobs j set status='failed',error_summary='email_reconciliation_required',locked_at=null,lock_id=null
    from private.transactional_emails m where m.job_id=j.id and m.state='reconciliation_required' and j.status in ('pending','running');
  if exists(select 1 from public.background_jobs where queue='transactional_email' and status='running'
    and locked_at>=now()-interval '5 minutes') then return null; end if;
  select * into job from public.background_jobs where queue='transactional_email'
    and ((status='pending' and available_at<=now()) or (status='running' and locked_at<now()-interval '5 minutes'))
    order by available_at,id for update skip locked limit 1;
  if job.id is null then return null; end if;
  select * into message from private.transactional_emails where job_id=job.id for update;
  if job.status='running' then
    insert into private.transactional_email_attempts(message_id,attempt,outcome,error_code)
      values(message.id,job.attempts,'interrupted','email_lease_expired');
  end if;
  if message.provider_id is not null and job.attempts>=48 then
    update public.background_jobs set status='failed',error_summary='email_status_attempts_exhausted',locked_at=null,lock_id=null where id=job.id;
    return jsonb_build_object('skipped',true);
  end if;
  if message.provider_id is null and (job.attempts>=8 or not private.transactional_email_eligible(message.order_id,message.kind)) then
    update private.transactional_emails set state=case when first_attempt_at is not null then 'reconciliation_required'
      when job.attempts>=8 then 'failed' else 'cancelled' end where id=message.id;
    update public.background_jobs set status=case when message.first_attempt_at is not null or job.attempts>=8 then 'failed'::public.job_status
      else 'cancelled'::public.job_status end,error_summary='email_ineligible_or_exhausted',locked_at=null,lock_id=null where id=job.id;
    return jsonb_build_object('skipped',true);
  end if;
  update public.background_jobs set status='running',attempts=attempts+1,locked_at=now(),lock_id=p_lock_id where id=job.id;
  return jsonb_build_object('id',job.id,'messageId',message.id,'kind',message.kind,'providerId',message.provider_id,
    'payload',message.payload,'attempts',job.attempts+1,'firstAttemptAt',message.first_attempt_at);
end;
$$;

create function public.read_transactional_email_source(p_job_id uuid,p_lock_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare message private.transactional_emails%rowtype; result jsonb;
begin
  select m.* into message from private.transactional_emails m join public.background_jobs j on j.id=m.job_id
    where j.id=p_job_id and j.lock_id=p_lock_id and j.status='running' and j.locked_at>=now()-interval '5 minutes';
  if message.id is null or not private.transactional_email_eligible(message.order_id,message.kind) then return null; end if;
  select jsonb_build_object('order',jsonb_build_object('public_code',o.public_code,'customer_name_snapshot',o.customer_name_snapshot,
    'customer_email_snapshot',o.customer_email_snapshot,'subtotal',o.subtotal,'discount_total',o.discount_total,
    'shipping_total',o.shipping_total,'fee_total',o.fee_total,'grand_total',o.grand_total,'shipping_address_snapshot',o.shipping_address_snapshot),
    'items',(select jsonb_agg(jsonb_build_object('product_name_snapshot',i.product_name_snapshot,'color_snapshot',i.color_snapshot,
      'size_snapshot',i.size_snapshot,'quantity',i.quantity,'unit_price',i.unit_price,'total',i.total) order by i.id)
      from public.order_items i where i.order_id=o.id and (message.kind='purchase_confirmed' or not exists(
        select 1 from public.reviews r where r.order_item_id=i.id and r.customer_id=o.customer_id))))
    into result from public.orders o where o.id=message.order_id;
  return result;
end;
$$;

create function public.begin_transactional_email(p_job_id uuid,p_lock_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare message private.transactional_emails%rowtype; job public.background_jobs%rowtype;
begin
  select * into job from public.background_jobs where id=p_job_id and queue='transactional_email' for update;
  if job.lock_id is distinct from p_lock_id or job.status<>'running' or job.locked_at<now()-interval '5 minutes' then return null; end if;
  select * into message from private.transactional_emails where job_id=p_job_id for update;
  if message.provider_id is not null or message.state<>'pending' or message.due_at>now()
    or message.first_attempt_at<now()-interval '23 hours' or not private.transactional_email_eligible(message.order_id,message.kind)
    or not exists(select 1 from private.transactional_email_runtime where enabled) then return null; end if;
  if message.payload is null then
    if jsonb_typeof(p_payload)<>'object' or p_payload->'to' is distinct from (
      select jsonb_build_array(customer_email_snapshot::text) from public.orders where id=message.order_id)
      then raise exception 'invalid_email_payload'; end if;
  end if;
  update private.transactional_emails set payload=coalesce(payload,p_payload),first_attempt_at=coalesce(first_attempt_at,now())
    where id=message.id returning * into message;
  update public.background_jobs set locked_at=now() where id=p_job_id;
  return jsonb_build_object('payload',message.payload,'idempotencyKey',job.idempotency_key);
end;
$$;

create function public.finish_transactional_email(p_job_id uuid,p_lock_id uuid,p_outcome text,
  p_provider_id text default null,p_error_code text default null,p_retry_after_seconds integer default 0,p_last_event text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare job public.background_jobs%rowtype; message private.transactional_emails%rowtype; next_status public.job_status; next_state text;
begin
  if p_outcome not in ('accepted','observed','retry','uncertain','failed','cancelled') then raise exception 'invalid_email_outcome'; end if;
  if p_error_code is not null and p_error_code !~ '^[a-z_]{1,100}$' then raise exception 'invalid_email_error_code'; end if;
  select * into job from public.background_jobs where id=p_job_id and queue='transactional_email' for update;
  if job.lock_id is distinct from p_lock_id or job.status<>'running' then return false; end if;
  select * into message from private.transactional_emails where job_id=p_job_id for update;
  next_status:='pending'; next_state:=message.state;
  if p_outcome='accepted' then
    if p_provider_id is null or p_provider_id !~ '^[a-zA-Z0-9_-]{1,100}$' then raise exception 'invalid_email_provider_id'; end if;
    next_state:='accepted';
  elsif p_outcome='observed' then
    if p_last_event in ('delivered','opened','clicked') then next_state:='delivered';next_status:='completed';
    elsif p_last_event in ('bounced','complained','failed','suppressed') then next_state:=p_last_event;next_status:='failed';
    elsif job.attempts>=48 then next_status:='completed'; end if;
  elsif p_outcome in ('retry','uncertain') then
    if message.provider_id is not null and job.attempts>=48 then next_status:='failed';
    elsif message.provider_id is null and (job.attempts>=8 or message.first_attempt_at<now()-interval '23 hours') then
      next_status:='failed';next_state:=case when message.first_attempt_at is null then 'failed' else 'reconciliation_required' end;
    end if;
  else
    next_status:=case when p_outcome='cancelled' then 'cancelled'::public.job_status else 'failed'::public.job_status end;
    next_state:=case when message.provider_id is not null then message.state
      when message.first_attempt_at is not null and p_outcome='cancelled' then 'reconciliation_required' else p_outcome end;
  end if;
  update private.transactional_emails set state=next_state,
    provider_id=coalesce(provider_id,p_provider_id),accepted_at=case when p_outcome='accepted' then now() else accepted_at end,
    last_event=case when p_last_event in ('delivered','opened','clicked','bounced','complained','failed','suppressed','sent','queued','delivery_delayed','unknown')
      then p_last_event else last_event end where id=message.id;
  update public.background_jobs set status=next_status,locked_at=null,lock_id=null,
    attempts=case when p_outcome='accepted' then 0 else attempts end,
    completed_at=case when next_status='completed' then now() else null end,
    error_summary=p_error_code,available_at=now()+make_interval(secs=>greatest(least(greatest(p_retry_after_seconds,0),86400),
      case when message.provider_id is not null then 3600 else least(3600,60*power(2,least(job.attempts,6))::integer) end)) where id=p_job_id;
  insert into private.transactional_email_attempts(message_id,attempt,outcome,error_code)
    values(message.id,job.attempts,p_outcome,p_error_code);
  return true;
end;
$$;

-- Explicit, service-only reconciliation after checking the provider dashboard.
-- Attaching a receipt never sends a new email.
create function public.reconcile_transactional_email(p_message_id uuid,p_provider_id text)
returns boolean language plpgsql security definer set search_path='' as $$
declare target_job uuid;
begin
  if p_provider_id is null or p_provider_id !~ '^[a-zA-Z0-9_-]{1,100}$' then return false; end if;
  update private.transactional_emails set provider_id=p_provider_id,state='accepted',accepted_at=now()
    where id=p_message_id and provider_id is null and first_attempt_at is not null
      and state='reconciliation_required' returning job_id into target_job;
  if target_job is null then return false; end if;
  update public.background_jobs set status='pending',available_at=now(),attempts=0,error_summary=null where id=target_job;
  return true;
end;
$$;

revoke all on function private.transactional_email_eligible(uuid,text),private.enqueue_transactional_email(uuid,text),
  private.enqueue_order_transactional_email(),private.sync_complete_order_delivery(),private.preserve_shipment_delivery()
  from public,anon,authenticated;
revoke all on function public.sync_transactional_email_runtime(boolean,boolean),public.claim_transactional_email(uuid),
  public.read_transactional_email_source(uuid,uuid),public.begin_transactional_email(uuid,uuid,jsonb),
  public.finish_transactional_email(uuid,uuid,text,text,text,integer,text),public.reconcile_transactional_email(uuid,text)
  from public,anon,authenticated;
grant execute on function public.sync_transactional_email_runtime(boolean,boolean),public.claim_transactional_email(uuid),
  public.read_transactional_email_source(uuid,uuid),public.begin_transactional_email(uuid,uuid,jsonb),
  public.finish_transactional_email(uuid,uuid,text,text,text,integer,text),public.reconcile_transactional_email(uuid,text) to service_role;

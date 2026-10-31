-- One checkout fixture, one authorized recipient, fifteen minutes; commercial email stays disabled.
create table private.transactional_email_test_scope (
  singleton boolean primary key default true check(singleton),
  actor_id uuid not null references public.profiles(id),
  checkout_key uuid not null,
  started_at timestamptz not null,
  expires_at timestamptz not null,
  check(expires_at=started_at+interval '15 minutes')
);
alter table private.transactional_email_test_scope enable row level security;
alter table private.transactional_email_test_scope force row level security;
revoke all on private.transactional_email_test_scope from public,anon,authenticated,service_role;

create function private.transactional_email_allowed(p_order uuid)
returns boolean language sql security definer set search_path='' stable as $$
  select exists(select 1 from private.transactional_email_runtime where enabled)
    or exists(select 1 from private.transactional_email_test_scope s join public.orders o on o.customer_id=s.actor_id
      join public.idempotency_keys k on k.resource_id=o.id and k.scope='mercadopago.checkout.test' and k.key=s.checkout_key::text
      where o.id=p_order and s.expires_at>now() and s.started_at<=now()
        and o.created_at>=s.started_at and o.commercial_rules_snapshot->>'paymentMode'='test'
        and lower(o.customer_email_snapshot::text)='sistemas.curtiz@gmail.com')
$$;
revoke all on function private.transactional_email_allowed(uuid) from public,anon,authenticated,service_role;

create function public.configure_transactional_email_test_scope(p_actor uuid,p_checkout_key uuid,p_started_at timestamptz)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('transactional-email-claim'));
  if p_actor is null and p_checkout_key is null and p_started_at is null then
    delete from private.transactional_email_test_scope; return true;
  end if;
  if p_actor is null or p_checkout_key is null or p_started_at is null
    or p_started_at>now() or p_started_at<=now()-interval '15 minutes'
    or exists(select 1 from private.transactional_email_runtime where enabled)
    or not exists(select 1 from public.profiles where id=p_actor and status='active') then
    raise exception 'email_test_scope_invalid' using errcode='23514';
  end if;
  if exists(select 1 from private.transactional_email_test_scope where expires_at>now()
    and (actor_id<>p_actor or checkout_key<>p_checkout_key or started_at<>p_started_at)) then
    raise exception 'email_test_scope_busy' using errcode='23514';
  end if;
  insert into private.transactional_email_test_scope(singleton,actor_id,checkout_key,started_at,expires_at)
    values(true,p_actor,p_checkout_key,p_started_at,p_started_at+interval '15 minutes')
    on conflict(singleton) do update set actor_id=excluded.actor_id,checkout_key=excluded.checkout_key,
      started_at=excluded.started_at,expires_at=excluded.expires_at;
  return true;
end;
$$;
revoke all on function public.configure_transactional_email_test_scope(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.configure_transactional_email_test_scope(uuid,uuid,timestamptz) to service_role;

create function public.claim_test_transactional_email(p_lock_id uuid,p_checkout_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  -- The same advisory lock prevents a concurrent runtime enable between this guard and selection.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('transactional-email-claim'));
  if exists(select 1 from private.transactional_email_runtime where enabled)
    or not exists(select 1 from private.transactional_email_test_scope where checkout_key=p_checkout_key and expires_at>now()) then return null; end if;
  return public.claim_transactional_email(p_lock_id);
end;
$$;
revoke all on function public.claim_test_transactional_email(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_test_transactional_email(uuid,uuid) to service_role;


create or replace function private.enqueue_transactional_email(p_order_id uuid,p_kind text)
returns void language plpgsql security definer set search_path='' as $$
declare message_id uuid; v_job_id uuid; due timestamptz;
begin
  if not private.transactional_email_allowed(p_order_id)
    or not private.transactional_email_eligible(p_order_id,p_kind) then return; end if;
  due:=now()+case when p_kind='review_requested' then interval '24 hours' else interval '0' end;
  insert into private.transactional_emails(order_id,kind,due_at) values(p_order_id,p_kind,due)
    on conflict(order_id,kind) do nothing returning id into message_id;
  if message_id is null then return; end if;
  insert into public.background_jobs(queue,job_type,payload_sanitized,idempotency_key,available_at)
    values('transactional_email','resend.'||p_kind,jsonb_build_object('messageId',message_id),
      'resend:'||p_kind||':'||p_order_id::text,due) returning id into v_job_id;
  update private.transactional_emails set job_id=v_job_id where id=message_id;
end;
$$;

create or replace function public.claim_transactional_email(p_lock_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare job public.background_jobs%rowtype; message private.transactional_emails%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('transactional-email-claim'));
  if not exists(select 1 from private.transactional_email_runtime where enabled)
    and not exists(select 1 from private.transactional_email_test_scope where expires_at>now()) then return null; end if;
  -- Never replay an uncertain write after the provider's 24h window (1h safety margin).
  update private.transactional_emails set state='reconciliation_required'
    where state='pending' and private.transactional_email_allowed(order_id) and first_attempt_at<now()-interval '23 hours';
  update public.background_jobs j set status='failed',error_summary='email_reconciliation_required',locked_at=null,lock_id=null
    from private.transactional_emails m where m.job_id=j.id and private.transactional_email_allowed(m.order_id) and m.state='reconciliation_required' and j.status in ('pending','running');
  if exists(select 1 from public.background_jobs where queue='transactional_email' and status='running'
    and locked_at>=now()-interval '5 minutes') then return null; end if;
  select * into job from public.background_jobs where queue='transactional_email'
    and exists(select 1 from private.transactional_emails m where m.job_id=background_jobs.id and private.transactional_email_allowed(m.order_id))
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

create or replace function public.read_transactional_email_source(p_job_id uuid,p_lock_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare message private.transactional_emails%rowtype; result jsonb;
begin
  select m.* into message from private.transactional_emails m join public.background_jobs j on j.id=m.job_id
    where j.id=p_job_id and j.lock_id=p_lock_id and j.status='running' and j.locked_at>=now()-interval '5 minutes';
  if message.id is null or not private.transactional_email_allowed(message.order_id) or not private.transactional_email_eligible(message.order_id,message.kind) then return null; end if;
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

create or replace function public.begin_transactional_email(p_job_id uuid,p_lock_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare message private.transactional_emails%rowtype; job public.background_jobs%rowtype;
begin
  select * into job from public.background_jobs where id=p_job_id and queue='transactional_email' for update;
  if job.lock_id is distinct from p_lock_id or job.status<>'running' or job.locked_at<now()-interval '5 minutes' then return null; end if;
  select * into message from private.transactional_emails where job_id=p_job_id for update;
  if message.provider_id is not null or message.state<>'pending' or message.due_at>now()
    or message.first_attempt_at<now()-interval '23 hours' or not private.transactional_email_eligible(message.order_id,message.kind)
    or not private.transactional_email_allowed(message.order_id) then return null; end if;
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


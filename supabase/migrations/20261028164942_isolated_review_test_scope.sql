-- A short-lived scope for one already delivered TEST order. Commercial email remains disabled.
-- Keep a durable marker so a later commercial activation cannot replay TEST jobs.
create table private.transactional_review_test_orders (
  order_id uuid primary key references public.orders(id)
);
alter table private.transactional_review_test_orders enable row level security;
alter table private.transactional_review_test_orders force row level security;
revoke all on private.transactional_review_test_orders from public, anon, authenticated, service_role;

create table private.transactional_review_test_scope (
  singleton boolean primary key default true check (singleton),
  order_id uuid not null references public.orders(id),
  foreign key (singleton) references private.transactional_email_test_scope(singleton) on delete cascade
);
alter table private.transactional_review_test_scope enable row level security;
alter table private.transactional_review_test_scope force row level security;
revoke all on private.transactional_review_test_scope from public, anon, authenticated, service_role;

create or replace function private.transactional_email_allowed(p_order uuid)
returns boolean language sql security definer set search_path='' stable as $$
  select (exists(select 1 from private.transactional_email_runtime where enabled)
      and not exists(select 1 from private.transactional_review_test_orders where order_id=p_order))
    or exists(select 1 from private.transactional_email_test_scope s
      join public.orders o on o.customer_id=s.actor_id
      join public.idempotency_keys k on k.resource_id=o.id and k.scope='mercadopago.checkout.test' and k.key=s.checkout_key::text
      where o.id=p_order and s.expires_at>now() and s.started_at<=now()
        and o.commercial_rules_snapshot->>'paymentMode'='test'
        and ((o.created_at>=s.started_at and lower(o.customer_email_snapshot::text)='sistemas.curtiz@gmail.com')
          or (not exists(select 1 from private.transactional_email_runtime where enabled)
          and exists(select 1 from private.transactional_review_test_scope r
            where r.singleton=s.singleton and r.order_id=o.id))))
$$;

create function public.configure_transactional_review_test_scope(p_actor uuid,p_checkout_key uuid,p_started_at timestamptz,p_order_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare delivery_time timestamptz; message_id uuid; v_job_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('transactional-email-claim'));
  if p_actor is null or p_checkout_key is null or p_order_id is distinct from '58c273d0-f41e-4188-9c8c-3805b8a305aa'::uuid or p_started_at is null
    or p_started_at>now() or p_started_at<=now()-interval '15 minutes'
    or exists(select 1 from private.transactional_email_runtime where enabled)
    or not exists(select 1 from public.profiles where id=p_actor and status='active') then
    raise exception 'review_test_scope_invalid' using errcode='23514';
  end if;
  perform 1 from public.orders o where o.id=p_order_id and o.customer_id=p_actor
    and o.commercial_rules_snapshot->>'paymentMode'='test'
    and exists(select 1 from public.idempotency_keys k where k.resource_id=o.id
      and k.scope='mercadopago.checkout.test' and k.key=p_checkout_key::text) for update;
  if not found or not private.transactional_email_eligible(p_order_id,'review_requested') then
    raise exception 'review_test_scope_invalid' using errcode='23514';
  end if;
  select max(delivered_at) into delivery_time from public.shipments where order_id=p_order_id;
  if delivery_time is null or delivery_time>now()-interval '24 hours'
    or exists(select 1 from public.shipments where order_id=p_order_id and delivered_at is null)
    or exists(select 1 from private.transactional_emails m left join public.background_jobs j on j.id=m.job_id
      where m.order_id=p_order_id and m.kind<>'review_requested' and (m.state='pending' or j.status in ('pending','running'))) then
    raise exception 'review_test_scope_invalid' using errcode='23514';
  end if;
  if exists(select 1 from private.transactional_emails where order_id=p_order_id and kind='review_requested')
    and not exists(select 1 from private.transactional_review_test_orders where order_id=p_order_id) then
    raise exception 'review_test_scope_invalid' using errcode='23514';
  end if;
  if exists(select 1 from private.transactional_email_test_scope s where s.expires_at>now()
      and (s.actor_id<>p_actor or s.checkout_key<>p_checkout_key or s.started_at<>p_started_at
        or not exists(select 1 from private.transactional_review_test_scope r where r.singleton=s.singleton and r.order_id=p_order_id))) then
    raise exception 'email_test_scope_busy' using errcode='23514';
  end if;
  insert into private.transactional_email_test_scope(singleton,actor_id,checkout_key,started_at,expires_at)
    values(true,p_actor,p_checkout_key,p_started_at,p_started_at+interval '15 minutes')
    on conflict(singleton) do update set actor_id=excluded.actor_id,checkout_key=excluded.checkout_key,
      started_at=excluded.started_at,expires_at=excluded.expires_at;
  insert into private.transactional_review_test_scope(singleton,order_id) values(true,p_order_id)
    on conflict(singleton) do update set order_id=excluded.order_id;
  insert into private.transactional_review_test_orders(order_id) values(p_order_id)
    on conflict(order_id) do nothing;
  insert into private.transactional_emails(order_id,kind,event_at,due_at)
    values(p_order_id,'review_requested',delivery_time,delivery_time+interval '24 hours')
    on conflict(order_id,kind) do nothing returning id into message_id;
  if message_id is not null then
    insert into public.background_jobs(queue,job_type,payload_sanitized,idempotency_key,available_at)
      values('transactional_email','resend.review_requested',jsonb_build_object('messageId',message_id),
        'resend:review_requested:'||p_order_id::text,delivery_time+interval '24 hours') returning id into v_job_id;
    update private.transactional_emails set job_id=v_job_id where id=message_id;
  end if;
  return true;
end;
$$;
revoke all on function public.configure_transactional_review_test_scope(uuid,uuid,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.configure_transactional_review_test_scope(uuid,uuid,timestamptz,uuid) to service_role;

create or replace function private.enqueue_transactional_email(p_order_id uuid,p_kind text)
returns void language plpgsql security definer set search_path='' as $$
declare message_id uuid; v_job_id uuid; due timestamptz;
begin
  if p_kind<>'review_requested' and exists(select 1 from private.transactional_review_test_scope r
      join private.transactional_email_test_scope s on s.singleton=r.singleton
      where r.order_id=p_order_id and s.expires_at>now()) then return; end if;
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

-- The isolated review goes only to the authorized test mailbox. No order data is changed.
create or replace function public.begin_transactional_email(p_job_id uuid,p_lock_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare message private.transactional_emails%rowtype; job public.background_jobs%rowtype; expected_to jsonb;
begin
  select * into job from public.background_jobs where id=p_job_id and queue='transactional_email' for update;
  if job.lock_id is distinct from p_lock_id or job.status<>'running' or job.locked_at<now()-interval '5 minutes' then return null; end if;
  select * into message from private.transactional_emails where job_id=p_job_id for update;
  if message.provider_id is not null or message.state<>'pending' or message.due_at>now()
    or message.first_attempt_at<now()-interval '23 hours' or not private.transactional_email_eligible(message.order_id,message.kind)
    or not private.transactional_email_allowed(message.order_id) then return null; end if;
  if message.payload is null then
    if message.kind='review_requested' and exists(select 1 from private.transactional_review_test_scope r
        join private.transactional_email_test_scope s on s.singleton=r.singleton
        where r.order_id=message.order_id and s.expires_at>now()) then
      expected_to:=jsonb_build_array('sistemas.curtiz@gmail.com'::text);
    else
      select jsonb_build_array(customer_email_snapshot::text) into expected_to from public.orders where id=message.order_id;
    end if;
    if jsonb_typeof(p_payload)<>'object' or p_payload->'to' is distinct from expected_to then
      raise exception 'invalid_email_payload';
    end if;
  end if;
  update private.transactional_emails set payload=coalesce(payload,p_payload),first_attempt_at=coalesce(first_attempt_at,now())
    where id=message.id returning * into message;
  update public.background_jobs set locked_at=now() where id=p_job_id;
  return jsonb_build_object('payload',message.payload,'idempotencyKey',job.idempotency_key);
end;
$$;

-- Reject an unexpected claim atomically so no other kind can be dispatched through this scope.
create or replace function public.claim_test_transactional_email(p_lock_id uuid,p_checkout_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; scoped_order uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('transactional-email-claim'));
  if exists(select 1 from private.transactional_email_runtime where enabled)
    or not exists(select 1 from private.transactional_email_test_scope where checkout_key=p_checkout_key and expires_at>now()) then return null; end if;
  select r.order_id into scoped_order from private.transactional_review_test_scope r
    join private.transactional_email_test_scope s on s.singleton=r.singleton
    where s.checkout_key=p_checkout_key and s.expires_at>now();
  if scoped_order is not null and exists(select 1 from private.transactional_emails m
      left join public.background_jobs j on j.id=m.job_id where m.order_id=scoped_order
        and m.kind<>'review_requested' and (m.state='pending' or j.status in ('pending','running'))) then
    raise exception 'review_test_claim_out_of_scope' using errcode='23514';
  end if;
  result:=public.claim_transactional_email(p_lock_id);
  if scoped_order is not null and result is not null and result->>'skipped' is distinct from 'true'
    and not exists(select 1 from private.transactional_emails m where m.id=(result->>'messageId')::uuid
      and m.order_id=scoped_order and m.kind='review_requested') then
    raise exception 'review_test_claim_out_of_scope' using errcode='23514';
  end if;
  return result;
end;
$$;

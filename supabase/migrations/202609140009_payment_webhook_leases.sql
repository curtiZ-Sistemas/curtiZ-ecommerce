-- A lease prevents concurrent provider calls. Completion includes refund reconciliation.
alter table public.payment_events
  add column processing_lease_until timestamptz,
  add column processing_lease_token uuid,
  add column processing_completed_at timestamptz;

update public.payment_events set processing_completed_at = coalesce(processed_at, received_at)
where processing_status in ('processed', 'manual_review');

create table private.payment_webhook_budgets (
  payment_hash text primary key,
  window_started_at timestamptz not null,
  attempts integer not null
);
revoke all on private.payment_webhook_budgets from public, anon, authenticated;

create or replace function public.claim_payment_webhook(
  p_event_id text, p_payment_id text, p_payload_hash text, p_event_type text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  event public.payment_events%rowtype;
  identity_hash text;
  bucket timestamptz;
  attempts integer;
begin
  if p_event_id is null or length(p_event_id) not between 1 and 200
    or p_payment_id is null or p_payment_id !~ '^[a-zA-Z0-9_-]{1,100}$'
    or p_payload_hash is null or p_payload_hash !~ '^[a-f0-9]{64}$'
    or p_event_type is null or length(p_event_type) not between 1 and 100 then
    raise exception 'Invalid event' using errcode = '22023';
  end if;
  insert into public.payment_events(provider,provider_event_id,event_type,payload_hash,signature_valid,processing_status)
    values('mercadopago',p_event_id,p_event_type,p_payload_hash,true,'received')
    on conflict(provider,provider_event_id) do nothing;
  select * into event from public.payment_events
    where provider='mercadopago' and provider_event_id=p_event_id for update;
  if event.payload_hash <> p_payload_hash then return 'hash_conflict'; end if;
  if event.processing_completed_at is not null then return 'duplicate'; end if;
  if event.processing_lease_until > pg_catalog.clock_timestamp() then return 'busy'; end if;
  identity_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_payment_id, 'UTF8')), 'hex');
  bucket := pg_catalog.date_trunc('minute', pg_catalog.clock_timestamp());
  insert into private.payment_webhook_budgets as budgets(payment_hash,window_started_at,attempts)
    values(identity_hash,bucket,1)
    on conflict(payment_hash) do update set
      attempts=case when budgets.window_started_at=bucket then budgets.attempts+1 else 1 end,
      window_started_at=bucket
    returning budgets.attempts into attempts;
  if attempts > 10 then return 'limited'; end if;
  update public.payment_events set processing_lease_until=pg_catalog.clock_timestamp()+interval '60 seconds',
    processing_lease_token=gen_random_uuid(),
    processing_status='received', attempts=payment_events.attempts+1,error_summary=null
    where id=event.id returning processing_lease_token into event.processing_lease_token;
  return 'acquired:' || event.processing_lease_token::text;
end;
$$;

revoke all on function public.claim_payment_webhook(text,text,text,text) from public,anon,authenticated;
grant execute on function public.claim_payment_webhook(text,text,text,text) to service_role;

create function public.finish_payment_webhook(p_event_id text,p_lease_token uuid,p_success boolean,p_error_code text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare affected integer;
begin
  if p_success is null or (not p_success and (p_error_code is null or p_error_code not in
    ('provider_unavailable','payment_reconciliation_failed','refund_reconciliation_failed'))) then return false; end if;
  update public.payment_events set processing_completed_at=case when p_success then now() else null end,
    processing_lease_until=null,processing_lease_token=null,
    processing_status=case when not p_success then 'retry' when processing_status='manual_review' then 'manual_review' else 'processed' end,
    error_summary=case when p_success then null else p_error_code end
  where provider='mercadopago' and provider_event_id=p_event_id and processing_lease_token=p_lease_token
    and processing_lease_until>pg_catalog.clock_timestamp();
  get diagnostics affected=row_count;
  return affected=1;
end;
$$;
revoke all on function public.finish_payment_webhook(text,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.finish_payment_webhook(text,uuid,boolean,text) to service_role;
notify pgrst, 'reload schema';

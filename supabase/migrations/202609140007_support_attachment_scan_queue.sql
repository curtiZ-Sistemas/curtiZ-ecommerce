alter table public.support_attachments add column scan_sha256 text
  check (scan_sha256 is null or scan_sha256 ~ '^[a-f0-9]{64}$');
create table private.support_attachment_scan_jobs (
  id uuid primary key default gen_random_uuid(),
  attachment_id uuid not null unique references public.support_attachments(id) on delete cascade,
  state text not null default 'queued' check(state in ('queued','processing','completed','failed')),
  attempts integer not null default 0,
  lease_token uuid,
  lease_until timestamptz,
  updated_at timestamptz not null default now()
);
revoke all on private.support_attachment_scan_jobs from public,anon,authenticated;

create function private.enqueue_support_attachment_scan() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.scan_status='pending' then
    insert into private.support_attachment_scan_jobs(attachment_id) values(new.id) on conflict do nothing;
  end if;
  return new;
end;
$$;
revoke all on function private.enqueue_support_attachment_scan() from public,anon,authenticated;
create trigger enqueue_support_attachment_scan after insert on public.support_attachments
for each row execute function private.enqueue_support_attachment_scan();
insert into private.support_attachment_scan_jobs(attachment_id)
select id from public.support_attachments where scan_status='pending' on conflict do nothing;

create function public.claim_support_attachment_scan() returns jsonb
language plpgsql security definer set search_path='' as $$
declare job private.support_attachment_scan_jobs%rowtype;
begin
  select * into job from private.support_attachment_scan_jobs
  where (state='queued' or (state='processing' and lease_until<pg_catalog.clock_timestamp()))
    and attempts<5 order by updated_at limit 1 for update skip locked;
  if not found then return null; end if;
  update private.support_attachment_scan_jobs set state='processing',attempts=attempts+1,
    lease_token=gen_random_uuid(),lease_until=pg_catalog.clock_timestamp()+interval '5 minutes',updated_at=now()
    where id=job.id returning * into job;
  return (select pg_catalog.jsonb_build_object('jobId',job.id,'leaseToken',job.lease_token,
    'attachmentId',attachment.id,'storagePath',attachment.storage_path,'mimeType',attachment.mime_type,
    'sha256',attachment.scan_sha256) from public.support_attachments attachment where attachment.id=job.attachment_id);
end;
$$;

create function public.finish_support_attachment_scan(p_job_id uuid,p_lease_token uuid,p_verdict text,p_sha256 text)
returns boolean language plpgsql security definer set search_path='' as $$
declare job private.support_attachment_scan_jobs%rowtype;
begin
  if p_verdict is null or p_verdict not in ('clean','infected','suspicious','failed') then return false; end if;
  select * into job from private.support_attachment_scan_jobs where id=p_job_id for update;
  if not found or job.state<>'processing' or job.lease_token is distinct from p_lease_token
    or job.lease_until<=pg_catalog.clock_timestamp() then return false; end if;
  if p_sha256 is null or p_sha256 !~ '^[a-f0-9]{64}$' or not exists (
    select 1 from public.support_attachments where id=job.attachment_id and scan_sha256=p_sha256 and scan_status='pending'
  ) then p_verdict:='failed'; end if;
  update public.support_attachments set scan_status=p_verdict where id=job.attachment_id and scan_status='pending';
  update private.support_attachment_scan_jobs set state=case when p_verdict='failed' then 'failed' else 'completed' end,
    lease_token=null,lease_until=null,updated_at=now() where id=job.id;
  return true;
end;
$$;
revoke all on function public.claim_support_attachment_scan(),public.finish_support_attachment_scan(uuid,uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.claim_support_attachment_scan(),public.finish_support_attachment_scan(uuid,uuid,text,text)
  to service_role;
notify pgrst, 'reload schema';

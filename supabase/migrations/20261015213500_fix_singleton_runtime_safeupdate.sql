-- PostgREST sessions load safeupdate. Target the singleton explicitly instead
-- of disabling the protection; retain sticky fiscal activation and email gates.
create or replace function public.set_bling_shipping_policy(p_required boolean)
returns void language sql security definer set search_path='' as $$
  update private.bling_shipping_policy
  set invoice_required=invoice_required or coalesce(p_required,false)
  where singleton=true;
$$;

create or replace function public.sync_transactional_email_runtime(p_enabled boolean,p_configured boolean)
returns void language plpgsql security definer set search_path='' as $$
declare active boolean:=p_enabled and p_configured; failures bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('transactional-email-claim'));
  update private.transactional_email_runtime set
    activated_at=case when active and not enabled then now() else activated_at end,enabled=active,checked_at=now()
    where singleton=true;
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

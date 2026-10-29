-- Function-only change; no authorization, flag or commercial data is seeded.
create function private.claim_bling_job(p_lock_id uuid,p_order_enabled boolean,p_invoice_enabled boolean,
  p_send_enabled boolean,p_product_enabled boolean,p_create_enabled boolean,p_stock_enabled boolean,p_email_enabled boolean,p_order_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare selected public.background_jobs%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('bling-job-claim'));
  with expired as (
    update public.background_jobs set status='failed',error_summary='lease_expired_reconciliation_required',locked_at=null,lock_id=null
    where queue='bling' and (p_order_id is null or (payload_sanitized->>'orderId'=p_order_id::text
      and job_type in ('bling.order.create','bling.order.reconcile','bling.invoice.generate','bling.invoice.send','bling.invoice.poll','bling.invoice.archive')))
      and status='running' and locked_at<now()-interval '5 minutes' and attempts>=5
    returning id,attempts
  ) insert into private.bling_job_history(job_id,attempt,outcome,error_code)
    select id,attempts,'failed','lease_expired_reconciliation_required' from expired;
  select * into selected from public.background_jobs
  where queue='bling' and (p_order_id is null or (payload_sanitized->>'orderId'=p_order_id::text
    and job_type in ('bling.order.create','bling.order.reconcile','bling.invoice.generate','bling.invoice.send','bling.invoice.poll','bling.invoice.archive'))) and (p_order_enabled or job_type<>'bling.order.create')
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

revoke all on function private.claim_bling_job(uuid,boolean,boolean,boolean,boolean,boolean,boolean,boolean,uuid) from public,anon,authenticated,service_role;

-- Preserve the existing API and its global behavior without duplicating leases.
create or replace function public.claim_bling_job(p_lock_id uuid,p_order_enabled boolean,p_invoice_enabled boolean,
  p_send_enabled boolean,p_product_enabled boolean,p_create_enabled boolean,p_stock_enabled boolean,p_email_enabled boolean)
returns jsonb language sql security definer set search_path='' as $$
  select private.claim_bling_job(p_lock_id,p_order_enabled,p_invoice_enabled,p_send_enabled,
    p_product_enabled,p_create_enabled,p_stock_enabled,p_email_enabled,null);
$$;

-- Same flags and lock discipline; a null target never falls back to the whole queue.
create function public.claim_bling_order_job(p_lock_id uuid,p_order_enabled boolean,p_invoice_enabled boolean,
  p_send_enabled boolean,p_product_enabled boolean,p_create_enabled boolean,p_stock_enabled boolean,p_email_enabled boolean,p_order_id uuid)
returns jsonb language sql security definer set search_path='' as $$
  select case when p_order_id is null then null else private.claim_bling_job(p_lock_id,
    p_order_enabled,p_invoice_enabled,p_send_enabled,p_product_enabled,p_create_enabled,p_stock_enabled,p_email_enabled,p_order_id) end;
$$;
revoke all on function public.claim_bling_order_job(uuid,boolean,boolean,boolean,boolean,boolean,boolean,boolean,uuid) from public,anon,authenticated;
grant execute on function public.claim_bling_order_job(uuid,boolean,boolean,boolean,boolean,boolean,boolean,boolean,uuid) to service_role;
notify pgrst, 'reload schema';

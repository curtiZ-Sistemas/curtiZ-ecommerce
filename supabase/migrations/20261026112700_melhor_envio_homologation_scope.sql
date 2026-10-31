-- A scoped sandbox runner must not claim or repair another shipment's jobs.
-- No flags, commercial data, grants to browsers, or fiscal clearances are seeded.
create function private.claim_melhor_envio_fulfillment_job(p_lock_id uuid,p_purchase_enabled boolean,
  p_generation_enabled boolean,p_shipment_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare selected public.background_jobs%rowtype;
begin
  if p_lock_id is null then raise exception 'lock_required' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('shipping-account-claim'));
  update public.shipments s set operation_state='reconciliation_required',last_error_code='lease_expired_reconciliation_required'
    where (p_shipment_id is null or s.id=p_shipment_id)
      and s.operation_state in ('creating','purchasing','generating','cancelling') and exists(
      select 1 from public.background_jobs j where j.queue='shipping' and j.status='running'
        and j.locked_at<now()-interval '5 minutes' and j.payload_sanitized->>'shipmentId'=s.id::text);
  update public.background_jobs set status='failed',error_summary='lease_expired_reconciliation_required',lock_id=null,locked_at=null
    where queue='shipping' and status='running' and locked_at<now()-interval '5 minutes'
      and (p_shipment_id is null or payload_sanitized->>'shipmentId'=p_shipment_id::text);
  -- Keep account-wide serialization, even when a different shipment owns the lease.
  if exists(select 1 from public.background_jobs where queue='shipping' and status='running') then return null; end if;
  select * into selected from public.background_jobs
    where queue='shipping' and job_type in ('melhorenvio.create','melhorenvio.purchase','melhorenvio.generate','melhorenvio.sync','melhorenvio.cancel')
      and (p_shipment_id is null or (payload_sanitized->>'shipmentId'=p_shipment_id::text and job_type<>'melhorenvio.cancel'))
      and (job_type<>'melhorenvio.purchase' or p_purchase_enabled is true)
      and (job_type<>'melhorenvio.generate' or p_generation_enabled is true)
      and status='pending' and available_at<=now()
    order by available_at,id for update skip locked limit 1;
  if selected.id is null then return null; end if;
  update public.background_jobs set status='running',attempts=attempts+1,locked_at=now(),lock_id=p_lock_id,error_summary=null where id=selected.id;
  return jsonb_build_object('id',selected.id,'jobType',selected.job_type,'payload',selected.payload_sanitized);
end;
$$;
revoke all on function private.claim_melhor_envio_fulfillment_job(uuid,boolean,boolean,uuid) from public,anon,authenticated,service_role;

create or replace function public.claim_melhor_envio_fulfillment_job(p_lock_id uuid,p_purchase_enabled boolean default false,
  p_generation_enabled boolean default false) returns jsonb
language sql security definer set search_path='' as $$
  select private.claim_melhor_envio_fulfillment_job(p_lock_id,p_purchase_enabled,p_generation_enabled,null)
$$;
revoke all on function public.claim_melhor_envio_fulfillment_job(uuid,boolean,boolean) from public,anon,authenticated;
grant execute on function public.claim_melhor_envio_fulfillment_job(uuid,boolean,boolean) to service_role;

create function public.claim_melhor_envio_shipment_job(p_shipment_id uuid,p_lock_id uuid,
  p_purchase_enabled boolean default false,p_generation_enabled boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if p_shipment_id is null then raise exception 'shipment_scope_required' using errcode='22023'; end if;
  return private.claim_melhor_envio_fulfillment_job(p_lock_id,p_purchase_enabled,p_generation_enabled,p_shipment_id);
end;
$$;
revoke all on function public.claim_melhor_envio_shipment_job(uuid,uuid,boolean,boolean) from public,anon,authenticated;
grant execute on function public.claim_melhor_envio_shipment_job(uuid,uuid,boolean,boolean) to service_role;

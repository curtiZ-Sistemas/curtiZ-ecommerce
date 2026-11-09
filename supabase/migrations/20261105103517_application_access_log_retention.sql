-- Minimal application access records. No URL, query, cookie, account ID or request body.
create table private.application_access_logs (
  id uuid primary key,
  application text not null check (application in ('store','panel')),
  ip_address inet not null check (masklen(ip_address) = case family(ip_address) when 4 then 32 else 128 end),
  occurred_at timestamptz not null check (isfinite(occurred_at)),
  retention_until timestamptz not null,
  legal_hold_until timestamptz,
  constraint access_log_minimum_retention check (
    retention_until >= ((occurred_at at time zone 'UTC') + interval '6 months') at time zone 'UTC'
  )
);
create index application_access_logs_expiry_idx on private.application_access_logs(retention_until);
alter table private.application_access_logs enable row level security;
alter table private.application_access_logs force row level security;
revoke all on private.application_access_logs from public,anon,authenticated,service_role;

create function public.record_application_access(
  p_record_id uuid,p_application text,p_ip_address inet,p_occurred_at timestamptz
) returns void language plpgsql security definer set search_path='' set timezone='UTC' as $$
begin
  if p_record_id is null or p_application is null or p_application not in ('store','panel')
    or p_ip_address is null or masklen(p_ip_address) <> case family(p_ip_address) when 4 then 32 else 128 end
    or p_occurred_at is null or not isfinite(p_occurred_at)
    or p_occurred_at < clock_timestamp()-interval '15 minutes'
    or p_occurred_at > clock_timestamp()+interval '1 minute' then
    raise exception 'invalid application access record' using errcode='22023';
  end if;
  insert into private.application_access_logs(id,application,ip_address,occurred_at,retention_until)
    values(p_record_id,p_application,p_ip_address,p_occurred_at,p_occurred_at+interval '6 months')
    on conflict(id) do nothing;
  if not found and not exists(select 1 from private.application_access_logs
    where id=p_record_id and application=p_application and ip_address=p_ip_address and occurred_at=p_occurred_at) then
    raise exception 'conflicting application access record' using errcode='22023';
  end if;
end $$;

create function public.purge_expired_application_access_logs(p_batch_size integer default 5000)
returns integer language plpgsql security definer set search_path='' as $$
declare v_deleted integer; v_now timestamptz:=clock_timestamp();
begin
  if p_batch_size is null or p_batch_size<1 or p_batch_size>5000 then
    raise exception 'invalid retention batch size' using errcode='22023';
  end if;
  delete from private.application_access_logs where id in (
    select id from private.application_access_logs
    where retention_until<=v_now and (legal_hold_until is null or legal_hold_until<=v_now)
    order by retention_until limit p_batch_size for update skip locked
  );
  get diagnostics v_deleted=row_count;
  return v_deleted;
end $$;

revoke all on function public.record_application_access(uuid,text,inet,timestamptz),
  public.purge_expired_application_access_logs(integer) from public,anon,authenticated;
grant execute on function public.record_application_access(uuid,text,inet,timestamptz),
  public.purge_expired_application_access_logs(integer) to service_role;

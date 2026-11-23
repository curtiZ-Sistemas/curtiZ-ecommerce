-- Definitions only: this migration does not delete any existing data.
-- The Worker must be explicitly enabled after approval of the retention cleanup.
create index if not exists session_interest_expiration_idx
  on public.session_interest_profiles(expires_at, session_id);
create index if not exists intelligence_rate_expiration_idx
  on private.intelligence_rate_buckets(window_start, session_id);

create function public.purge_expired_intelligence_data(p_batch_size integer default 500)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  batch_size integer := greatest(1, least(coalesce(p_batch_size, 500), 1000));
  retention_days integer;
  event_count integer;
  profile_count integer;
  rate_count integer;
begin
  select greatest(7, least(coalesce((
    select (value #>> '{}')::integer from public.system_settings
    where key = 'intelligence_event_retention_days'
  ), 30), 180)) into retention_days;

  with expired as (
    select id from public.marketing_events
    where occurred_at < now() - make_interval(days => retention_days)
      and order_id is null -- Preserve commercial attribution and financial evidence.
    order by occurred_at, id limit batch_size for update skip locked
  ), removed as (
    delete from public.marketing_events event using expired
    where event.id = expired.id returning 1
  ) select count(*) into event_count from removed;

  with expired as (
    select session_id from public.session_interest_profiles
    where expires_at < now()
    order by expires_at, session_id limit batch_size for update skip locked
  ), removed as (
    delete from public.session_interest_profiles profile using expired
    where profile.session_id = expired.session_id returning 1
  ) select count(*) into profile_count from removed;

  with expired as (
    select session_id, window_start from private.intelligence_rate_buckets
    where window_start < now() - interval '1 day'
    order by window_start, session_id limit batch_size for update skip locked
  ), removed as (
    delete from private.intelligence_rate_buckets bucket using expired
    where bucket.session_id = expired.session_id and bucket.window_start = expired.window_start
    returning 1
  ) select count(*) into rate_count from removed;

  return jsonb_build_object('events', event_count, 'profiles', profile_count, 'rateBuckets', rate_count);
end;
$$;

revoke all on function public.purge_expired_intelligence_data(integer) from public, anon, authenticated;
grant execute on function public.purge_expired_intelligence_data(integer) to service_role;

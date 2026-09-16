-- Keep authentication throttling account-scoped and distinguish denial from infrastructure failure.
create function public.consume_auth_rate_limit(
  p_scope text,
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  bucket timestamptz;
  window_end timestamptz;
  current_attempts integer;
  retry_after integer;
begin
  if p_scope not in ('login', 'signup', 'password_reset', 'privacy_request')
    or p_key_hash is null or p_key_hash !~ '^[a-f0-9]{64}$'
    or p_limit not between 1 and 100
    or p_window_seconds not between 10 and 86400 then
    raise exception 'invalid rate limit parameters' using errcode = '22023';
  end if;

  bucket := pg_catalog.to_timestamp(
    pg_catalog.floor(
      extract(epoch from pg_catalog.clock_timestamp()) / p_window_seconds
    ) * p_window_seconds
  );
  window_end := bucket + pg_catalog.make_interval(secs => p_window_seconds);

  insert into private.auth_rate_limits(scope,key_hash,window_started_at,attempts,updated_at)
    values(p_scope,p_key_hash,bucket,1,pg_catalog.clock_timestamp())
  on conflict(scope,key_hash,window_started_at) do update
    set attempts=private.auth_rate_limits.attempts+1,
      updated_at=pg_catalog.clock_timestamp()
  returning attempts into current_attempts;

  if current_attempts <= p_limit then
    return pg_catalog.jsonb_build_object(
      'status','allowed',
      'remaining',p_limit-current_attempts
    );
  end if;

  retry_after := greatest(1,pg_catalog.ceil(
    extract(epoch from window_end-pg_catalog.clock_timestamp())
  )::integer);
  return pg_catalog.jsonb_build_object(
    'status','blocked',
    'retryAfterSeconds',retry_after
  );
end;
$$;

revoke all on function public.consume_auth_rate_limit(text,text,integer,integer)
  from public,anon,authenticated;
grant execute on function public.consume_auth_rate_limit(text,text,integer,integer)
  to service_role;

create function public.auth_rate_limit_contract_version()
returns integer
language sql
immutable
set search_path = ''
as $$ select 2 $$;
revoke all on function public.auth_rate_limit_contract_version() from public;
grant execute on function public.auth_rate_limit_contract_version() to anon,authenticated,service_role;

notify pgrst, 'reload schema';

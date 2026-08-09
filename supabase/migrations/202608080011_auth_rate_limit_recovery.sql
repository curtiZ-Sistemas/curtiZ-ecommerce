-- Alinha a recuperação de senha aos escopos aceitos pelo rate limit persistente.

alter table private.auth_rate_limits
  drop constraint if exists auth_rate_limits_scope_check;

alter table private.auth_rate_limits
  add constraint auth_rate_limits_scope_check
  check (scope in ('login', 'signup', 'password_reset'));

create or replace function public.enforce_auth_rate_limit(
  p_scope text,
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  bucket timestamptz;
  current_attempts integer;
begin
  if p_scope not in ('login', 'signup', 'password_reset')
     or p_key_hash !~ '^[a-f0-9]{64}$'
     or p_limit not between 1 and 100
     or p_window_seconds not between 60 and 86400 then
    raise exception 'invalid rate limit parameters';
  end if;

  bucket := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  insert into private.auth_rate_limits(scope, key_hash, window_started_at, attempts, updated_at)
  values (p_scope, p_key_hash, bucket, 1, clock_timestamp())
  on conflict (scope, key_hash, window_started_at)
  do update set
    attempts = private.auth_rate_limits.attempts + 1,
    updated_at = clock_timestamp()
  returning attempts into current_attempts;

  return current_attempts <= p_limit;
end;
$$;

revoke all on function public.enforce_auth_rate_limit(text, text, integer, integer) from public;
grant execute on function public.enforce_auth_rate_limit(text, text, integer, integer)
  to anon, authenticated;

-- Corrige falhas de runtime no rate limit de autenticacao e no consentimento
-- de cookies sem remover os controles de seguranca existentes.

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
  if p_scope not in ('login', 'signup', 'password_reset', 'privacy_request')
    or p_key_hash !~ '^[a-f0-9]{64}$'
    or p_limit < 1
    or p_limit > 100
    or p_window_seconds < 10
    or p_window_seconds > 86400 then
    raise exception 'invalid rate limit parameters';
  end if;

  delete from private.auth_rate_limits
  where updated_at < pg_catalog.now() - interval '2 days';

  bucket := pg_catalog.to_timestamp(
    pg_catalog.floor(
      extract(epoch from pg_catalog.clock_timestamp()) / p_window_seconds
    ) * p_window_seconds
  );

  insert into private.auth_rate_limits(
    scope,
    key_hash,
    window_started_at,
    attempts,
    updated_at
  )
  values (p_scope, p_key_hash, bucket, 1, pg_catalog.clock_timestamp())
  on conflict (scope, key_hash, window_started_at)
  do update set
    attempts = private.auth_rate_limits.attempts + 1,
    updated_at = pg_catalog.clock_timestamp()
  returning attempts into current_attempts;

  return current_attempts <= p_limit;
end;
$$;

revoke all on function public.enforce_auth_rate_limit(text, text, integer, integer)
  from public;
grant execute on function public.enforce_auth_rate_limit(text, text, integer, integer)
  to anon, authenticated;

create or replace function public.record_cookie_consent(
  p_id uuid,
  p_policy_version text,
  p_categories jsonb,
  p_origin text,
  p_revoked boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  category_count integer;
begin
  if pg_catalog.jsonb_typeof(p_categories) <> 'object' then
    raise exception 'invalid cookie consent';
  end if;

  select pg_catalog.count(*)
  into category_count
  from pg_catalog.jsonb_object_keys(p_categories);

  if category_count > 8
    or pg_catalog.char_length(p_policy_version) > 40
    or p_origin not in ('banner', 'preferences', 'account') then
    raise exception 'invalid cookie consent';
  end if;

  insert into public.cookie_consents(
    id,
    user_id,
    policy_version,
    categories,
    origin,
    revoked
  )
  values (p_id, auth.uid(), p_policy_version, p_categories, p_origin, p_revoked)
  on conflict (id) do update set
    user_id = pg_catalog.coalesce(public.cookie_consents.user_id, auth.uid()),
    policy_version = excluded.policy_version,
    categories = excluded.categories,
    origin = excluded.origin,
    revoked = excluded.revoked,
    updated_at = pg_catalog.now();
end;
$$;

revoke all on function public.record_cookie_consent(uuid, text, jsonb, text, boolean)
  from public;
grant execute on function public.record_cookie_consent(uuid, text, jsonb, text, boolean)
  to anon, authenticated;

notify pgrst, 'reload schema';

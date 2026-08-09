-- Corrige a qualificacao de COALESCE na persistencia de consentimentos.

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
    user_id = coalesce(public.cookie_consents.user_id, auth.uid()),
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

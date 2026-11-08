-- Consent records are immutable: a caller must not overwrite another user's record
-- merely by knowing its identifier. Each preference change creates a new record.
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

  select pg_catalog.count(*) into category_count
  from pg_catalog.jsonb_object_keys(p_categories);

  if category_count > 8
    or pg_catalog.char_length(p_policy_version) > 40
    or p_origin not in ('banner', 'preferences', 'account') then
    raise exception 'invalid cookie consent';
  end if;

  insert into public.cookie_consents(id, user_id, policy_version, categories, origin, revoked)
  values (p_id, auth.uid(), p_policy_version, p_categories, p_origin, p_revoked)
  on conflict (id) do nothing;

  -- A retry with the same payload and owner is harmless and must be idempotent.
  if not found and not exists (
    select 1 from public.cookie_consents c
    where c.id = p_id
      and c.user_id is not distinct from auth.uid()
      and c.policy_version = p_policy_version
      and c.categories = p_categories
      and c.origin = p_origin
      and c.revoked = p_revoked
  ) then
    raise exception 'cookie consent identifier already used' using errcode = '23505';
  end if;
end;
$$;

notify pgrst, 'reload schema';

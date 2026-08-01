create table public.referral_attributions (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  sponsor_representative_id uuid not null references public.representatives(id) on delete restrict,
  referral_code text not null,
  claimed_at timestamptz not null default now(),
  converted_representative_id uuid unique references public.representatives(id) on delete set null,
  converted_at timestamptz,
  check ((converted_representative_id is null) = (converted_at is null))
);

alter table public.referral_attributions enable row level security;
alter table public.referral_attributions force row level security;

create policy "referral attribution owner read"
on public.referral_attributions for select to authenticated
using (user_id = auth.uid() or private.has_permission('representatives.network.manage'));

revoke insert, update, delete, truncate on public.referral_attributions from anon, authenticated;

create or replace function public.is_valid_referral_code(p_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.representatives
    where referral_code = upper(trim(p_code)) and status = 'active'
  );
$$;

create or replace function private.convert_referral_attribution(p_representative_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  attribution public.referral_attributions%rowtype;
begin
  select * into attribution
  from public.referral_attributions
  where user_id = (select user_id from public.representatives where id = p_representative_id)
  for update;
  if attribution.user_id is null then return; end if;
  if attribution.sponsor_representative_id = p_representative_id then
    raise exception 'self referral is forbidden' using errcode = '23514';
  end if;
  insert into public.referral_relationships(representative_id, sponsor_id, effective_from)
  values(p_representative_id, attribution.sponsor_representative_id, now())
  on conflict(representative_id) do nothing;
  update public.referral_attributions
  set converted_representative_id = p_representative_id, converted_at = now()
  where user_id = attribution.user_id and converted_representative_id is null;
  perform private.rebuild_representative_network_closure();
end;
$$;

create or replace function private.convert_referral_attribution_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.convert_referral_attribution(new.id);
  return new;
end;
$$;

create trigger convert_referral_attribution
after insert on public.representatives
for each row execute function private.convert_referral_attribution_trigger();

create or replace function public.claim_referral_attribution(p_code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  sponsor public.representatives%rowtype;
  existing public.referral_attributions%rowtype;
  own_representative_id uuid;
begin
  if auth.uid() is null or not private.is_active_user() then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  select * into sponsor from public.representatives
  where referral_code = upper(trim(p_code)) and status = 'active';
  if sponsor.id is null then
    raise exception 'invalid referral code' using errcode = '22023';
  end if;
  if sponsor.user_id = auth.uid() then
    raise exception 'self referral is forbidden' using errcode = '23514';
  end if;
  select * into existing from public.referral_attributions where user_id = auth.uid() for update;
  if existing.user_id is not null and existing.sponsor_representative_id <> sponsor.id then
    raise exception 'referral attribution is immutable' using errcode = '23514';
  end if;
  insert into public.referral_attributions(user_id, sponsor_representative_id, referral_code)
  values(auth.uid(), sponsor.id, sponsor.referral_code)
  on conflict(user_id) do nothing;
  select id into own_representative_id from public.representatives where user_id = auth.uid();
  if own_representative_id is not null then
    perform private.convert_referral_attribution(own_representative_id);
  end if;
  return true;
end;
$$;

revoke all on function public.is_valid_referral_code(text) from public;
grant execute on function public.is_valid_referral_code(text) to anon, authenticated;
revoke all on function public.claim_referral_attribution(text) from public, anon;
grant execute on function public.claim_referral_attribution(text) to authenticated;

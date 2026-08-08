-- Gestão segura de banners e histórico de moderação de avaliações.

alter type public.product_status add value if not exists 'pending_review';
alter type public.product_status add value if not exists 'inactive';
alter type public.product_status add value if not exists 'out_of_stock';
alter type public.product_status add value if not exists 'rejected';

alter table public.products
  add column if not exists status_reason text,
  add column if not exists published_at timestamptz,
  add column if not exists published_by uuid references public.profiles(id);

alter table public.banners
  add column if not exists internal_title text,
  add column if not exists description text,
  add column if not exists alt_text text,
  add column if not exists button_text text,
  add column if not exists destination_type text not null default 'internal_page',
  add column if not exists destination_id uuid,
  add column if not exists open_new_tab boolean not null default false,
  add column if not exists overlay_color text,
  add column if not exists content_alignment text not null default 'center',
  add column if not exists priority integer not null default 0;

update public.banners
set
  internal_title = coalesce(nullif(trim(internal_title), ''), title),
  alt_text = coalesce(nullif(trim(alt_text), ''), title)
where internal_title is null or alt_text is null;

alter table public.banners
  alter column internal_title set not null,
  alter column alt_text set not null;

alter table public.banners drop constraint if exists banners_destination_url_check;
alter table public.banners drop constraint if exists banners_destination_type_check;
alter table public.banners drop constraint if exists banners_content_alignment_check;
alter table public.banners drop constraint if exists banners_overlay_color_check;
alter table public.banners add constraint banners_destination_url_check
  check (
    (destination_type <> 'external_url' and destination_url like '/%' and destination_url not like '//%')
    or (destination_type = 'external_url' and destination_url like 'https://%')
  );
alter table public.banners add constraint banners_destination_type_check
  check (destination_type in (
    'none', 'product', 'category', 'collection', 'institutional_page', 'guide',
    'campaign', 'internal_page', 'predefined_search', 'external_url'
  ));
alter table public.banners add constraint banners_content_alignment_check
  check (content_alignment in ('left', 'center', 'right'));
alter table public.banners add constraint banners_overlay_color_check
  check (overlay_color is null or overlay_color ~ '^#[0-9A-Fa-f]{6}$');
alter table public.banners add constraint banners_status_check
  check (status in ('draft', 'scheduled', 'published', 'inactive', 'expired', 'archived')) not valid;

create index if not exists banners_publication_idx
  on public.banners(position, status, starts_at, ends_at, priority desc, sort_order);

insert into public.system_settings(key, value, is_public)
values ('banner_external_hosts', '[]'::jsonb, false)
on conflict (key) do nothing;

create or replace function private.validate_banner_destination()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  destination_host text;
  host_allowed boolean;
begin
  if new.destination_type = 'external_url' then
    destination_host := lower(substring(new.destination_url from '^https://([^/:?#]+)'));
    select exists (
      select 1
      from public.system_settings setting,
           jsonb_array_elements_text(setting.value) configured_host
      where setting.key = 'banner_external_hosts'
        and lower(configured_host) = destination_host
    ) into host_allowed;
    if destination_host is null or not coalesce(host_allowed, false) then
      raise exception 'external banner host is not authorized' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists validate_banner_destination on public.banners;
create trigger validate_banner_destination
before insert or update of destination_type, destination_url on public.banners
for each row execute function private.validate_banner_destination();

drop policy if exists "public reads current banners" on public.banners;
create policy "public reads current banners" on public.banners
  for select to anon, authenticated using (
    status in ('published', 'scheduled')
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at > now())
  );

create or replace function private.enforce_homepage_banner_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  active_count integer;
begin
  if new.position = 'hero' and new.status in ('published', 'scheduled') then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('curtiz:homepage-banner-limit'));
    select count(*) into active_count
    from public.banners
    where position = 'hero'
      and status in ('published', 'scheduled')
      and id <> new.id
      and tstzrange(coalesce(starts_at, '-infinity'::timestamptz), coalesce(ends_at, 'infinity'::timestamptz), '[)')
          && tstzrange(coalesce(new.starts_at, '-infinity'::timestamptz), coalesce(new.ends_at, 'infinity'::timestamptz), '[)');
    if active_count >= 4 then
      raise exception 'homepage hero accepts at most four active banners';
    end if;
  end if;
  return new;
end;
$$;

drop policy if exists "banner managers upload catalog media" on storage.objects;
create policy "banner managers upload catalog media" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'catalog-public'
    and (storage.foldername(name))[1] = 'banners'
    and lower(storage.extension(name)) in ('jpg', 'jpeg', 'png', 'webp')
    and private.has_permission('banners.update')
  );

drop policy if exists "banner managers remove catalog media" on storage.objects;
create policy "banner managers remove catalog media" on storage.objects
  for delete to authenticated using (
    bucket_id = 'catalog-public'
    and (storage.foldername(name))[1] = 'banners'
    and private.has_permission('banners.update')
  );

alter table public.reviews
  add column if not exists moderation_reason text,
  add column if not exists responded_at timestamptz;

create table if not exists public.review_moderation_history (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews(id) on delete cascade,
  previous_status text not null,
  new_status text not null,
  reason text,
  brand_response_snapshot text,
  moderated_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists review_moderation_history_review_idx
  on public.review_moderation_history(review_id, created_at desc);

alter table public.review_moderation_history enable row level security;
alter table public.review_moderation_history force row level security;

create policy "review managers read moderation history" on public.review_moderation_history
  for select to authenticated using (private.has_permission('reviews.manage'));

create or replace function private.record_review_moderation_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status is distinct from new.status or old.brand_response is distinct from new.brand_response then
    insert into public.review_moderation_history(
      review_id, previous_status, new_status, reason,
      brand_response_snapshot, moderated_by
    ) values (
      new.id, old.status, new.status, new.moderation_reason,
      new.brand_response, coalesce(auth.uid(), new.moderated_by)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists record_review_moderation_history on public.reviews;
create trigger record_review_moderation_history
after update on public.reviews
for each row execute function private.record_review_moderation_history();

revoke all on table public.review_moderation_history from anon;
revoke insert, update, delete, truncate on public.review_moderation_history from anon, authenticated;
revoke all on function private.record_review_moderation_history() from public, anon, authenticated;
revoke all on function private.validate_banner_destination() from public, anon, authenticated;

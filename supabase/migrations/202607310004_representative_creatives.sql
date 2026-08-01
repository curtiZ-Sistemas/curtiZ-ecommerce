create table public.creative_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.creative_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text not null,
  status public.creative_status not null default 'draft',
  approval_mode public.approval_mode not null default 'simple',
  starts_at timestamptz,
  ends_at timestamptz,
  region_codes text[] not null default '{}',
  requires_active_representative boolean not null default true,
  requires_qualified_representative boolean not null default false,
  minimum_level_rank smallint,
  created_by uuid not null references public.profiles(id),
  published_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create table public.creative_assets (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.creative_campaigns(id) on delete set null,
  category_id uuid references public.creative_categories(id),
  title text not null,
  description text not null default '',
  asset_type text not null check (asset_type in ('image','video','caption','document','package')),
  platform text not null,
  status public.creative_status not null default 'draft',
  approval_mode public.approval_mode not null default 'simple',
  storage_path text,
  thumbnail_path text,
  caption_text text,
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes between 1 and 104857600),
  checksum_sha256 char(64),
  starts_at timestamptz,
  expires_at timestamptz,
  region_codes text[] not null default '{}',
  requires_active_representative boolean not null default true,
  requires_qualified_representative boolean not null default false,
  minimum_level_rank smallint,
  created_by uuid not null references public.profiles(id),
  published_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (storage_path is not null or caption_text is not null),
  check (expires_at is null or starts_at is null or expires_at > starts_at)
);

create table public.creative_approvals (
  id uuid primary key default gen_random_uuid(),
  creative_id uuid not null references public.creative_assets(id) on delete cascade,
  reviewer_id uuid not null references public.profiles(id),
  decision text not null check (decision in ('approve','reject','request_changes')),
  reason text not null,
  approval_order smallint not null default 1 check (approval_order in (1,2)),
  created_at timestamptz not null default now(),
  unique(creative_id, reviewer_id, approval_order)
);

create table public.creative_favorites (
  representative_id uuid not null references public.representatives(id) on delete cascade,
  creative_id uuid not null references public.creative_assets(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (representative_id, creative_id)
);

create table public.creative_usage_events (
  id uuid primary key default gen_random_uuid(),
  representative_id uuid not null references public.representatives(id) on delete cascade,
  creative_id uuid not null references public.creative_assets(id) on delete cascade,
  event_type text not null check (event_type in ('view','download','copy','favorite','unfavorite','share')),
  request_id uuid,
  context_sanitized jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.creative_packages (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.creative_campaigns(id) on delete cascade,
  name text not null,
  storage_path text not null unique,
  checksum_sha256 char(64) not null,
  size_bytes bigint not null check (size_bytes between 1 and 209715200),
  generated_at timestamptz not null default now(),
  generated_by uuid not null references public.profiles(id)
);

create index creative_assets_catalog_idx on public.creative_assets(status, starts_at, expires_at);
create index creative_assets_campaign_idx on public.creative_assets(campaign_id, status);
create index creative_usage_metrics_idx on public.creative_usage_events(creative_id, event_type, created_at desc);

create or replace function private.can_access_creative(asset public.creative_assets)
returns boolean language sql stable security definer set search_path = ''
as $$
  select private.has_permission('creatives.manage') or (
    private.user_has_role('representative')
    and asset.status = 'published'
    and (asset.starts_at is null or asset.starts_at <= now())
    and (asset.expires_at is null or asset.expires_at > now())
    and exists (
      select 1 from public.representatives r
      left join public.representative_levels l on l.id = r.current_level_id
      where r.user_id = auth.uid()
        and (not asset.requires_active_representative or r.status = 'active')
        and (asset.minimum_level_rank is null or coalesce(l.rank, 0) >= asset.minimum_level_rank)
        and (cardinality(asset.region_codes) = 0 or r.region_code = any(asset.region_codes))
        and (
          not asset.requires_qualified_representative or exists (
            select 1 from public.representative_qualifications q
            where q.representative_id = r.id and q.qualified
              and current_date between q.period_start and q.period_end
          )
        )
    )
  );
$$;

create or replace function public.transition_creative(
  p_creative_id uuid,
  p_status public.creative_status,
  p_reason text
)
returns public.creative_assets
language plpgsql security definer set search_path = ''
as $$
declare asset public.creative_assets;
declare approval_count integer;
declare next_order smallint;
begin
  if nullif(trim(p_reason), '') is null or char_length(trim(p_reason)) < 3 then
    raise exception 'transition reason required';
  end if;
  select * into asset from public.creative_assets where id = p_creative_id for update;
  if asset.id is null then raise exception 'creative not found' using errcode = 'P0002'; end if;

  if p_status = 'pending_review' then
    perform private.require_permission('creatives.manage');
    if asset.status <> 'draft' then raise exception 'invalid creative transition'; end if;
    if asset.approval_mode = 'disabled' then p_status := 'approved'; end if;
  elsif p_status in ('approved','rejected') then
    perform private.require_permission('creatives.approve');
    if asset.status <> 'pending_review' then raise exception 'invalid creative transition'; end if;
    select count(*)::integer + 1 into next_order from public.creative_approvals
      where creative_id = asset.id and decision = 'approve';
    if p_status = 'approved' then
      insert into public.creative_approvals(creative_id,reviewer_id,decision,reason,approval_order)
      values(asset.id,auth.uid(),'approve',trim(p_reason),least(next_order,2));
      select count(distinct reviewer_id)::integer into approval_count from public.creative_approvals
        where creative_id = asset.id and decision = 'approve';
      if asset.approval_mode = 'double' and approval_count < 2 then return asset; end if;
    else
      insert into public.creative_approvals(creative_id,reviewer_id,decision,reason,approval_order)
      values(asset.id,auth.uid(),'reject',trim(p_reason),1);
    end if;
  elsif p_status = 'published' then
    perform private.require_permission('creatives.publish');
    if asset.status not in ('approved','scheduled') then raise exception 'creative is not approved'; end if;
  elsif p_status = 'archived' then
    perform private.require_permission('creatives.publish');
  else
    raise exception 'unsupported creative transition';
  end if;

  update public.creative_assets set status = p_status,
    published_by = case when p_status = 'published' then auth.uid() else published_by end,
    updated_at = now()
  where id = asset.id returning * into asset;
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized,reason)
  values(auth.uid(),private.current_app_role(),'creative.transition','creative_asset',asset.id,
    jsonb_build_object('status',p_status),trim(p_reason));
  return asset;
end;
$$;

do $$ declare table_name text; begin
  foreach table_name in array array[
    'creative_categories','creative_campaigns','creative_assets','creative_approvals',
    'creative_favorites','creative_usage_events','creative_packages'
  ] loop execute format('alter table public.%I enable row level security', table_name); end loop;
end $$;

create policy "creative categories published read" on public.creative_categories for select to authenticated using (active or private.has_permission('creatives.manage'));
create policy "creative categories managers" on public.creative_categories for all to authenticated using (private.has_permission('creatives.manage')) with check (private.has_permission('creatives.manage'));
create policy "creative campaigns audience read" on public.creative_campaigns for select to authenticated using (private.has_permission('creatives.manage') or status = 'published');
create policy "creative campaigns managers" on public.creative_campaigns for all to authenticated using (private.has_permission('creatives.manage')) with check (private.has_permission('creatives.manage'));
create policy "creative audience read" on public.creative_assets for select to authenticated using (private.can_access_creative(creative_assets));
create policy "creative managers write" on public.creative_assets for all to authenticated using (private.has_permission('creatives.manage')) with check (private.has_permission('creatives.manage'));
create policy "creative approvals authorized read" on public.creative_approvals for select to authenticated using (private.has_permission('creatives.approve'));
create policy "creative approvals authorized insert" on public.creative_approvals for insert to authenticated with check (reviewer_id = auth.uid() and private.has_permission('creatives.approve'));
create policy "creative favorites owner" on public.creative_favorites for all to authenticated
using (private.owns_representative(representative_id)) with check (private.owns_representative(representative_id) and private.can_access_creative((select a from public.creative_assets a where a.id = creative_id)));
create policy "creative usage owner insert" on public.creative_usage_events for insert to authenticated
with check (private.owns_representative(representative_id) and private.can_access_creative((select a from public.creative_assets a where a.id = creative_id)));
create policy "creative metrics authorized read" on public.creative_usage_events for select to authenticated using (private.has_permission('creatives.metrics.read'));
create policy "creative packages audience read" on public.creative_packages for select to authenticated using (
  private.has_permission('creatives.manage') or exists (
    select 1 from public.creative_assets a where a.campaign_id = creative_packages.campaign_id and private.can_access_creative(a)
  )
);
create policy "creative packages manager write" on public.creative_packages for all to authenticated using (private.has_permission('creatives.manage')) with check (private.has_permission('creatives.manage'));

create trigger touch_creative_campaigns before update on public.creative_campaigns for each row execute function private.touch_updated_at();
create trigger touch_creative_assets before update on public.creative_assets for each row execute function private.touch_updated_at();

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types) values
  ('representative-creatives','representative-creatives',false,104857600,array['image/jpeg','image/png','image/webp','video/mp4','application/pdf','application/zip']),
  ('creative-thumbnails','creative-thumbnails',false,10485760,array['image/jpeg','image/png','image/webp']),
  ('campaign-packages','campaign-packages',false,209715200,array['application/zip'])
on conflict(id) do nothing;

create policy "creative managers upload assets" on storage.objects for insert to authenticated with check (
  bucket_id in ('representative-creatives','creative-thumbnails','campaign-packages')
  and private.has_permission('creatives.manage')
  and lower(storage.extension(name)) in ('jpg','jpeg','png','webp','mp4','pdf','zip')
);
create policy "creative managers maintain assets" on storage.objects for update to authenticated using (
  bucket_id in ('representative-creatives','creative-thumbnails','campaign-packages') and private.has_permission('creatives.manage')
);
create policy "creative managers remove assets" on storage.objects for delete to authenticated using (
  bucket_id in ('representative-creatives','creative-thumbnails','campaign-packages') and private.has_permission('creatives.manage')
);
create policy "creative audience reads permitted assets" on storage.objects for select to authenticated using (
  (bucket_id = 'representative-creatives' and exists (
    select 1 from public.creative_assets a where a.storage_path = name and private.can_access_creative(a)
  )) or (bucket_id = 'creative-thumbnails' and exists (
    select 1 from public.creative_assets a where a.thumbnail_path = name and private.can_access_creative(a)
  )) or (bucket_id = 'campaign-packages' and exists (
    select 1 from public.creative_packages p
    join public.creative_assets a on a.campaign_id = p.campaign_id
    where p.storage_path = name and private.can_access_creative(a)
  ))
);

grant execute on function private.can_access_creative(public.creative_assets) to authenticated;
revoke all on function public.transition_creative(uuid,public.creative_status,text) from public, anon;
grant execute on function public.transition_creative(uuid,public.creative_status,text) to authenticated;

create materialized view public.creative_usage_daily_metrics as
select date_trunc('day', created_at) as day, creative_id, event_type, count(*) as event_count
from public.creative_usage_events
group by date_trunc('day', created_at), creative_id, event_type
with no data;
create unique index creative_usage_daily_metrics_idx on public.creative_usage_daily_metrics(day, creative_id, event_type);
revoke all on public.creative_usage_daily_metrics from anon, authenticated;

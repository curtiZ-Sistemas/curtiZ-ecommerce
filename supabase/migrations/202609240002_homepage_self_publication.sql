-- The ordinary transition keeps its independent-review rule. This RPC is the
-- explicit, audited path for an authorized manager of a one-person installation.
create or replace function private.validate_homepage_publication_snapshot(p_snapshot jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare item jsonb; media_item jsonb; target_type text; target_route text; external_host text;
  starts_at timestamptz; ends_at timestamptz;
begin
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object'
    or jsonb_typeof(p_snapshot->'items') <> 'array'
    or jsonb_typeof(p_snapshot->'content') <> 'object'
    or jsonb_typeof(p_snapshot->'style') <> 'object'
    or jsonb_array_length(p_snapshot->'items') > 24 then
    raise exception 'invalid homepage snapshot';
  end if;
  perform private.validate_homepage_json(p_snapshot);
  starts_at := nullif(p_snapshot->>'startsAt', '')::timestamptz;
  ends_at := nullif(p_snapshot->>'endsAt', '')::timestamptz;
  if starts_at is not null and ends_at is not null and ends_at <= starts_at then
    raise exception 'invalid homepage schedule';
  end if;
  for item in select value from jsonb_array_elements(p_snapshot->'items') loop
    if jsonb_typeof(item) <> 'object' or jsonb_typeof(item->'media') <> 'array' then
      raise exception 'invalid homepage item';
    end if;
    perform private.validate_homepage_json(item);
    target_type := coalesce(item->>'targetType', 'none');
    target_route := coalesce(item->>'targetRoute', '');
    if target_type not in ('none', 'product', 'category', 'subcategory', 'model', 'brand',
      'collection', 'campaign', 'page', 'guide', 'search', 'offer', 'external_url') then
      raise exception 'unsupported homepage destination';
    end if;
    if target_type <> 'none' and target_route = '' then raise exception 'missing homepage destination'; end if;
    if target_route <> '' and not (
      (target_route like '/%' and target_route not like '//%'
        and target_route !~ '[[:cntrl:]]' and position(chr(92) in target_route) = 0)
      or target_route like 'https://%'
    ) then raise exception 'invalid homepage destination'; end if;
    if target_type = 'external_url' then
      external_host := lower(substring(target_route from '^https://([^/:?#]+)'));
      if external_host is null or not exists (
        select 1 from public.system_settings setting,
          jsonb_array_elements_text(setting.value) host
        where setting.key = 'homepage_external_hosts' and lower(host) = external_host
      ) then raise exception 'homepage external destination is unavailable'; end if;
    elsif target_route like 'https://%' then
      raise exception 'invalid homepage external destination type';
    end if;
    if target_type = 'product' and not exists (
      select 1 from public.products product
      where product.id = nullif(item->>'targetId', '')::uuid and product.status = 'active'
    ) then raise exception 'homepage product target is unavailable'; end if;
    if target_type in ('category', 'subcategory') and not exists (
      select 1 from public.categories category
      where category.id = nullif(item->>'targetId', '')::uuid and category.active
    ) then raise exception 'homepage category target is unavailable'; end if;
    if target_type = 'model' and not exists (
      select 1 from public.product_models model
      where model.id = nullif(item->>'targetId', '')::uuid and model.active
    ) then raise exception 'homepage model target is unavailable'; end if;
    if target_type = 'collection' and not exists (
      select 1 from public.collections collection
      where collection.id = nullif(item->>'targetId', '')::uuid and collection.active
    ) then raise exception 'homepage collection target is unavailable'; end if;
    if target_type = 'campaign' and nullif(item->>'targetId', '') is not null and not exists (
      select 1 from public.promotion_campaigns campaign
      where campaign.id = (item->>'targetId')::uuid
        and campaign.status in ('approved', 'published', 'scheduled')
    ) then raise exception 'homepage campaign target is unavailable'; end if;
    if target_type in ('page', 'guide') and nullif(item->>'targetId', '') is not null and not exists (
      select 1 from public.cms_pages page
      where page.id = (item->>'targetId')::uuid and page.status = 'published'
    ) then raise exception 'homepage page target is unavailable'; end if;
    if jsonb_array_length(item->'media') > 0 and coalesce((item->>'decorative')::boolean, false) = false
      and nullif(trim(item->>'altText'), '') is null then
      raise exception 'homepage alternative text is required';
    end if;
    for media_item in select value from jsonb_array_elements(item->'media') loop
      if coalesce(media_item->>'path', '') = ''
        or media_item->>'path' like '%..%'
        or not (media_item->>'path' like 'home-sections/%'
          or media_item->>'path' like 'home-section-images/%'
          or media_item->>'path' like 'home-section-mobile-images/%'
          or media_item->>'path' like 'home-section-videos/%'
          or media_item->>'path' like 'home-section-thumbnails/%')
        or not exists (
        select 1 from storage.objects stored
        where stored.bucket_id = 'homepage-public' and stored.name = media_item->>'path'
      ) then raise exception 'homepage media is unavailable'; end if;
    end loop;
  end loop;
exception when others then
  raise exception 'homepage section validation failed' using errcode = 'P4002';
end $$;

revoke all on function private.validate_homepage_publication_snapshot(jsonb) from public, anon, authenticated;

create or replace function public.prepare_xlsx_homepage_publication(
  p_reason text, p_expected_versions jsonb, p_self_approval_confirmed boolean default false
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare page_row public.home_pages; section_row public.homepage_sections;
  version_row public.homepage_section_versions; candidate record;
  actual_versions jsonb; page_version_id uuid;
begin
  perform private.require_permission('homepage.edit');
  if char_length(trim(coalesce(p_reason, ''))) not between 3 and 1000 then
    raise exception 'homepage publication reason is required' using errcode = 'P4002';
  end if;
  if p_expected_versions is null or jsonb_typeof(p_expected_versions) <> 'array'
    or jsonb_array_length(p_expected_versions) > 40 then
    raise exception 'homepage expected versions are invalid' using errcode = 'P4004';
  end if;
  if p_self_approval_confirmed then
    perform private.require_permission('homepage.review');
    perform private.require_permission('homepage.publish');
    if private.current_app_role() not in ('manager', 'admin') then
      raise exception 'homepage self approval is not allowed' using errcode = 'P4001';
    end if;
  end if;
  select * into page_row from public.home_pages where slug = 'principal' for update;
  if page_row.id is null then raise exception 'homepage page is unavailable' using errcode = 'P4002'; end if;
  perform section.id from public.homepage_sections section
    where section.home_page_id = page_row.id and section.internal_name like 'xlsx:%'
      and section.status in ('draft', 'rejected', 'pending_review')
    order by section.id for update;
  select coalesce(jsonb_agg(jsonb_build_object(
    'sectionId', section.id, 'versionId', section.current_version_id
  ) order by section.id), '[]'::jsonb) into actual_versions
  from public.homepage_sections section
  where section.home_page_id = page_row.id and section.internal_name like 'xlsx:%'
    and section.status in ('draft', 'rejected', 'pending_review');
  if actual_versions <> p_expected_versions then
    raise exception 'homepage sections changed since confirmation' using errcode = 'P4004';
  end if;
  for section_row in
    select section.* from public.homepage_sections section
    where section.home_page_id = page_row.id and section.internal_name like 'xlsx:%'
      and section.status in ('draft', 'rejected', 'pending_review')
    order by section.sort_order, section.id
  loop
    select * into version_row from public.homepage_section_versions version
      where version.id = section_row.current_version_id and version.section_id = section_row.id;
    if version_row.id is null or version_row.snapshot->>'id' is distinct from section_row.id::text then
      raise exception 'homepage version is invalid' using errcode = 'P4002';
    end if;
    perform private.validate_homepage_publication_snapshot(version_row.snapshot);
    if section_row.status in ('draft', 'rejected') then
      perform public.transition_homepage_section(section_row.id, 'submit_review', p_reason);
    end if;
    if p_self_approval_confirmed then
      if version_row.changed_by = auth.uid() then
        update public.homepage_sections set status = 'approved', reviewed_by = auth.uid(),
          reviewed_at = now(), status_reason = trim(p_reason) where id = section_row.id;
        update public.homepage_section_versions set status = 'approved', approved_by = auth.uid(),
          approved_at = now() where id = version_row.id;
        insert into public.home_section_approvals(section_id, version_id, reviewer_id, decision, reason)
          values(section_row.id, version_row.id, auth.uid(), 'approved', trim(p_reason));
        insert into public.home_section_audit_logs(section_id, actor_id, actor_role, action,
          previous_data, new_data, reason)
          values(section_row.id, auth.uid(), private.current_app_role(),
            'homepage.section.self_approved_for_publication',
            jsonb_build_object('status', section_row.status),
            jsonb_build_object('versionId', version_row.id, 'version', version_row.version,
              'status', 'approved'), trim(p_reason));
      else
        perform public.transition_homepage_section(section_row.id, 'approve', p_reason);
      end if;
    end if;
  end loop;
  if not p_self_approval_confirmed then return null; end if;
  -- Validate every version the existing publisher could put in its manifest.
  for candidate in
    select distinct on (version.section_id) version.id, version.snapshot
    from public.homepage_section_versions version
    join public.homepage_sections section on section.id = version.section_id
    where section.home_page_id = page_row.id and section.status not in ('hidden', 'expired', 'archived')
      and version.status in ('approved', 'published', 'scheduled')
    order by version.section_id,
      case version.status when 'approved' then 0 when 'published' then 1 else 2 end,
      version.version desc
  loop
    perform private.validate_homepage_publication_snapshot(candidate.snapshot);
  end loop;
  begin
    page_version_id := public.publish_homepage(p_reason, null);
  exception when others then
    raise exception 'homepage publication failed' using errcode = 'P4003';
  end;
  return page_version_id;
end $$;

revoke all on function public.prepare_xlsx_homepage_publication(text, jsonb, boolean) from public, anon;
grant execute on function public.prepare_xlsx_homepage_publication(text, jsonb, boolean) to authenticated;
notify pgrst, 'reload schema';

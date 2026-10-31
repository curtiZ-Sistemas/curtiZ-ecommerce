-- Publishing is authorized by homepage.publish and uses each visible section's
-- current snapshot. Review remains available for manual section workflows.
create or replace function public.publish_homepage(p_reason text, p_scheduled_at timestamptz default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare page_row public.home_pages; next_version integer; page_version_id uuid;
  manifest jsonb; candidate record;
begin
  perform private.require_permission('homepage.publish');
  if char_length(trim(coalesce(p_reason, ''))) not between 3 and 1000 then
    raise exception 'publication reason is required' using errcode = 'P4002';
  end if;
  select * into page_row from public.home_pages where slug = 'principal' for update;
  if page_row.id is null then
    raise exception 'homepage page is unavailable' using errcode = 'P4002';
  end if;

  -- Build the manifest only from rows locked and validated by this transaction.
  manifest := jsonb_build_object('sections', '[]'::jsonb);
  for candidate in
    select section.id as section_id, section.current_version_id, section.sort_order,
      version.id as version_id, version.snapshot
    from public.homepage_sections section
    left join public.homepage_section_versions version
      on version.id = section.current_version_id and version.section_id = section.id
    where section.home_page_id = page_row.id
      and section.status in ('draft', 'pending_review', 'rejected', 'approved', 'published', 'scheduled')
    order by section.id for update of section
  loop
    if candidate.version_id is null or candidate.snapshot->>'id' is distinct from candidate.section_id::text then
      raise exception 'homepage current version is invalid' using errcode = 'P4002';
    end if;
    perform private.validate_homepage_publication_snapshot(candidate.snapshot);
    manifest := jsonb_set(manifest, '{sections}', manifest->'sections' || jsonb_build_array(
      jsonb_build_object('sectionId', candidate.section_id,
        'versionId', candidate.version_id, 'position', candidate.sort_order)));
  end loop;
  if jsonb_array_length(manifest->'sections') = 0 then
    raise exception 'no publishable homepage sections' using errcode = 'P4002';
  end if;
  select jsonb_build_object('sections', jsonb_agg(entry
    order by (entry->>'position')::integer, entry->>'sectionId')) into manifest
  from jsonb_array_elements(manifest->'sections') entry;

  select coalesce(max(version), 0) + 1 into next_version
  from public.home_page_versions where home_page_id = page_row.id;
  insert into public.home_page_versions(home_page_id, version, status, manifest, reason,
    scheduled_at, published_at, created_by)
  values(page_row.id, next_version,
    case when p_scheduled_at > now() then 'scheduled' else 'published' end,
    manifest, trim(p_reason),
    case when p_scheduled_at > now() then p_scheduled_at end,
    case when p_scheduled_at is null or p_scheduled_at <= now() then now() end,
    auth.uid()) returning id into page_version_id;

  if p_scheduled_at is null or p_scheduled_at <= now() then
    update public.home_page_versions set status = 'superseded'
      where home_page_id = page_row.id and status = 'scheduled' and scheduled_at <= now();
    update public.home_page_versions set status = 'superseded'
      where home_page_id = page_row.id and status = 'published' and id <> page_version_id;
    update public.home_pages set published_version_id = page_version_id, updated_at = now()
      where id = page_row.id;
  end if;
  update public.homepage_section_versions set
    status = case when p_scheduled_at > now() then 'scheduled' else 'published' end,
    published_at = case when p_scheduled_at is null or p_scheduled_at <= now() then now()
      else published_at end
    where id in (select (entry->>'versionId')::uuid
      from jsonb_array_elements(manifest->'sections') entry);
  update public.homepage_sections set
    status = case when p_scheduled_at > now() then 'scheduled' else 'published' end,
    active = true
    where id in (select (entry->>'sectionId')::uuid
      from jsonb_array_elements(manifest->'sections') entry);
  insert into public.home_section_audit_logs(actor_id, actor_role, action, new_data, reason)
  values(auth.uid(), private.current_app_role(), 'homepage.published',
    jsonb_build_object('pageVersionId', page_version_id, 'version', next_version,
      'scheduledAt', p_scheduled_at, 'sectionVersionIds',
      (select jsonb_agg(entry->>'versionId') from jsonb_array_elements(manifest->'sections') entry)),
    trim(p_reason));
  return page_version_id;
end $$;

revoke all on function public.publish_homepage(text, timestamptz) from public, anon;
grant execute on function public.publish_homepage(text, timestamptz) to authenticated;
drop function if exists public.prepare_xlsx_homepage_publication(text, jsonb, boolean);
notify pgrst, 'reload schema';

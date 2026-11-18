-- Keep spreadsheet synchronization metadata out of the published homepage.
create or replace view public.published_homepage_sections
with (security_invoker = false) as
with selected_page_version as (
  select coalesce(
    (select scheduled.id
      from public.home_page_versions scheduled
      join public.home_pages page on page.id = scheduled.home_page_id
      where page.slug = 'principal'
        and scheduled.status = 'scheduled'
        and scheduled.scheduled_at <= now()
      order by scheduled.scheduled_at desc
      limit 1),
    (select published_version_id from public.home_pages where slug = 'principal')
  ) as id
), entries as (
  select entry
  from public.home_page_versions page_version,
    selected_page_version selected,
    jsonb_array_elements(page_version.manifest->'sections') entry
  where page_version.id = selected.id
)
select version.id as section_version_id,
  version.section_id,
  (entries.entry->>'position')::integer as position,
  jsonb_set(
    case
      when jsonb_typeof(version.snapshot->'content') = 'object' then
        (version.snapshot - 'internalName')
          #- '{content,configHash}'
          #- '{content,autoPublishAfterApproval}'
      else version.snapshot - 'internalName'
    end,
    '{items}',
    coalesce((
      select jsonb_agg(item - 'internalName' order by (item->>'sortOrder')::integer)
      from jsonb_array_elements(coalesce(version.snapshot->'items', '[]'::jsonb)) item
    ), '[]'::jsonb)
  ) as snapshot
from entries
join public.homepage_section_versions version
  on version.id = (entries.entry->>'versionId')::uuid
join public.homepage_sections section on section.id = version.section_id
where not (
    section.internal_name like 'xlsx:%'
    and (section.status in ('hidden', 'archived') or not section.active)
  )
  and (version.snapshot->>'startsAt' is null or (version.snapshot->>'startsAt')::timestamptz <= now())
  and (version.snapshot->>'endsAt' is null or (version.snapshot->>'endsAt')::timestamptz > now())
order by (entries.entry->>'position')::integer;

notify pgrst, 'reload schema';

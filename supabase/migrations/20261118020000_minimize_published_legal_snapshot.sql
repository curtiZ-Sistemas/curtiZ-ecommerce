-- Only fields intended for publication belong in the Data API projection.
create or replace view public.published_legal_documents
with (security_barrier = true) as
select distinct on (document.id)
  document.id as document_id,
  coalesce(version.snapshot #>> '{document,slug}',document.slug) as slug,
  coalesce(version.snapshot #>> '{document,public_title}',document.public_title) as public_title,
  coalesce(version.snapshot #>> '{document,summary}',document.summary) as summary,
  coalesce(version.snapshot #>> '{document,document_type}',document.document_type) as document_type,
  coalesce(version.snapshot #>> '{document,language}',document.language) as language,
  version.id as version_id, version.version,
  jsonb_build_object(
    'document', coalesce((
      select jsonb_object_agg(field.key, field.value)
      from jsonb_each(case when jsonb_typeof(version.snapshot->'document') = 'object'
        then version.snapshot->'document' else '{}'::jsonb end) as field(key,value)
      where field.key in ('slug', 'public_title', 'summary', 'document_type', 'language', 'audience', 'requires_acceptance', 'requires_new_acceptance', 'display_locations')
    ), '{}'::jsonb),
    'sections', coalesce((
      select jsonb_agg(projected.item order by entry.position)
      from jsonb_array_elements(case when jsonb_typeof(version.snapshot->'sections') = 'array'
        then version.snapshot->'sections' else '[]'::jsonb end) with ordinality as entry(value,position)
      cross join lateral (
        select coalesce((
          select jsonb_object_agg(field.key, field.value)
          from jsonb_each(case when jsonb_typeof(entry.value) = 'object'
            then entry.value else '{}'::jsonb end) as field(key,value)
          where field.key in ('section_number', 'title', 'content', 'content_format', 'sort_order')
        ), '{}'::jsonb) as item
      ) projected
    ), '[]'::jsonb),
    'references', coalesce((
      select jsonb_agg(projected.item order by entry.position)
      from jsonb_array_elements(case when jsonb_typeof(version.snapshot->'references') = 'array'
        then version.snapshot->'references' else '[]'::jsonb end) with ordinality as entry(value,position)
      cross join lateral (
        select coalesce((
          select jsonb_object_agg(field.key, field.value)
          from jsonb_each(case when jsonb_typeof(entry.value) = 'object'
            then entry.value else '{}'::jsonb end) as field(key,value)
          where field.key in ('name', 'related_article', 'official_url', 'consulted_on')
        ), '{}'::jsonb) as item
      ) projected
    ), '[]'::jsonb),
    'company', coalesce((
      select jsonb_object_agg(field.key, field.value)
      from jsonb_each(case when jsonb_typeof(version.snapshot->'company') = 'object'
        then version.snapshot->'company' else '{}'::jsonb end) as field(key,value)
      where field.key in ('legal_name', 'trade_name', 'tax_id', 'address', 'email', 'phone', 'privacy_channel', 'data_protection_contact', 'support_channel')
    ), '{}'::jsonb)
  ) as snapshot,
  version.effective_from, version.effective_until, version.published_at
from public.legal_documents document
join public.legal_document_versions version on version.document_id = document.id
where document.public_visible
  and version.effective_from <= now()
  and (version.effective_until is null or version.effective_until > now())
order by document.id, version.version desc;

notify pgrst, 'reload schema';

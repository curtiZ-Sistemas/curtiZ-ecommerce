-- Keep the public projection and its privileges; apply expiry to both publication paths.
-- Underlying drafts and version snapshots remain protected by their existing RLS.
create or replace view public.published_help_contents with (security_barrier=true) as
select content.id,version.snapshot#>>'{content,slug}' slug,version.snapshot#>>'{content,content_type}' content_type,
  coalesce((version.snapshot#>>'{content,priority}')::integer,0) priority,
  content.views_count,content.helpful_count,content.unhelpful_count,
  version.version,version.created_at as version_created_at,
  jsonb_build_object(
    'content',(version.snapshot->'content') - 'category_id' - 'author_id' - 'reviewer_id' - 'attachments' - 'created_at' - 'updated_at',
    'category',version.snapshot->'category','related',version.snapshot->'related'
  ) snapshot,
  version.snapshot#>>'{category,name}' as category_name,version.snapshot#>>'{category,slug}' as category_slug
from public.help_contents content
join public.help_content_versions version on version.id=case
  when content.scheduled_version_id is not null and content.scheduled_at<=now() then content.scheduled_version_id
  else content.published_version_id end
where (content.published_version_id is not null
  or (content.scheduled_version_id is not null and content.scheduled_at<=now()))
  and (content.expires_at is null or content.expires_at>now());

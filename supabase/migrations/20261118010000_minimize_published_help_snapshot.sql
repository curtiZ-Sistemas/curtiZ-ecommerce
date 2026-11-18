-- Keep editorial metadata out of the published help projection.
create or replace view public.published_help_contents with (security_barrier=true) as
select content.id,version.snapshot#>>'{content,slug}' slug,version.snapshot#>>'{content,content_type}' content_type,
  coalesce((version.snapshot#>>'{content,priority}')::integer,0) priority,
  content.views_count,content.helpful_count,content.unhelpful_count,
  version.version,version.created_at as version_created_at,
  jsonb_build_object(
    'content',coalesce((
      select jsonb_object_agg(field.key, field.value)
      from jsonb_each(case when jsonb_typeof(version.snapshot->'content') = 'object'
        then version.snapshot->'content' else '{}'::jsonb end) as field(key,value)
      where field.key in ('slug','content_type','title','summary','body','keywords','synonyms',
        'audiences','priority','related_action','media')
    ), '{}'::jsonb),
    'category',jsonb_build_object('name',version.snapshot#>'{category,name}','slug',version.snapshot#>'{category,slug}'),
    'related',coalesce((
      select jsonb_agg(jsonb_build_object('slug',related.entry->'slug','title',related.entry->'title') order by related.position)
      from jsonb_array_elements(
        case when jsonb_typeof(version.snapshot->'related') = 'array'
          then version.snapshot->'related' else '[]'::jsonb end
      ) with ordinality as related(entry,position)
      join public.help_contents target on target.slug = related.entry->>'slug'
      join public.support_categories target_category on target_category.id = target.category_id
      join public.help_content_versions target_version on target_version.id = case
        when target.scheduled_version_id is not null and target.scheduled_at <= now() then target.scheduled_version_id
        else target.published_version_id end
      where (target.published_version_id is not null
          or (target.scheduled_version_id is not null and target.scheduled_at <= now()))
        and (target.expires_at is null or target.expires_at > now())
        and private.help_audience_allowed(target_version.snapshot#>'{content,audiences}', target_category.active and target_category.public_visible)
    ), '[]'::jsonb)
  ) snapshot,
  version.snapshot#>>'{category,name}' as category_name,version.snapshot#>>'{category,slug}' as category_slug
from public.help_contents content
join public.support_categories category on category.id = content.category_id
join public.help_content_versions version on version.id=case
  when content.scheduled_version_id is not null and content.scheduled_at<=now() then content.scheduled_version_id
  else content.published_version_id end
where (content.published_version_id is not null
    or (content.scheduled_version_id is not null and content.scheduled_at<=now()))
  and (content.expires_at is null or content.expires_at>now())
  and private.help_audience_allowed(version.snapshot#>'{content,audiences}', category.active and category.public_visible);

notify pgrst, 'reload schema';

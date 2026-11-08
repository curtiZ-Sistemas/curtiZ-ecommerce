-- Published help may target staff or specific authenticated audiences. A
-- public view and its search RPC must not trust an audience supplied by callers.
create or replace function private.help_audience_allowed(p_audiences jsonb, p_category_public boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_typeof(p_audiences) = 'array', false) and (
    (coalesce(p_category_public, false) and p_audiences ? 'visitor')
    or current_setting('role', true) = 'service_role'
    or auth.jwt()->>'role' = 'service_role'
    or (
      auth.uid() is not null
      and coalesce(auth.jwt()->>'is_anonymous', 'false') <> 'true'
      and private.is_active_user()
      and not private.customer_account_is_closed()
      and (
        (coalesce(p_category_public, false) and p_audiences ? 'customer')
        or exists (
          select 1 from public.user_roles ur
          where ur.user_id = auth.uid()
            and p_audiences ? ur.role::text
            and (
              (ur.role::text in ('customer', 'representative') and coalesce(p_category_public, false))
              or (ur.role::text not in ('customer', 'representative') and private.internal_mfa_satisfied())
            )
        )
      )
    )
  );
$$;

revoke all on function private.help_audience_allowed(jsonb, boolean) from public;
grant execute on function private.help_audience_allowed(jsonb, boolean) to anon, authenticated, service_role;

create or replace view public.published_help_contents with (security_barrier=true) as
select content.id,version.snapshot#>>'{content,slug}' slug,version.snapshot#>>'{content,content_type}' content_type,
  coalesce((version.snapshot#>>'{content,priority}')::integer,0) priority,
  content.views_count,content.helpful_count,content.unhelpful_count,
  version.version,version.created_at as version_created_at,
  jsonb_build_object(
    'content',(version.snapshot->'content') - 'category_id' - 'author_id' - 'reviewer_id' - 'attachments' - 'created_at' - 'updated_at',
    'category',version.snapshot->'category',
    'related',coalesce((
      select jsonb_agg(related.entry order by related.position)
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

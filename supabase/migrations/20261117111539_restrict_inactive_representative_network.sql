create or replace function public.get_representative_network(
  p_search text default null,
  p_status public.representative_status default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table(
  representative_id uuid,
  public_code text,
  display_name text,
  status public.representative_status,
  level_name text,
  depth integer,
  joined_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    member.id,
    member.public_code,
    profile.full_name,
    member.status,
    level.name,
    closure.depth,
    member.created_at
  from public.representatives owner
  join public.representative_network_closure closure
    on closure.ancestor_id = owner.id and closure.depth > 0
  join public.representatives member on member.id = closure.descendant_id
  join public.profiles profile on profile.id = member.user_id
  left join public.representative_levels level on level.id = member.current_level_id
  where owner.user_id = auth.uid()
    and private.is_active_user()
    and not private.customer_account_is_closed()
    and owner.status in ('active', 'unqualified', 'approved_waiting_kit')
    and (p_status is null or member.status = p_status)
    and (
      nullif(trim(p_search), '') is null
      or member.public_code ilike '%' || trim(p_search) || '%'
      or profile.full_name ilike '%' || trim(p_search) || '%'
    )
  order by closure.depth, profile.full_name
  limit least(greatest(p_limit, 1), 50)
  offset greatest(p_offset, 0);
$$;


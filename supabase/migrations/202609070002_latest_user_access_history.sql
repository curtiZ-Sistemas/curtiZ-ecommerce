create index audit_latest_user_access_idx on public.audit_logs(entity_id, created_at desc, id desc)
where entity_type = 'profiles' and action in ('update_access','permission_override','user_access.changed');

create or replace function public.latest_user_access_history(p_user_ids uuid[])
returns table(entity_id uuid, action text, reason text, created_at timestamptz)
language plpgsql stable security invoker set search_path = ''
as $$
begin
  if not private.has_permission('users.read') or not private.has_permission('audit.read') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if cardinality(p_user_ids) > 20 then
    raise exception 'at most 20 users per request' using errcode = '22023';
  end if;
  return query
    select latest.entity_id, latest.action, latest.reason, latest.created_at
    from (select distinct unnest(p_user_ids) as id) requested
    cross join lateral (
      select a.entity_id, a.action, a.reason, a.created_at
      from public.audit_logs a
      where a.entity_id = requested.id and a.entity_type = 'profiles'
        and a.action in ('update_access','permission_override','user_access.changed')
      order by a.created_at desc, a.id desc limit 1
    ) latest;
end;
$$;
revoke all on function public.latest_user_access_history(uuid[]) from public, anon;
grant execute on function public.latest_user_access_history(uuid[]) to authenticated;

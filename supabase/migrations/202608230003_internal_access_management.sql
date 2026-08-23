-- Gestão multiacesso com separação explícita entre Gerência e Técnico.

insert into public.permissions(code, description) values
  ('users.access.manage_client', 'Adicionar ou remover acesso de cliente'),
  ('users.access.manage_admin', 'Adicionar ou remover acesso administrativo'),
  ('users.access.manage_operator', 'Adicionar ou remover acesso operacional'),
  ('users.access.manage_technical', 'Adicionar ou remover acesso técnico')
on conflict (code) do update set description = excluded.description;

insert into public.role_permissions(role, permission_id)
select 'manager', id from public.permissions
where code in (
  'users.read',
  'users.access.manage_client',
  'users.access.manage_admin',
  'users.access.manage_operator'
)
on conflict do nothing;

insert into public.role_permissions(role, permission_id)
select 'technical', id from public.permissions
where code in ('users.read', 'users.access.manage_technical')
on conflict do nothing;

-- Administrador não gerencia acessos apenas por ser administrador.
delete from public.role_permissions role_permission
using public.permissions permission
where role_permission.permission_id = permission.id
  and role_permission.role = 'admin'
  and permission.code in ('users.manage', 'users.roles.manage');

-- A RPC anterior tinha contrato de papel único e não deve permanecer como bypass.
revoke all on function public.admin_update_user_access(
  uuid, public.user_status, public.app_role, text
) from authenticated;

create or replace function public.manage_user_access(
  p_user_id uuid,
  p_status public.user_status,
  p_roles public.app_role[],
  p_reason text,
  p_expected_updated_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_roles public.app_role[];
  current_roles public.app_role[];
  desired_roles public.app_role[];
  resulting_roles public.app_role[];
  current_status public.user_status;
  current_updated_at timestamptz;
  role_name public.app_role;
  can_manage_role boolean;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'self access changes are not allowed' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(p_reason, ''))) < 10 then
    raise exception 'a reason with at least ten characters is required';
  end if;

  select coalesce(array_agg(role order by role), '{}'::public.app_role[])
    into actor_roles
  from public.user_roles
  where user_id = auth.uid();

  if not ('manager'::public.app_role = any(actor_roles))
     and not ('technical'::public.app_role = any(actor_roles)) then
    raise exception 'access management is not allowed' using errcode = '42501';
  end if;

  select status, updated_at into current_status, current_updated_at
  from public.profiles
  where id = p_user_id
  for update;
  if not found then raise exception 'user not found' using errcode = 'P0002'; end if;
  if p_expected_updated_at is null or current_updated_at <> p_expected_updated_at then
    raise exception 'user access changed concurrently' using errcode = '40001';
  end if;

  select coalesce(array_agg(role order by role), '{}'::public.app_role[])
    into current_roles
  from public.user_roles
  where user_id = p_user_id;

  select coalesce(array_agg(distinct requested order by requested), '{}'::public.app_role[])
    into desired_roles
  from unnest(coalesce(p_roles, '{}'::public.app_role[])) requested;

  if exists (
    select 1 from unnest(desired_roles) requested
    where requested not in ('customer', 'admin', 'operational', 'technical')
  ) then
    raise exception 'protected roles cannot be changed by this operation' using errcode = '42501';
  end if;

  foreach role_name in array array[
    'customer'::public.app_role,
    'admin'::public.app_role,
    'operational'::public.app_role,
    'technical'::public.app_role
  ] loop
    if (role_name = any(current_roles)) is distinct from (role_name = any(desired_roles)) then
      can_manage_role := case role_name
        when 'customer' then private.has_permission('users.access.manage_client')
        when 'admin' then private.has_permission('users.access.manage_admin')
        when 'operational' then private.has_permission('users.access.manage_operator')
        when 'technical' then private.has_permission('users.access.manage_technical')
        else false
      end;
      if not can_manage_role then
        raise exception 'role change is not allowed' using errcode = '42501';
      end if;
    end if;
  end loop;

  if p_status is distinct from current_status
     and not ('manager'::public.app_role = any(actor_roles)) then
    raise exception 'profile status management requires manager access' using errcode = '42501';
  end if;

  if 'technical'::public.app_role = any(current_roles)
     and not ('technical'::public.app_role = any(desired_roles))
     and (select count(*) from public.user_roles where role = 'technical') <= 1 then
    raise exception 'the last technical access cannot be removed' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct value order by value), '{}'::public.app_role[])
    into resulting_roles
  from (
    select unnest(desired_roles) as value
    union all
    select protected_role as value
    from unnest(current_roles) protected_role
    where protected_role not in ('customer', 'admin', 'operational', 'technical')
  ) combined;

  if p_status = 'active' and cardinality(resulting_roles) = 0 then
    raise exception 'an active user must keep at least one access';
  end if;

  delete from public.user_roles
  where user_id = p_user_id
    and role in ('customer', 'admin', 'operational', 'technical');

  insert into public.user_roles(user_id, role, created_by)
  select p_user_id, role, auth.uid() from unnest(desired_roles) role
  on conflict do nothing;

  update public.profiles set status = p_status, updated_at = now() where id = p_user_id;

  insert into public.audit_logs(
    actor_id, actor_role, action, entity_type, entity_id,
    previous_data_sanitized, new_data_sanitized, reason
  ) values (
    auth.uid(), private.current_app_role(), 'user_access.changed', 'profiles', p_user_id,
    jsonb_build_object('status', current_status, 'roles', current_roles),
    jsonb_build_object('status', p_status, 'roles', resulting_roles),
    trim(p_reason)
  );
end;
$$;

revoke all on function public.manage_user_access(
  uuid, public.user_status, public.app_role[], text, timestamptz
) from public, anon;
grant execute on function public.manage_user_access(
  uuid, public.user_status, public.app_role[], text, timestamptz
) to authenticated;

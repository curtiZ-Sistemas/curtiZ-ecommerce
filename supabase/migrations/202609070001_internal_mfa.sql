-- Independent of Next.js environment variables; managed only by the database owner.
create table private.internal_security_settings (
  singleton boolean primary key default true check (singleton),
  require_internal_mfa boolean not null default false
);
insert into private.internal_security_settings(singleton) values (true);
revoke all on private.internal_security_settings from public, anon, authenticated, service_role;

create or replace function private.internal_mfa_satisfied()
returns boolean language sql stable security definer set search_path = ''
as $$
  select not coalesce((select require_internal_mfa from private.internal_security_settings where singleton), true)
    or coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2';
$$;
revoke all on function private.internal_mfa_satisfied() from public;
grant execute on function private.internal_mfa_satisfied() to authenticated;

create or replace function private.has_permission(permission_code text)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare override_allowed boolean;
begin
  if not private.is_active_user() then return false; end if;
  if not private.internal_mfa_satisfied() and exists (
    select 1 from public.user_roles where user_id = auth.uid()
      and role in ('admin', 'manager', 'operational', 'technical')
  ) then return false; end if;
  select upo.allowed into override_allowed
  from public.user_permission_overrides upo
  join public.permissions p on p.id = upo.permission_id
  where upo.user_id = auth.uid() and p.code = permission_code
    and (upo.expires_at is null or upo.expires_at > now()) limit 1;
  if override_allowed is not null then return override_allowed; end if;
  return exists (
    select 1 from public.user_roles ur
    join public.role_permissions rp on rp.role = ur.role
    join public.permissions p on p.id = rp.permission_id
    where ur.user_id = auth.uid() and p.code = permission_code
  );
end;
$$;

create or replace function private.user_has_role(requested_role public.app_role)
returns boolean language sql stable security definer set search_path = ''
as $$
  select (requested_role not in ('admin','manager','operational','technical') or private.internal_mfa_satisfied())
    and exists (
      select 1 from public.user_roles ur join public.profiles p on p.id = ur.user_id
      where ur.user_id = auth.uid() and ur.role = requested_role and p.status = 'active'
    );
$$;

-- Legacy policies call this helper directly, so require an active, open account.
create or replace function private.is_admin_user(target_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles role
    join public.profiles profile on profile.id = role.user_id
    where role.user_id = target_user_id and role.role = 'admin'::public.app_role
      and profile.status = 'active' and profile.account_closed_at is null
  );
$$;

-- Legacy policies on other tables query user_roles directly under caller RLS.
create policy "inactive role access revoked" on public.user_roles
as restrictive for all to authenticated
using (private.is_active_user()) with check (private.is_active_user());

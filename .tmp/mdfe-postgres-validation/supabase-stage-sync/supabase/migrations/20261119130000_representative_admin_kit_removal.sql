alter table public.kits
  add column deleted_at timestamptz,
  add constraint kits_deleted_are_inactive check (deleted_at is null or not active);

create function public.remove_representative_admin_kit(p_kit uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.kits;
begin
  if auth.uid() is null or not private.has_permission('representatives.rules.manage') then
    raise exception 'kit_management_forbidden' using errcode = '42501';
  end if;

  -- The same row protects legacy kit creation and the foreign keys that refer to it.
  select * into target from public.kits where id = p_kit for update;
  if not found then return true; end if;
  if target.deleted_at is not null then return false; end if;

  if target.required_for_activation
    or exists (select 1 from public.kit_orders where kit_id = p_kit)
    or exists (select 1 from public.kit_level_rules where kit_id = p_kit) then
    update public.kits set active = false, deleted_at = clock_timestamp() where id = p_kit;
    return false;
  end if;

  delete from public.kits where id = p_kit;
  return true;
end;
$$;

revoke all on function public.remove_representative_admin_kit(uuid) from public, anon;
grant execute on function public.remove_representative_admin_kit(uuid) to authenticated;

-- Serialize deletion and default replacement with address saves.
begin;

create or replace function public.delete_customer_address(p_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare deleted_default boolean; replacement_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('address-save:' || auth.uid()::text, 0));
  select is_default into deleted_default from public.addresses
  where id = p_id and user_id = auth.uid() for update;
  if deleted_default is null then raise exception 'address_not_found' using errcode = 'P0002'; end if;
  delete from public.addresses where id = p_id and user_id = auth.uid();
  if deleted_default then
    select id into replacement_id from public.addresses where user_id = auth.uid()
    order by updated_at desc, created_at desc limit 1 for update;
    update public.addresses set is_default = true, updated_at = now() where id = replacement_id;
  end if;
  return true;
end;
$$;
revoke all on function public.delete_customer_address(uuid) from public, anon;
grant execute on function public.delete_customer_address(uuid) to authenticated;


commit;

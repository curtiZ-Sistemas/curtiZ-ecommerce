-- Expired sessions stay invisible through SELECT RLS. Delete only the caller's
-- own sessions through an authorized RPC instead of weakening that policy.
create function public.delete_product_import_sessions(p_session_id uuid default null)
returns integer language plpgsql security definer set search_path='' as $$
declare removed integer;
begin
  perform private.require_permission('products.create');
  perform private.require_permission('products.update');
  delete from public.product_import_sessions
  where user_id=auth.uid() and (
    (p_session_id is not null and id=p_session_id)
    or (p_session_id is null and expires_at<=now())
  );
  get diagnostics removed = row_count;
  return removed;
end;
$$;
revoke all on function public.delete_product_import_sessions(uuid) from public,anon;
grant execute on function public.delete_product_import_sessions(uuid) to authenticated;

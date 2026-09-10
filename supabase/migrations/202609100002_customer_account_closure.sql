-- Server-only cleanup after password verification. Commercial history is retained.
begin;
alter table public.profiles add column account_closed_at timestamptz;

create function private.customer_account_is_closed()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and account_closed_at is not null);
$$;
revoke all on function private.customer_account_is_closed() from public, anon;
grant execute on function private.customer_account_is_closed() to authenticated;

-- A deleted user's previously issued JWT must not retain direct PostgREST access.
do $$ declare target record; begin
  for target in select tablename from pg_tables where schemaname = 'public' and rowsecurity loop
    execute format('create policy "closed customer access revoked" on public.%I as restrictive for all to authenticated using (not private.customer_account_is_closed()) with check (not private.customer_account_is_closed())', target.tablename);
  end loop;
end $$;
create policy "closed customer storage access revoked" on storage.objects
  as restrictive for all to authenticated
  using (not private.customer_account_is_closed())
  with check (not private.customer_account_is_closed());
create or replace function public.close_customer_account(p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 0));
  perform 1 from public.profiles where id = p_user_id for update;
  if not found or not exists (select 1 from public.user_roles where user_id = p_user_id and role = 'customer')
    or exists (select 1 from public.user_roles where user_id = p_user_id and role <> 'customer') then
    raise exception 'customer account required' using errcode = '42501';
  end if;
  delete from public.cart_items where cart_id in (select id from public.carts where customer_id = p_user_id);
  -- Cart headers may be referenced by historical inventory reservations.
  update public.carts set status = 'closed', updated_at = now() where customer_id = p_user_id;
  delete from public.addresses where user_id = p_user_id;
  delete from public.favorites where customer_id = p_user_id;
  update public.profiles set full_name = 'Conta excluída',
    email_snapshot = (p_user_id::text || '@deleted.invalid'), phone = null,
    avatar_path = null, birth_date = null, cpf_last_four = null, status = 'disabled', account_closed_at = coalesce(account_closed_at, now())
    where id = p_user_id;
end;
$$;
revoke all on function public.close_customer_account(uuid) from public, anon, authenticated;
grant execute on function public.close_customer_account(uuid) to service_role;
commit;

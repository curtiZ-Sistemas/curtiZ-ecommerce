-- PostgREST sessions enforce safeupdate. Limit cleanup to the only allowed row.
create or replace function public.configure_transactional_email_test_scope(p_actor uuid,p_checkout_key uuid,p_started_at timestamptz)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('transactional-email-claim'));
  if p_actor is null and p_checkout_key is null and p_started_at is null then
    delete from private.transactional_email_test_scope where singleton=true; return true;
  end if;
  if p_actor is null or p_checkout_key is null or p_started_at is null
    or p_started_at>now() or p_started_at<=now()-interval '15 minutes'
    or exists(select 1 from private.transactional_email_runtime where enabled)
    or not exists(select 1 from public.profiles where id=p_actor and status='active') then
    raise exception 'email_test_scope_invalid' using errcode='23514';
  end if;
  if exists(select 1 from private.transactional_email_test_scope where expires_at>now()
    and (actor_id<>p_actor or checkout_key<>p_checkout_key or started_at<>p_started_at)) then
    raise exception 'email_test_scope_busy' using errcode='23514';
  end if;
  insert into private.transactional_email_test_scope(singleton,actor_id,checkout_key,started_at,expires_at)
    values(true,p_actor,p_checkout_key,p_started_at,p_started_at+interval '15 minutes')
    on conflict(singleton) do update set actor_id=excluded.actor_id,checkout_key=excluded.checkout_key,
      started_at=excluded.started_at,expires_at=excluded.expires_at;
  return true;
end;
$$;


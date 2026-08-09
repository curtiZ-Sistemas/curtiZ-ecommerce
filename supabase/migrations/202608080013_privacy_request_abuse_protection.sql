-- Protege o canal público de direitos dos titulares sem expor a existência de contas.

alter table private.auth_rate_limits
  drop constraint if exists auth_rate_limits_scope_check;

alter table private.auth_rate_limits
  add constraint auth_rate_limits_scope_check
  check (scope in ('login', 'signup', 'password_reset', 'privacy_request'));

create or replace function public.enforce_auth_rate_limit(
  p_scope text,
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_attempts integer;
begin
  if p_scope not in ('login', 'signup', 'password_reset', 'privacy_request')
    or p_key_hash !~ '^[a-f0-9]{64}$'
    or p_limit < 1
    or p_limit > 100
    or p_window_seconds < 10
    or p_window_seconds > 86400 then
    raise exception 'invalid rate limit parameters';
  end if;
  delete from private.auth_rate_limits
  where updated_at < now() - interval '2 days';
  insert into private.auth_rate_limits(scope, key_hash, window_started_at, attempts, updated_at)
  values (p_scope, p_key_hash, now(), 1, now())
  on conflict (scope, key_hash) do update set
    attempts = case
      when private.auth_rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds)
        then 1
      else private.auth_rate_limits.attempts + 1
    end,
    window_started_at = case
      when private.auth_rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds)
        then now()
      else private.auth_rate_limits.window_started_at
    end,
    updated_at = now()
  returning attempts into current_attempts;
  return current_attempts <= p_limit;
end;
$$;

drop function if exists public.submit_privacy_request(text,text,text,text);

create function public.submit_privacy_request(
  p_request_type text,
  p_requester_name text,
  p_requester_email text,
  p_details text,
  p_customer_id uuid
)
returns text language plpgsql security definer set search_path = '' as $$
declare
  created_request public.data_requests;
  existing_code text;
begin
  if p_request_type not in ('confirmation','access','correction','sharing','withdraw_consent','opposition','deletion','portability','automated_review','other')
    or char_length(trim(p_requester_name)) not between 3 and 120
    or p_requester_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    or char_length(trim(p_details)) not between 10 and 2000 then
    raise exception 'invalid privacy request';
  end if;
  if p_customer_id is not null and not exists (
    select 1 from auth.users
    where id = p_customer_id and lower(email) = lower(trim(p_requester_email))
  ) then
    raise exception 'invalid privacy request owner';
  end if;
  select public_code into existing_code
  from public.data_requests
  where requester_email = lower(trim(p_requester_email))::extensions.citext
    and request_type::text = p_request_type
    and details = trim(p_details)
    and requested_at >= now() - interval '24 hours'
  order by requested_at desc limit 1;
  if existing_code is not null then return existing_code; end if;
  insert into public.data_requests(customer_id,request_type,requester_name,requester_email,details,status)
  values(p_customer_id,p_request_type,trim(p_requester_name),lower(trim(p_requester_email))::extensions.citext,trim(p_details),'requested')
  returning * into created_request;
  insert into public.privacy_request_events(request_id,event_type,public_note,actor_id)
  values(created_request.id,'created','Solicitação recebida e aguardando verificação de identidade.',p_customer_id);
  return created_request.public_code;
end;
$$;

revoke all on function public.submit_privacy_request(text,text,text,text,uuid) from public, anon, authenticated;
grant execute on function public.submit_privacy_request(text,text,text,text,uuid) to service_role;

notify pgrst, 'reload schema';

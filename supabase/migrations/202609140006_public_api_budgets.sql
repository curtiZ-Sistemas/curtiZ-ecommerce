create or replace function public.consume_public_api_rate_limit(p_operation text,p_key_hash text)
returns boolean language plpgsql security definer set search_path='' as $$
declare
  maximum integer;
  bucket timestamptz := pg_catalog.date_trunc('minute',pg_catalog.clock_timestamp());
  current_attempts integer;
  identity_hash text;
begin
  if p_key_hash is null or p_key_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid identity' using errcode='22023';
  end if;
  case p_operation
    when 'help_read' then maximum:=60;
    when 'help_write' then maximum:=30;
    when 'intelligence' then maximum:=30;
    when 'metrics' then maximum:=60;
    when 'availability' then maximum:=60;
    else raise exception 'Invalid operation' using errcode='22023';
  end case;
  -- Bounded maintenance uses the expiry index, including sites without recent logins.
  delete from private.auth_rate_limits where ctid in (
    select ctid from private.auth_rate_limits
    where window_started_at < now() - interval '2 days'
    order by window_started_at limit 100 for update skip locked
  );
  identity_hash:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_operation || ':' || p_key_hash,'UTF8')),'hex');
  insert into private.auth_rate_limits as limits(scope,key_hash,window_started_at,attempts,updated_at)
    values('public_api',identity_hash,bucket,1,pg_catalog.clock_timestamp())
    on conflict(scope,key_hash,window_started_at) do update
      set attempts=limits.attempts+1,updated_at=pg_catalog.clock_timestamp()
    returning limits.attempts into current_attempts;
  return current_attempts<=maximum;
end;
$$;
revoke all on function public.consume_public_api_rate_limit(text,text) from public,anon,authenticated;
grant execute on function public.consume_public_api_rate_limit(text,text) to service_role;
notify pgrst, 'reload schema';

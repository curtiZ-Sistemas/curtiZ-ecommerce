-- Only the server may supply the identity after validating the session and consent.
create function public.ingest_intelligence_events_server(p_session_id uuid, p_events jsonb, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.set_config('request.jwt.claim.sub', coalesce(p_user_id::text, ''), true);
  perform pg_catalog.set_config('request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', p_user_id, 'role', case when p_user_id is null then 'anon' else 'authenticated' end)::text, true);
  return public.ingest_intelligence_events(p_session_id, p_events, true);
end;
$$;
revoke all on function public.ingest_intelligence_events_server(uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.ingest_intelligence_events_server(uuid,jsonb,uuid) to service_role;
notify pgrst, 'reload schema';

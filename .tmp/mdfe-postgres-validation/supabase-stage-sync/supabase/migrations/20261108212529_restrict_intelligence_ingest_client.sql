-- Apply only after the store uses the service-only entry point.
revoke execute on function public.ingest_intelligence_events(uuid,jsonb,boolean) from public,anon,authenticated;
notify pgrst, 'reload schema';

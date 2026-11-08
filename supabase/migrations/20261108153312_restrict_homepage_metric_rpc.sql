-- The store applies rate limiting and consent before calling this server-only RPC.
revoke execute on function public.record_homepage_metric(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.record_homepage_metric(uuid, text, text, text) to service_role;

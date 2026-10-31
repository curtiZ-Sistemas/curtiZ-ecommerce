-- Read-only readiness probe for the independent shipping quote budget (202609300001).
-- It only inspects catalog metadata and returns a boolean; it never writes or exposes data.
create or replace function public.shipping_quote_rate_limit_ready()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
      select 1
      from pg_catalog.pg_constraint c
      join pg_catalog.pg_class t on t.oid = c.conrelid
      join pg_catalog.pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'private'
        and t.relname = 'auth_rate_limits'
        and c.conname = 'auth_rate_limits_scope_check'
        and pg_catalog.pg_get_constraintdef(c.oid) like '%''shipping_quote''%'
    )
    and exists (
      select 1
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'consume_private_api_rate_limit'
        and p.prosrc like '%''shipping_quote''%'
        and pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
        and not pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
    );
$$;

revoke all on function public.shipping_quote_rate_limit_ready() from public;
grant execute on function public.shipping_quote_rate_limit_ready() to anon, authenticated, service_role;

notify pgrst, 'reload schema';

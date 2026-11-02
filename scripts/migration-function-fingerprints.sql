-- Read-only function fingerprints from the rebuilt, ephemeral CI database.
-- No rows, credentials or function bodies are written to the CI log.
select 'CURTIZ_SCHEMA_FN|' || jsonb_build_object(
  'schema', n.nspname,
  'name', p.proname,
  'args', pg_get_function_identity_arguments(p.oid),
  'hash', md5(regexp_replace(replace(p.prosrc, E'\r\n', E'\n'), '^\s+|\s+$', '', 'g')),
  'definer', p.prosecdef,
  'configuration', p.proconfig
)::text
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'private')
order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid);

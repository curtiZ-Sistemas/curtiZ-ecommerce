-- Restaura os privilegios esperados pelo Data API sem enfraquecer as politicas RLS.
-- Necessario quando migrations sao executadas pelo SQL Editor com default privileges
-- diferentes dos utilizados pelo Supabase CLI.

do $$
declare
  required_relation text;
begin
  foreach required_relation in array array[
    'public.help_contents',
    'public.help_content_versions',
    'public.help_content_relations',
    'public.help_search_events',
    'public.help_content_feedback'
  ]
  loop
    if to_regclass(required_relation) is null then
      raise exception 'required migration 202608080006_help_center_reform.sql is not applied: % is missing',
        required_relation;
    end if;
  end loop;
end
$$;

do $$
declare
  application_table record;
  application_sequence record;
begin
  for application_table in
    select schemaname, tablename
    from pg_tables
    where schemaname = 'public'
      and tablename <> 'spatial_ref_sys'
  loop
    execute format(
      'alter table %I.%I enable row level security',
      application_table.schemaname,
      application_table.tablename
    );
    execute format(
      'grant select, insert, update, delete on table %I.%I to authenticated',
      application_table.schemaname,
      application_table.tablename
    );
    execute format(
      'grant all privileges on table %I.%I to service_role',
      application_table.schemaname,
      application_table.tablename
    );
  end loop;

  for application_sequence in
    select sequence_schema, sequence_name
    from information_schema.sequences
    where sequence_schema = 'public'
  loop
    execute format(
      'grant usage, select on sequence %I.%I to authenticated',
      application_sequence.sequence_schema,
      application_sequence.sequence_name
    );
    execute format(
      'grant all privileges on sequence %I.%I to service_role',
      application_sequence.sequence_schema,
      application_sequence.sequence_name
    );
  end loop;
end
$$;

grant usage on schema public to authenticated, service_role;

-- Views publicadas continuam somente leitura; as fontes mantem RLS habilitado.
grant select on table public.published_legal_documents to authenticated, service_role;
grant select on table public.published_help_contents to authenticated, service_role;
grant select on table public.published_homepage_sections to authenticated, service_role;

-- A chave secreta do backend precisa conservar acesso a novos objetos. O acesso
-- de usuarios autenticados continua sendo concedido migration a migration.
alter default privileges for role postgres in schema public
  grant all privileges on tables to service_role;
alter default privileges for role postgres in schema public
  grant all privileges on sequences to service_role;

notify pgrst, 'reload schema';

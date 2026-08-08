-- Painel técnico Curtiz: observabilidade segura e ações operacionais auditadas.

insert into public.permissions(code, description) values
  ('technical.health.read', 'Ler saúde dos serviços'),
  ('technical.logs.read', 'Ler logs e erros técnicos sanitizados'),
  ('technical.logs.manage', 'Atribuir e resolver eventos técnicos'),
  ('technical.logs.export', 'Exportar logs técnicos sanitizados'),
  ('technical.integrations.manage', 'Gerenciar integrações técnicas'),
  ('technical.jobs.manage', 'Reprocessar ou cancelar jobs'),
  ('technical.webhooks.manage', 'Reprocessar eventos de webhook'),
  ('technical.features.manage', 'Gerenciar feature flags técnicas'),
  ('technical.storage.read', 'Ler resumo agregado do Storage'),
  ('technical.database.read', 'Ler diagnóstico agregado do banco')
on conflict (code) do update set description = excluded.description;

insert into public.role_permissions(role, permission_id)
select 'technical', id
from public.permissions
where code in (
  'technical.health.read',
  'technical.logs.read',
  'technical.logs.manage',
  'technical.logs.export',
  'technical.integrations.manage',
  'technical.jobs.manage',
  'technical.webhooks.manage',
  'technical.features.manage',
  'technical.storage.read',
  'technical.database.read',
  'audit.read'
)
on conflict do nothing;

alter table public.technical_events
  add column if not exists resolution_status text not null default 'open'
    check (resolution_status in ('open', 'investigating', 'resolved', 'ignored')),
  add column if not exists assigned_to uuid references public.profiles(id),
  add column if not exists resolution_note text,
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by uuid references public.profiles(id),
  add column if not exists user_id uuid references public.profiles(id),
  add column if not exists route text check (route is null or char_length(route) <= 500),
  add column if not exists duration_ms integer check (duration_ms is null or duration_ms >= 0);

create index if not exists technical_events_resolution_idx
  on public.technical_events(resolution_status, severity, created_at desc);
create index if not exists technical_events_request_idx
  on public.technical_events(request_id) where request_id is not null;
create index if not exists technical_events_user_idx
  on public.technical_events(user_id, created_at desc) where user_id is not null;
create index if not exists technical_events_route_idx
  on public.technical_events(route, created_at desc) where route is not null;

create policy "technical reads background jobs" on public.background_jobs
  for select to authenticated
  using (private.has_permission('technical.health.read'));

create policy "technical reads payment webhook events" on public.payment_events
  for select to authenticated
  using (private.has_permission('technical.logs.read'));

create policy "technical reads feature flags" on public.feature_flags
  for select to authenticated
  using (private.has_permission('technical.health.read'));

create or replace function public.technical_transition_job(
  p_job_id uuid,
  p_action text,
  p_reason text
)
returns public.background_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_job public.background_jobs;
  updated_job public.background_jobs;
begin
  perform private.require_permission('technical.jobs.manage');
  if nullif(trim(p_reason), '') is null or char_length(trim(p_reason)) < 3 then
    raise exception 'job action reason is required';
  end if;
  select * into previous_job from public.background_jobs where id = p_job_id for update;
  if previous_job.id is null then raise exception 'job not found' using errcode = 'P0002'; end if;

  if p_action = 'reprocess' and previous_job.status in ('failed', 'cancelled') then
    update public.background_jobs
      set status = 'pending', available_at = now(), locked_at = null,
          completed_at = null, error_summary = null
      where id = p_job_id returning * into updated_job;
  elsif p_action = 'cancel' and previous_job.status in ('pending', 'running') then
    update public.background_jobs
      set status = 'cancelled', completed_at = now(), locked_at = null
      where id = p_job_id returning * into updated_job;
  else
    raise exception 'invalid job transition';
  end if;

  insert into public.audit_logs(
    actor_id, actor_role, action, entity_type, entity_id,
    previous_data_sanitized, new_data_sanitized, reason
  ) values (
    auth.uid(), 'technical', 'technical.job.' || p_action, 'background_jobs', p_job_id,
    to_jsonb(previous_job) - 'payload_sanitized' - 'idempotency_key',
    to_jsonb(updated_job) - 'payload_sanitized' - 'idempotency_key', trim(p_reason)
  );
  return updated_job;
end;
$$;

create or replace function public.technical_reprocess_payment_event(
  p_event_id uuid,
  p_reason text
)
returns public.payment_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_event public.payment_events;
  updated_event public.payment_events;
begin
  perform private.require_permission('technical.webhooks.manage');
  if nullif(trim(p_reason), '') is null or char_length(trim(p_reason)) < 3 then
    raise exception 'webhook reprocess reason is required';
  end if;
  select * into previous_event from public.payment_events where id = p_event_id for update;
  if previous_event.id is null then raise exception 'event not found' using errcode = 'P0002'; end if;
  if previous_event.processing_status not in ('failed', 'error') then
    raise exception 'only failed events can be reprocessed';
  end if;

  update public.payment_events
    set processing_status = 'pending', attempts = attempts + 1,
        processed_at = null, error_summary = null
    where id = p_event_id returning * into updated_event;

  insert into public.audit_logs(
    actor_id, actor_role, action, entity_type, entity_id,
    previous_data_sanitized, new_data_sanitized, reason
  ) values (
    auth.uid(), 'technical', 'technical.webhook.reprocess', 'payment_events', p_event_id,
    to_jsonb(previous_event) - 'payload_hash',
    to_jsonb(updated_event) - 'payload_hash', trim(p_reason)
  );
  return updated_event;
end;
$$;

create or replace function public.technical_resolve_event(
  p_event_id uuid,
  p_status text,
  p_note text,
  p_assigned_to uuid default null
)
returns public.technical_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_event public.technical_events;
  updated_event public.technical_events;
begin
  perform private.require_permission('technical.logs.manage');
  if p_status not in ('open', 'investigating', 'resolved', 'ignored') then
    raise exception 'invalid resolution status';
  end if;
  if nullif(trim(p_note), '') is null or char_length(trim(p_note)) < 3 then
    raise exception 'resolution note is required';
  end if;
  if p_assigned_to is not null and not exists (
    select 1 from public.user_roles where user_id = p_assigned_to and role = 'technical'
  ) then
    raise exception 'assignee is not technical';
  end if;
  select * into previous_event from public.technical_events where id = p_event_id for update;
  if previous_event.id is null then raise exception 'technical event not found' using errcode = 'P0002'; end if;

  update public.technical_events
    set resolution_status = p_status,
        resolution_note = trim(p_note),
        assigned_to = coalesce(p_assigned_to, assigned_to),
        resolved_at = case when p_status in ('resolved', 'ignored') then now() else null end,
        resolved_by = case when p_status in ('resolved', 'ignored') then auth.uid() else null end
    where id = p_event_id returning * into updated_event;

  insert into public.audit_logs(
    actor_id, actor_role, action, entity_type, entity_id,
    previous_data_sanitized, new_data_sanitized, reason
  ) values (
    auth.uid(), 'technical', 'technical.event.' || p_status, 'technical_events', p_event_id,
    to_jsonb(previous_event) - 'context_sanitized',
    to_jsonb(updated_event) - 'context_sanitized', trim(p_note)
  );
  return updated_event;
end;
$$;

create or replace function public.technical_set_feature_flag(
  p_key text,
  p_enabled boolean,
  p_reason text
)
returns public.feature_flags
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_flag public.feature_flags;
  updated_flag public.feature_flags;
begin
  perform private.require_permission('technical.features.manage');
  if nullif(trim(p_reason), '') is null or char_length(trim(p_reason)) < 3 then
    raise exception 'feature flag reason is required';
  end if;
  select * into previous_flag from public.feature_flags where key = p_key for update;
  if previous_flag.key is null then raise exception 'feature flag not found' using errcode = 'P0002'; end if;

  update public.feature_flags
    set enabled = p_enabled, updated_by = auth.uid(), updated_at = now()
    where key = p_key returning * into updated_flag;

  insert into public.audit_logs(
    actor_id, actor_role, action, entity_type,
    previous_data_sanitized, new_data_sanitized, reason
  ) values (
    auth.uid(), 'technical', 'technical.feature_flag.updated', 'feature_flags',
    jsonb_build_object('key', previous_flag.key, 'enabled', previous_flag.enabled),
    jsonb_build_object('key', updated_flag.key, 'enabled', updated_flag.enabled), trim(p_reason)
  );
  return updated_flag;
end;
$$;

create or replace function public.technical_storage_summary()
returns table(bucket_id text, object_count bigint, total_bytes bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select
    bucket.id::text,
    count(object.id)::bigint,
    coalesce(sum(case when object.metadata->>'size' ~ '^[0-9]+$' then (object.metadata->>'size')::bigint else 0 end), 0)::bigint
  from storage.buckets bucket
  left join storage.objects object on object.bucket_id = bucket.id
  where private.has_permission('technical.storage.read')
  group by bucket.id
  order by bucket.id;
$$;

create or replace function public.technical_can_export()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_permission('technical.logs.export');
$$;

create or replace function public.technical_database_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform private.require_permission('technical.database.read');
  select jsonb_build_object(
    'database_size_bytes', pg_database_size(current_database()),
    'active_connections', (
      select count(*) from pg_catalog.pg_stat_activity where datname = current_database()
    ),
    'public_tables', (
      select count(*) from pg_catalog.pg_tables where schemaname = 'public'
    ),
    'public_indexes', (
      select count(*) from pg_catalog.pg_indexes where schemaname = 'public'
    ),
    'last_migration', (
      select max(version) from supabase_migrations.schema_migrations
    ),
    'server_version', current_setting('server_version')
  ) into result;
  return result;
end;
$$;

create or replace function public.technical_log_export(
  p_resource text,
  p_filters jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('technical.logs.export');
  if p_resource not in ('logs', 'erros', 'seguranca', 'acessos-tecnicos', 'webhooks', 'auditoria-tecnica') then
    raise exception 'technical export is not allowed' using errcode = '42501';
  end if;
  insert into public.audit_logs(actor_id, actor_role, action, entity_type, new_data_sanitized, reason)
  values (
    auth.uid(), 'technical', 'technical.logs.exported', 'technical_export',
    jsonb_build_object('resource', p_resource, 'filters', coalesce(p_filters, '{}'::jsonb)),
    'Exportação técnica sanitizada'
  );
end;
$$;

revoke all on function public.technical_transition_job(uuid,text,text) from public, anon;
grant execute on function public.technical_transition_job(uuid,text,text) to authenticated;
revoke all on function public.technical_reprocess_payment_event(uuid,text) from public, anon;
grant execute on function public.technical_reprocess_payment_event(uuid,text) to authenticated;
revoke all on function public.technical_resolve_event(uuid,text,text,uuid) from public, anon;
grant execute on function public.technical_resolve_event(uuid,text,text,uuid) to authenticated;
revoke all on function public.technical_set_feature_flag(text,boolean,text) from public, anon;
grant execute on function public.technical_set_feature_flag(text,boolean,text) to authenticated;
revoke all on function public.technical_storage_summary() from public, anon;
grant execute on function public.technical_storage_summary() to authenticated;
revoke all on function public.technical_can_export() from public, anon;
grant execute on function public.technical_can_export() to authenticated;
revoke all on function public.technical_database_summary() from public, anon;
grant execute on function public.technical_database_summary() to authenticated;
revoke all on function public.technical_log_export(text,jsonb) from public, anon;
grant execute on function public.technical_log_export(text,jsonb) to authenticated;

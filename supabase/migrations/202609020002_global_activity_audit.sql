-- Evolui a trilha central de auditoria para consulta global, sanitizada e imutavel.

alter table public.audit_logs
  add column if not exists actor_name_snapshot text,
  add column if not exists actor_email_snapshot text,
  add column if not exists action_type text not null default 'OTHER',
  add column if not exists module text,
  add column if not exists entity_label text,
  add column if not exists description text,
  add column if not exists origin_type text not null default 'person',
  add column if not exists origin_name text,
  add column if not exists session_id_hash text,
  add column if not exists metadata_sanitized jsonb,
  add column if not exists changed_fields text[] not null default '{}'::text[],
  add column if not exists event_key text,
  add column if not exists transaction_id bigint not null default txid_current();

alter table public.audit_logs
  drop constraint if exists audit_logs_action_type_check,
  add constraint audit_logs_action_type_check check (
    action_type in ('CREATE','UPDATE','DELETE','LOGIN','LOGOUT','APPROVE','REJECT','BLOCK','UNBLOCK','PAY','REFUND','EXPORT','IMPORT','VIEW','OTHER')
  ),
  drop constraint if exists audit_logs_origin_type_check,
  add constraint audit_logs_origin_type_check check (origin_type in ('person','system','integration'));

create unique index if not exists audit_logs_event_key_uidx
  on public.audit_logs(event_key) where event_key is not null;
create index if not exists audit_logs_created_idx on public.audit_logs(created_at desc);
create index if not exists audit_logs_actor_created_idx on public.audit_logs(actor_id, created_at desc);
create index if not exists audit_logs_action_created_idx on public.audit_logs(action_type, created_at desc);
create index if not exists audit_logs_module_created_idx on public.audit_logs(module, created_at desc);
create index if not exists audit_logs_origin_created_idx on public.audit_logs(origin_type, created_at desc);
create index if not exists audit_logs_transaction_idx on public.audit_logs(transaction_id, entity_id);

create or replace function private.sanitize_audit_json(p_value jsonb, p_depth integer default 0)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  item record;
  sanitized jsonb;
  value_text text;
begin
  if p_value is null then return null; end if;
  if p_depth > 6 then return '"[TRUNCATED]"'::jsonb; end if;

  case jsonb_typeof(p_value)
    when 'object' then
      sanitized := '{}'::jsonb;
      for item in select key, value from jsonb_each(p_value) order by key limit 150 loop
        if item.key ~* '(authorization|cookie|password|passwd|secret|token|credential|service.?role|private.?key|api.?key|cvv|card.?number|cpf|document|payload|idempotency|iban|swift|bank.?account|account.?number|routing|pix.?key|encrypted|address|phone|customer.?name|customer.?email|payment.?method|provider.?payment|provider.?preference|external.?reference|raw.?payload)' then
          sanitized := sanitized || jsonb_build_object(item.key, '[REDACTED]');
        else
          sanitized := sanitized || jsonb_build_object(item.key, private.sanitize_audit_json(item.value, p_depth + 1));
        end if;
      end loop;
      return sanitized;
    when 'array' then
      select coalesce(jsonb_agg(private.sanitize_audit_json(value, p_depth + 1)), '[]'::jsonb)
        into sanitized
      from (select value from jsonb_array_elements(p_value) with ordinality values_with_order(value, position) order by position limit 150) limited;
      return sanitized;
    when 'string' then
      value_text := left(p_value #>> '{}', 4000);
      value_text := regexp_replace(value_text, 'bearer[[:space:]]+[A-Za-z0-9._~+/=-]+', 'Bearer [REDACTED]', 'gi');
      value_text := regexp_replace(value_text, 'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}', '[JWT]', 'g');
      value_text := regexp_replace(value_text, '(postgres(?:ql)?|mongodb(?:\+srv)?):\/\/[^[:space:]"'']+', '[CONNECTION_URL]', 'gi');
      value_text := regexp_replace(value_text, '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[A-Za-z]{2,}', '[EMAIL]', 'g');
      value_text := regexp_replace(value_text, '[0-9]{3}\.?[0-9]{3}\.?[0-9]{3}-?[0-9]{2}', '[CPF]', 'g');
      value_text := regexp_replace(value_text, '(^|[^0-9])([0-9][ -]?){13,19}([^0-9]|$)', '\1[CARD]\3', 'g');
      return to_jsonb(value_text);
    else
      return p_value;
  end case;
end;
$$;

create or replace function private.audit_changed_fields(p_before jsonb, p_after jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(key order by key), '{}'::text[])
  from (
    select key
    from (
      select jsonb_object_keys(case when jsonb_typeof(p_before) = 'object' then p_before else '{}'::jsonb end) as key
      union
      select jsonb_object_keys(case when jsonb_typeof(p_after) = 'object' then p_after else '{}'::jsonb end) as key
    ) keys
    where (case when jsonb_typeof(p_before) = 'object' then p_before else '{}'::jsonb end) -> key
      is distinct from (case when jsonb_typeof(p_after) = 'object' then p_after else '{}'::jsonb end) -> key
  ) changed;
$$;

create or replace function private.audit_action_type(p_action text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when lower(coalesce(p_action, '')) ~ '(deleted|delete|removed|remove|excluded|exclu)' then 'DELETE'
    when lower(coalesce(p_action, '')) ~ '(created|create|inserted|registered|saved)' then 'CREATE'
    when lower(coalesce(p_action, '')) ~ '(login|signed_in)' then 'LOGIN'
    when lower(coalesce(p_action, '')) ~ '(logout|signed_out)' then 'LOGOUT'
    when lower(coalesce(p_action, '')) ~ '(approved|approve)' then 'APPROVE'
    when lower(coalesce(p_action, '')) ~ '(rejected|reject)' then 'REJECT'
    when lower(coalesce(p_action, '')) ~ '(unblocked|unlock|reopened|reactivat)' then 'UNBLOCK'
    when lower(coalesce(p_action, '')) ~ '(blocked|block|locked|suspend)' then 'BLOCK'
    when lower(coalesce(p_action, '')) ~ '(refund|refunded|reversal|estorn)' then 'REFUND'
    when lower(coalesce(p_action, '')) ~ '(^|[._])(paid|pay|payment_completed|payment_succeeded)([._]|$)' then 'PAY'
    when lower(coalesce(p_action, '')) ~ '(export)' then 'EXPORT'
    when lower(coalesce(p_action, '')) ~ '(import)' then 'IMPORT'
    when lower(coalesce(p_action, '')) ~ '(view|read|opened)' then 'VIEW'
    when lower(coalesce(p_action, '')) ~ '(updated|update|changed|adjust|transition|published|reordered|restored|write)' then 'UPDATE'
    else 'OTHER'
  end;
$$;

create or replace function private.audit_module(p_entity_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when lower(coalesce(p_entity_type, '')) ~ '(financial|payment|commission|refund|finance)' then 'financeiro'
    when lower(coalesce(p_entity_type, '')) ~ '(order|sale|kit)' then 'pedidos'
    when lower(coalesce(p_entity_type, '')) ~ '(inventory|stock)' then 'estoque'
    when lower(coalesce(p_entity_type, '')) ~ '(product|catalog|merchant)' then 'catalogo'
    when lower(coalesce(p_entity_type, '')) ~ '(profile|user|permission|access|role)' then 'acessos'
    when lower(coalesce(p_entity_type, '')) ~ '(homepage|banner|campaign|creative|promotion|content)' then 'conteudo'
    when lower(coalesce(p_entity_type, '')) ~ '(support|conversation|help)' then 'atendimento'
    when lower(coalesce(p_entity_type, '')) ~ '(integration|webhook)' then 'integracoes'
    when lower(coalesce(p_entity_type, '')) ~ '(technical|security|system)' then 'sistema'
    else coalesce(nullif(split_part(lower(p_entity_type), '.', 1), ''), 'geral')
  end;
$$;

create or replace function private.prepare_audit_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_profile record;
  request_headers jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  jwt_claims jsonb := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  raw_session text;
  raw_ip text;
begin
  if new.actor_id is not null then
    select p.full_name, p.email_snapshot::text into actor_profile
    from public.profiles p where p.id = new.actor_id;
    new.actor_name_snapshot := coalesce(nullif(new.actor_name_snapshot, ''), actor_profile.full_name);
    new.actor_email_snapshot := coalesce(nullif(new.actor_email_snapshot, ''), lower(actor_profile.email_snapshot));
  end if;

  new.action_type := coalesce(nullif(new.action_type, ''), private.audit_action_type(new.action));
  if new.action_type = 'OTHER' then new.action_type := private.audit_action_type(new.action); end if;
  new.module := coalesce(nullif(new.module, ''), private.audit_module(new.entity_type));
  new.origin_type := case
    when new.origin_type in ('person','system','integration') then new.origin_type
    when new.actor_id is not null then 'person'
    else 'system'
  end;
  if new.actor_id is null and new.origin_type = 'person' then new.origin_type := 'system'; end if;
  new.origin_name := coalesce(nullif(new.origin_name, ''), case when new.actor_id is null then 'Sistema curtiZ' else new.actor_name_snapshot end);
  new.description := coalesce(nullif(new.description, ''), nullif(new.reason, ''), new.action || ' em ' || new.entity_type);
  new.reason := left(private.sanitize_audit_json(to_jsonb(new.reason)) #>> '{}', 2000);
  new.description := left(private.sanitize_audit_json(to_jsonb(new.description)) #>> '{}', 2000);
  new.entity_label := left(private.sanitize_audit_json(to_jsonb(new.entity_label)) #>> '{}', 300);
  new.origin_name := left(private.sanitize_audit_json(to_jsonb(new.origin_name)) #>> '{}', 300);
  new.previous_data_sanitized := private.sanitize_audit_json(new.previous_data_sanitized);
  new.new_data_sanitized := private.sanitize_audit_json(new.new_data_sanitized);
  new.metadata_sanitized := private.sanitize_audit_json(new.metadata_sanitized);
  new.changed_fields := private.audit_changed_fields(new.previous_data_sanitized, new.new_data_sanitized);
  new.transaction_id := coalesce(new.transaction_id, txid_current());
  raw_session := nullif(jwt_claims->>'session_id', '');
  raw_ip := nullif(split_part(coalesce(request_headers->>'x-forwarded-for', ''), ',', 1), '');
  if new.session_id_hash is null and raw_session is not null then
    new.session_id_hash := encode(extensions.digest(convert_to(raw_session, 'UTF8'), 'sha256'), 'hex');
  end if;
  if new.ip_hash is null and raw_ip is not null and raw_session is not null then
    new.ip_hash := encode(extensions.digest(convert_to(trim(raw_ip) || ':' || raw_session || ':curtiz-audit-v1', 'UTF8'), 'sha256'), 'hex');
  end if;
  new.user_agent_summary := coalesce(new.user_agent_summary, left(private.sanitize_audit_json(to_jsonb(request_headers->>'user-agent')) #>> '{}', 300));
  if new.request_id is null and coalesce(request_headers->>'x-request-id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    new.request_id := (request_headers->>'x-request-id')::uuid;
  end if;
  return new;
end;
$$;

drop trigger if exists prepare_audit_log on public.audit_logs;
create trigger prepare_audit_log
before insert on public.audit_logs
for each row execute function private.prepare_audit_log();

update public.audit_logs l
set actor_name_snapshot = coalesce(l.actor_name_snapshot, p.full_name),
    actor_email_snapshot = coalesce(l.actor_email_snapshot, lower(p.email_snapshot::text)),
    action_type = private.audit_action_type(l.action),
    module = coalesce(l.module, private.audit_module(l.entity_type)),
    description = coalesce(l.description, nullif(l.reason, ''), l.action || ' em ' || l.entity_type),
    reason = left(private.sanitize_audit_json(to_jsonb(l.reason)) #>> '{}', 2000),
    origin_type = case when l.actor_id is null then 'system' else 'person' end,
    origin_name = coalesce(l.origin_name, case when l.actor_id is null then 'Sistema curtiZ' else p.full_name end),
    previous_data_sanitized = private.sanitize_audit_json(l.previous_data_sanitized),
    new_data_sanitized = private.sanitize_audit_json(l.new_data_sanitized),
    metadata_sanitized = private.sanitize_audit_json(l.metadata_sanitized),
    changed_fields = private.audit_changed_fields(
      private.sanitize_audit_json(l.previous_data_sanitized),
      private.sanitize_audit_json(l.new_data_sanitized)
    )
from public.profiles p
where p.id = l.actor_id;

update public.audit_logs l
set action_type = private.audit_action_type(l.action),
    module = coalesce(l.module, private.audit_module(l.entity_type)),
    description = coalesce(l.description, nullif(l.reason, ''), l.action || ' em ' || l.entity_type),
    reason = left(private.sanitize_audit_json(to_jsonb(l.reason)) #>> '{}', 2000),
    origin_type = 'system',
    origin_name = coalesce(l.origin_name, 'Sistema curtiZ'),
    previous_data_sanitized = private.sanitize_audit_json(l.previous_data_sanitized),
    new_data_sanitized = private.sanitize_audit_json(l.new_data_sanitized),
    metadata_sanitized = private.sanitize_audit_json(l.metadata_sanitized),
    changed_fields = private.audit_changed_fields(
      private.sanitize_audit_json(l.previous_data_sanitized),
      private.sanitize_audit_json(l.new_data_sanitized)
    )
where l.actor_id is null;

update public.audit_logs
set description = left(private.sanitize_audit_json(to_jsonb(description)) #>> '{}', 2000),
    entity_label = left(private.sanitize_audit_json(to_jsonb(entity_label)) #>> '{}', 300),
    origin_name = left(private.sanitize_audit_json(to_jsonb(origin_name)) #>> '{}', 300),
    ip_hash = case
      when ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$' then ip_hash
      else encode(extensions.digest(convert_to(ip_hash, 'UTF8'), 'sha256'), 'hex')
    end;

alter table public.audit_logs
  add column if not exists search_document tsvector generated always as (
    to_tsvector('simple'::regconfig,
      coalesce(actor_name_snapshot, '') || ' ' || coalesce(action, '') || ' ' ||
      coalesce(action_type, '') || ' ' || coalesce(module, '') || ' ' ||
      coalesce(entity_type, '') || ' ' || coalesce(entity_label, '') || ' ' ||
      coalesce(description, '') || ' ' || coalesce(reason, '')
    )
  ) stored;
create index if not exists audit_logs_search_idx on public.audit_logs using gin(search_document);

create or replace function private.write_audit_event(
  p_action text,
  p_entity_type text,
  p_entity_id uuid default null,
  p_before jsonb default null,
  p_after jsonb default null,
  p_reason text default null,
  p_description text default null,
  p_module text default null,
  p_entity_label text default null,
  p_origin_type text default null,
  p_origin_name text default null,
  p_metadata jsonb default null,
  p_event_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_id uuid;
  event_actor uuid := auth.uid();
  effective_origin text := coalesce(nullif(p_origin_type, ''), 'system');
begin
  if nullif(trim(p_action), '') is null or nullif(trim(p_entity_type), '') is null then
    raise exception 'audit action and entity type are required';
  end if;
  if effective_origin not in ('system','integration') or auth.role() <> 'service_role' then
    raise exception 'system audit events require service role' using errcode = '42501';
  end if;
  insert into public.audit_logs(
    actor_id, actor_role, action, entity_type, entity_id,
    previous_data_sanitized, new_data_sanitized, reason, description, module,
    entity_label, origin_type, origin_name, metadata_sanitized, event_key
  ) values (
    null, null,
    trim(p_action), trim(p_entity_type), p_entity_id, p_before, p_after,
    nullif(trim(p_reason), ''), nullif(trim(p_description), ''), nullif(trim(p_module), ''),
    nullif(trim(p_entity_label), ''), effective_origin, nullif(trim(p_origin_name), ''),
    p_metadata, nullif(trim(p_event_key), '')
  )
  on conflict (event_key) where event_key is not null do nothing
  returning id into event_id;
  return event_id;
end;
$$;

revoke all on function private.write_audit_event(text,text,uuid,jsonb,jsonb,text,text,text,text,text,text,jsonb,text) from public, anon, authenticated;
grant execute on function private.write_audit_event(text,text,uuid,jsonb,jsonb,text,text,text,text,text,text,jsonb,text) to service_role;

create or replace function public.log_internal_auth_event(p_event text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  normalized_event text := upper(trim(coalesce(p_event, '')));
begin
  if actor is null or normalized_event not in ('LOGIN','LOGOUT') then
    raise exception 'invalid authentication audit event' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.profiles p
    join public.user_roles r on r.user_id = p.id
    where p.id = actor and p.status = 'active'
      and r.role in ('admin','manager','operational','technical')
  ) then
    return;
  end if;

  insert into public.audit_logs(
    actor_id, actor_role, action, action_type, entity_type, entity_id,
    module, description, origin_type
  ) values (
    actor, private.current_app_role(), 'auth.' || lower(normalized_event), normalized_event,
    'profiles', actor, 'acessos',
    case normalized_event when 'LOGIN' then 'Acesso ao painel interno iniciado' else 'Sessao do painel interno encerrada' end,
    'person'
  );
end;
$$;

revoke all on function public.log_internal_auth_event(text) from public, anon;
grant execute on function public.log_internal_auth_event(text) to authenticated;

create or replace function private.capture_critical_row_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_data jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  after_data jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  row_data jsonb := coalesce(after_data, before_data);
  target_id uuid;
  target_label text;
  event_actor uuid;
begin
  target_id := nullif(coalesce(row_data->>'id', row_data->>'user_id', row_data->>'variant_id', row_data->>'order_id'), '')::uuid;
  target_label := nullif(coalesce(row_data->>'name', row_data->>'public_code', row_data->>'sku', row_data->>'code', row_data->>'full_name'), '');

  if exists (
    select 1 from public.audit_logs l
    where l.transaction_id = txid_current()
      and (l.entity_id = target_id or (target_id is null and l.entity_type = tg_table_name))
      and l.action not like 'audit.%'
  ) then
    return null;
  end if;

  select auth.uid() into event_actor;
  if event_actor is not null and not exists (select 1 from public.profiles where id = event_actor) then
    event_actor := null;
  end if;

  insert into public.audit_logs(
    actor_id, actor_role, action, entity_type, entity_id, entity_label,
    previous_data_sanitized, new_data_sanitized, description, origin_type, origin_name
  ) values (
    event_actor,
    case when event_actor is null then null else private.current_app_role() end,
    tg_table_name || '.' || lower(tg_op), tg_table_name, target_id, target_label,
    before_data, after_data,
    case tg_op when 'INSERT' then 'Registro criado' when 'UPDATE' then 'Registro alterado' else 'Registro excluido' end || ' em ' || tg_table_name,
    case when event_actor is null then 'system' else 'person' end,
    case when event_actor is null then 'Sistema curtiZ' else null end
  );
  return null;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles','user_roles','user_permission_overrides','products','product_variants',
    'inventory','coupons','orders','payments','banners','promotion_campaigns',
    'commission_payments','financial_transactions'
  ] loop
    if to_regclass('public.' || table_name) is not null then
      execute format('drop trigger if exists audit_critical_change on public.%I', table_name);
      execute format(
        'create constraint trigger audit_critical_change after insert or update or delete on public.%I deferrable initially deferred for each row execute function private.capture_critical_row_audit()',
        table_name
      );
    end if;
  end loop;
end;
$$;

create or replace function private.mirror_homepage_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_logs(
    actor_id, actor_role, action, entity_type, entity_id, previous_data_sanitized,
    new_data_sanitized, reason, description, module, origin_type, event_key
  ) values (
    new.actor_id, new.actor_role, new.action, 'homepage.section', new.section_id,
    new.previous_data, new.new_data, new.reason,
    coalesce(nullif(new.reason, ''), 'Conteudo da pagina inicial alterado'),
    'conteudo', case when new.actor_id is null then 'system' else 'person' end,
    'homepage-audit:' || new.id::text
  ) on conflict (event_key) where event_key is not null do nothing;
  return new;
end;
$$;

drop trigger if exists mirror_homepage_audit on public.home_section_audit_logs;
create trigger mirror_homepage_audit
after insert on public.home_section_audit_logs
for each row execute function private.mirror_homepage_audit();

insert into public.audit_logs(
  actor_id, actor_role, action, entity_type, entity_id, previous_data_sanitized,
  new_data_sanitized, reason, description, module, origin_type, event_key, created_at
)
select h.actor_id, h.actor_role, h.action, 'homepage.section', h.section_id,
       h.previous_data, h.new_data, h.reason,
       coalesce(nullif(h.reason, ''), 'Conteudo da pagina inicial alterado'),
       'conteudo', case when h.actor_id is null then 'system' else 'person' end,
       'homepage-audit:' || h.id::text, h.created_at
from public.home_section_audit_logs h
on conflict (event_key) where event_key is not null do nothing;

create or replace function public.activity_log_page(
  p_page integer default 1,
  p_page_size integer default 20,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_actor uuid default null,
  p_action text default null,
  p_module text default null,
  p_origin text default null,
  p_search text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
  safe_page integer := greatest(1, least(coalesce(p_page, 1), 100000));
  safe_size integer := greatest(1, least(coalesce(p_page_size, 20), 50));
  safe_search text := nullif(left(trim(coalesce(p_search, '')), 100), '');
begin
  perform private.require_permission('audit.read');
  if p_to is not null and p_from is not null and p_to <= p_from then
    raise exception 'invalid audit period';
  end if;

  with filtered as materialized (
    select l.*
    from public.audit_logs l
    where (p_from is null or l.created_at >= p_from)
      and (p_to is null or l.created_at < p_to)
      and (p_actor is null or l.actor_id = p_actor)
      and (nullif(p_action, '') is null or l.action_type = p_action)
      and (nullif(p_module, '') is null or l.module = p_module)
      and (nullif(p_origin, '') is null or l.origin_type = p_origin)
      and (
        safe_search is null
        or l.search_document @@ plainto_tsquery('simple'::regconfig, safe_search)
        or l.entity_id::text ilike '%' || safe_search || '%'
        or l.id::text ilike '%' || safe_search || '%'
      )
  ), page_rows as (
    select * from filtered order by created_at desc, id desc
    limit safe_size offset ((safe_page - 1) * safe_size)
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(to_jsonb(page_rows) - 'search_document' - 'transaction_id' order by created_at desc, id desc) from page_rows), '[]'::jsonb),
    'total', (select count(*) from filtered),
    'page', safe_page,
    'pageSize', safe_size,
    'summary', jsonb_build_object(
      'today', (select count(*) from public.audit_logs where created_at >= (date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')),
      'last7Days', (select count(*) from public.audit_logs where created_at >= ((date_trunc('day', now() at time zone 'America/Sao_Paulo') - interval '6 days') at time zone 'America/Sao_Paulo')),
      'deletions', (select count(*) from public.audit_logs where action_type = 'DELETE'),
      'financial', (select count(*) from public.audit_logs where module = 'financeiro'),
      'administrative', (select count(*) from public.audit_logs where module in ('acessos','sistema') or actor_role in ('admin','manager'))
    ),
    'filters', jsonb_build_object(
      'actors', coalesce((select jsonb_agg(value order by value->>'name') from (select distinct on (actor_id) jsonb_build_object('id',actor_id,'name',coalesce(actor_name_snapshot,'Usuario removido'),'email',actor_email_snapshot) value from public.audit_logs where actor_id is not null order by actor_id,created_at desc limit 250) actors), '[]'::jsonb),
      'actions', coalesce((select jsonb_agg(value order by value) from (select distinct action_type value from public.audit_logs) actions), '[]'::jsonb),
      'modules', coalesce((select jsonb_agg(value order by value) from (select distinct module value from public.audit_logs where module is not null) modules), '[]'::jsonb),
      'origins', '["person","system","integration"]'::jsonb
    ),
    'capabilities', jsonb_build_object('export', private.has_permission('reports.export'))
  ) into result;
  return result;
end;
$$;

create or replace function public.export_activity_logs(
  p_from timestamptz,
  p_to timestamptz,
  p_actor uuid default null,
  p_action text default null,
  p_module text default null,
  p_origin text default null,
  p_search text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  exported_count integer;
  safe_search text := nullif(left(trim(coalesce(p_search, '')), 100), '');
begin
  perform private.require_permission('audit.read');
  perform private.require_permission('reports.export');
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '366 days' then
    raise exception 'a valid export period of at most 366 days is required';
  end if;

  with exported as (
    select l.id, l.created_at, l.actor_name_snapshot, l.actor_email_snapshot, l.actor_role,
           l.action_type, l.action, l.module, l.entity_type, l.entity_id, l.entity_label,
           l.description, l.origin_type, l.origin_name, l.changed_fields, l.reason
    from public.audit_logs l
    where l.created_at >= p_from and l.created_at < p_to
      and (p_actor is null or l.actor_id = p_actor)
      and (nullif(p_action, '') is null or l.action_type = p_action)
      and (nullif(p_module, '') is null or l.module = p_module)
      and (nullif(p_origin, '') is null or l.origin_type = p_origin)
      and (safe_search is null or l.search_document @@ plainto_tsquery('simple'::regconfig, safe_search) or l.entity_id::text ilike '%' || safe_search || '%')
    order by l.created_at desc, l.id desc
    limit 5001
  )
  select jsonb_build_object(
    'items', coalesce(jsonb_agg(to_jsonb(exported) - 'row_number' order by created_at desc, id desc) filter (where row_number <= 5000), '[]'::jsonb),
    'truncated', count(*) > 5000
  ), least(count(*), 5000)::integer
  into result, exported_count
  from (select exported.*, row_number() over () from exported) exported;

  insert into public.audit_logs(
    actor_id, actor_role, action, action_type, entity_type, module, description,
    origin_type, new_data_sanitized, reason
  ) values (
    auth.uid(), private.current_app_role(), 'audit.exported', 'EXPORT', 'audit_logs', 'sistema',
    'Exportacao filtrada dos logs de atividades', 'person',
    jsonb_build_object('from',p_from,'to',p_to,'actor',p_actor,'action',p_action,'module',p_module,'origin',p_origin,'searchApplied',safe_search is not null,'rows',exported_count),
    'Exportacao de auditoria solicitada pelo painel gerencial'
  );

  return result;
end;
$$;

revoke all on function public.activity_log_page(integer,integer,timestamptz,timestamptz,uuid,text,text,text,text) from public, anon;
grant execute on function public.activity_log_page(integer,integer,timestamptz,timestamptz,uuid,text,text,text,text) to authenticated;
revoke all on function public.export_activity_logs(timestamptz,timestamptz,uuid,text,text,text,text) from public, anon;
grant execute on function public.export_activity_logs(timestamptz,timestamptz,uuid,text,text,text,text) to authenticated;

create or replace function private.reject_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit logs are immutable' using errcode = '42501';
end;
$$;

drop trigger if exists reject_audit_mutation on public.audit_logs;
create trigger reject_audit_mutation
before update or delete on public.audit_logs
for each row execute function private.reject_audit_mutation();

alter table public.audit_logs enable row level security;
revoke insert, update, delete, truncate on public.audit_logs from public, anon, authenticated;
grant select on public.audit_logs to authenticated;

revoke all on function private.sanitize_audit_json(jsonb,integer) from public, anon, authenticated;
revoke all on function private.audit_changed_fields(jsonb,jsonb) from public, anon, authenticated;
revoke all on function private.audit_action_type(text) from public, anon, authenticated;
revoke all on function private.audit_module(text) from public, anon, authenticated;
revoke all on function private.prepare_audit_log() from public, anon, authenticated;
revoke all on function private.capture_critical_row_audit() from public, anon, authenticated;
revoke all on function private.mirror_homepage_audit() from public, anon, authenticated;
revoke all on function private.reject_audit_mutation() from public, anon, authenticated;

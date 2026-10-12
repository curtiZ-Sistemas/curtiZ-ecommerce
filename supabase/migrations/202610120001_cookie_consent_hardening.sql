begin;

-- Consentimento de cookies: prova imutável, proteção do registro e vínculo com a coleta opcional.
--
-- 1. record_cookie_consent valida categorias e versão no banco (a RPC é chamável diretamente pela
--    chave pública), não altera registro que pertence a outra conta e grava cada decisão em
--    private.cookie_consent_events (histórico de aceite, recusa, alteração e retirada).
-- 2. ingest_intelligence_events passa a exigir o identificador de um consentimento registrado,
--    vigente (12 meses), da política publicada atual e com analytics autorizado. A versão antiga,
--    que aceitava p_consent=true sem prova, passa a não coletar nada (falha fechada).
-- 3. A retirada de analytics apaga no servidor os eventos e perfis vinculados ao consentimento,
--    de todas as abas e sessões deste navegador; envios atrasados são recusados pelo item 2.
-- 4. Inventário: remove duplicidades legadas e declara armazenamentos e SDKs essenciais reais.

create table if not exists private.cookie_consent_events (
  id bigint generated always as identity primary key,
  consent_id uuid not null,
  user_id uuid references public.profiles(id) on delete set null,
  policy_version text not null,
  categories jsonb not null check (jsonb_typeof(categories) = 'object'),
  origin text not null check (origin in ('banner','preferences','account')),
  action text not null check (action in ('granted','rejected','updated','revoked')),
  recorded_at timestamptz not null default now()
);
create index if not exists cookie_consent_events_consent_idx
  on private.cookie_consent_events(consent_id, recorded_at desc);
revoke all on private.cookie_consent_events from public, anon, authenticated;

alter table public.marketing_events add column if not exists consent_id uuid;
create index if not exists marketing_events_consent_idx
  on public.marketing_events(consent_id) where consent_id is not null;

-- Prefixo da versão vigente: "cookies-v<n>-" com política publicada, "cookies-draft-" sem publicação.
create or replace function private.current_cookie_policy_prefix()
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select 'cookies-v' || published.version::text || '-'
       from public.published_legal_documents published
      where published.slug = 'politica-de-cookies' limit 1),
    'cookies-draft-');
$$;

create or replace function private.cookie_consent_allows(p_consent_id uuid, p_category text)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_consent_id is not null and p_category in ('preferences','analytics','marketing') and exists (
    select 1 from public.cookie_consents consent
    where consent.id = p_consent_id
      and consent.categories ->> p_category = 'true'
      and consent.updated_at > pg_catalog.now() - interval '365 days'
      and pg_catalog.starts_with(consent.policy_version, private.current_cookie_policy_prefix())
  );
$$;
revoke all on function private.current_cookie_policy_prefix(), private.cookie_consent_allows(uuid,text)
  from public, anon, authenticated;

create or replace function public.record_cookie_consent(
  p_id uuid,
  p_policy_version text,
  p_categories jsonb,
  p_origin text,
  p_revoked boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous public.cookie_consents%rowtype;
  normalized jsonb;
  withdrawn boolean := false;
  any_optional boolean;
  v_action text;
begin
  if p_id is null or pg_catalog.jsonb_typeof(p_categories) <> 'object'
    or p_policy_version is null or p_policy_version !~ '^[a-z0-9][a-z0-9.-]{0,59}$'
    or p_origin is null or p_origin not in ('banner', 'preferences', 'account')
    or exists (
      select 1 from pg_catalog.jsonb_each(p_categories) entry
      where entry.key not in ('essential','preferences','functional','analytics','marketing')
         or pg_catalog.jsonb_typeof(entry.value) <> 'boolean')
    or p_categories -> 'essential' is distinct from 'true'::jsonb then
    raise exception 'invalid cookie consent' using errcode = '22023';
  end if;

  -- Categoria ausente vale como recusada (nunca nula).
  normalized := pg_catalog.jsonb_build_object(
    'essential', true,
    'preferences', coalesce(p_categories -> 'preferences' = 'true'::jsonb or p_categories -> 'functional' = 'true'::jsonb, false),
    'analytics', coalesce(p_categories -> 'analytics' = 'true'::jsonb, false),
    'marketing', coalesce(p_categories -> 'marketing' = 'true'::jsonb, false));
  any_optional := (normalized ->> 'preferences')::boolean or (normalized ->> 'analytics')::boolean
    or (normalized ->> 'marketing')::boolean;

  select * into previous from public.cookie_consents consent where consent.id = p_id for update;
  if found then
    -- Um registro vinculado a uma conta só é alterado pela própria conta.
    if previous.user_id is not null and previous.user_id is distinct from auth.uid() then
      raise exception 'cookie consent belongs to another account' using errcode = '42501';
    end if;
    withdrawn := exists (
      select 1 from pg_catalog.jsonb_each(previous.categories) entry
      where entry.key in ('preferences','functional','analytics','marketing')
        and entry.value = 'true'::jsonb
        and normalized -> (case when entry.key = 'functional' then 'preferences' else entry.key end) <> 'true'::jsonb);
  end if;

  v_action := case
    when withdrawn then 'revoked'
    when previous.id is null and not any_optional then 'rejected'
    when previous.id is null then 'granted'
    else 'updated' end;

  insert into public.cookie_consents(id, user_id, policy_version, categories, origin, revoked)
  values (p_id, auth.uid(), p_policy_version, normalized, p_origin, withdrawn)
  on conflict (id) do update set
    user_id = coalesce(public.cookie_consents.user_id, auth.uid()),
    policy_version = excluded.policy_version,
    categories = excluded.categories,
    origin = excluded.origin,
    revoked = excluded.revoked,
    updated_at = pg_catalog.now();

  insert into private.cookie_consent_events(consent_id, user_id, policy_version, categories, origin, action)
  values (p_id, auth.uid(), p_policy_version, normalized, p_origin, v_action);

  -- Retirada da medição: apaga eventos e perfis de interesse vinculados a este consentimento.
  if previous.id is not null and previous.categories ->> 'analytics' = 'true'
    and normalized ->> 'analytics' <> 'true' then
    delete from public.session_interest_profiles profile
    where profile.session_id in (
      select distinct event.anonymous_session_id from public.marketing_events event
      where event.consent_id = p_id and event.anonymous_session_id is not null);
    delete from public.marketing_events event where event.consent_id = p_id;
  end if;
end;
$$;

revoke all on function public.record_cookie_consent(uuid, text, jsonb, text, boolean) from public;
grant execute on function public.record_cookie_consent(uuid, text, jsonb, text, boolean)
  to anon, authenticated;

-- Versão sem prova de consentimento: mantida só para não quebrar chamadas antigas, sem coletar.
create or replace function public.ingest_intelligence_events(p_session_id uuid, p_events jsonb, p_consent boolean)
returns jsonb language sql stable security definer set search_path = ''
as $$ select pg_catalog.jsonb_build_object('accepted', 0, 'enabled', false) $$;
revoke all on function public.ingest_intelligence_events(uuid,jsonb,boolean) from public;
grant execute on function public.ingest_intelligence_events(uuid,jsonb,boolean) to anon,authenticated;

create or replace function public.ingest_intelligence_events(p_session_id uuid, p_events jsonb, p_consent boolean, p_consent_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare event jsonb; v_type text; v_product uuid; v_query text; v_source text; v_time timestamptz; v_inserted integer:=0; v_window timestamptz;
declare allowed_types constant text[]:=array['page_view','product_impression','product_view','image_interaction','variant_select','category_view','search','search_no_results','search_result_click','recommendation_impression','recommendation_click','favorite_add','favorite_remove','cart_add','cart_remove','checkout_start'];
begin
  if not p_consent or not private.cookie_consent_allows(p_consent_id,'analytics')
    or not private.intelligence_flag_enabled('intelligence.tracking') then return jsonb_build_object('accepted',0,'enabled',false); end if;
  if p_session_id is null or jsonb_typeof(p_events)<>'array' or jsonb_array_length(p_events) not between 1 and 20 then raise exception 'invalid intelligence batch'; end if;
  v_window:=date_trunc('minute',clock_timestamp());
  insert into private.intelligence_rate_buckets(session_id,window_start,event_count) values(p_session_id,v_window,jsonb_array_length(p_events))
  on conflict(session_id,window_start) do update set event_count=private.intelligence_rate_buckets.event_count+excluded.event_count
    where private.intelligence_rate_buckets.event_count+excluded.event_count<=120;
  if not found then raise exception 'intelligence rate limit exceeded' using errcode='P0001'; end if;
  for event in select value from jsonb_array_elements(p_events) loop
    v_type:=event->>'type';
    if not (v_type=any(allowed_types)) then raise exception 'unsupported intelligence event'; end if;
    v_product:=nullif(event->>'productId','')::uuid;
    if v_product is not null and not exists(select 1 from public.products product where product.id=v_product and product.status='active') then continue; end if;
    v_query:=case when v_type in ('search','search_no_results','search_result_click') then left(lower(regexp_replace(trim(coalesce(event->>'query','')), '\s+', ' ', 'g')),120) else null end;
    if v_type in ('search','search_no_results','search_result_click') and coalesce(v_query,'')='' then continue; end if;
    v_source:=case when v_type like 'recommendation_%' then left(regexp_replace(coalesce(event->>'source','unknown'),'[^a-z0-9_-]','','g'),40) else null end;
    v_time:=least(clock_timestamp(),greatest(clock_timestamp()-interval '1 day',coalesce((event->>'occurredAt')::timestamptz,clock_timestamp())));
    insert into public.marketing_events(client_event_id,consent_id,user_id,anonymous_session_id,event_type,product_id,device_category,context_sanitized,occurred_at,event_weight,search_query,recommendation_source,event_bucket)
    values((event->>'id')::uuid,p_consent_id,auth.uid(),p_session_id,v_type,v_product,
      case when event->>'device' in ('mobile','tablet','desktop') then event->>'device' else null end,
      jsonb_strip_nulls(jsonb_build_object('path',left(event->>'path',200),'variantId',nullif(event->>'variantId','')::uuid,'resultCount',least(greatest(coalesce((event->>'resultCount')::integer,0),0),10000))),
      v_time,private.intelligence_event_weight(v_type),v_query,v_source,floor(extract(epoch from v_time)/30)::bigint)
    on conflict do nothing;
    if found then v_inserted:=v_inserted+1; end if;
  end loop;
  return jsonb_build_object('accepted',v_inserted,'enabled',true);
end $$;
revoke all on function public.ingest_intelligence_events(uuid,jsonb,boolean,uuid) from public;
grant execute on function public.ingest_intelligence_events(uuid,jsonb,boolean,uuid) to anon,authenticated;

-- Inventário: duplicidades legadas de 08/2026 (provider "Curtiz" e padrão sem curinga).
update public.cookie_definitions legacy
set active = false
where legacy.active
  and (legacy.provider = 'Curtiz' or (legacy.name_pattern = 'sb-*-auth-token' and legacy.provider = 'Supabase Auth'))
  and exists (
    select 1 from public.cookie_definitions current_definition
    where current_definition.active and current_definition.id <> legacy.id
      and current_definition.provider in ('curti Z', 'Supabase Auth')
      and (current_definition.name_pattern = legacy.name_pattern
        or (legacy.name_pattern = 'sb-*-auth-token' and current_definition.name_pattern = 'sb-*-auth-token*')));

insert into public.cookie_definitions(
  name_pattern, category_id, provider, purpose, duration_description, first_party, storage_type, active, last_verified_at
)
values
  ('curtiz-auth-session', 'essential', 'curti Z',
    'Indica que o acesso escolhido no login vale apenas para esta sessão do navegador.',
    'Durante a sessão atual.', true, 'session_storage', true, now()),
  ('curtiz-account-closed', 'essential', 'curti Z',
    'Avisa as abas abertas que a conta foi excluída, para limpar carrinho e sessão locais.',
    'Até a limpeza do navegador.', true, 'local_storage', true, now()),
  ('curtiz-checkout-idempotency / curtiz-pending-order-cleanup / curtiz-payment-attempt:*', 'essential', 'curti Z',
    'Evita pedidos e cobranças duplicados e retoma com segurança um pagamento em andamento.',
    'Durante a sessão atual.', true, 'session_storage', true, now()),
  ('SDK de pagamento Mercado Pago', 'essential', 'Mercado Pago',
    'Processa o pagamento solicitado e pode definir cookies e identificadores do dispositivo para prevenção a fraudes. Carregado somente na etapa de pagamento.',
    'Definida pelo Mercado Pago.', false, 'cookie', true, now()),
  ('Cloudflare Turnstile', 'essential', 'Cloudflare',
    'Protege login, cadastro e recuperação de senha contra automação abusiva. Carregado somente nesses formulários, quando ativado.',
    'Definida pela Cloudflare.', false, 'cookie', true, now())
on conflict (name_pattern, provider) do update set
  category_id = excluded.category_id,
  purpose = excluded.purpose,
  duration_description = excluded.duration_description,
  first_party = excluded.first_party,
  storage_type = excluded.storage_type,
  active = excluded.active,
  last_verified_at = excluded.last_verified_at;

update public.cookie_definitions
set purpose = 'Comprova ao servidor, com assinatura, as categorias autorizadas e a versão da política.',
    last_verified_at = now()
where name_pattern = 'curtiz-cookie-preferences' and provider = 'curti Z';

update public.cookie_definitions
set purpose = 'Aplica a duração de sessão escolhida no login (cookie e marcador no armazenamento local).',
    last_verified_at = now()
where name_pattern = 'curtiz-auth-persistence' and provider = 'curti Z';

notify pgrst, 'reload schema';

commit;

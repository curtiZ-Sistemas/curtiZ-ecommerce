begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

insert into auth.users(id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('cc000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
  'consent-owner@test.local','{}','{}',now(),now());
update public.profiles set status = 'active' where id = 'cc000000-0000-4000-8000-000000000001';
insert into public.feature_flags(key, enabled) values ('intelligence.tracking', true)
  on conflict (key) do update set enabled = true;

create function pg_temp.page_view(p_id text) returns jsonb language sql as $$
  select pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'id', p_id, 'type', 'page_view', 'occurredAt', pg_catalog.now(), 'device', 'mobile', 'path', '/'))
$$;

-- Visitante anônimo (mesmo caminho da rota /api/privacy/cookies).
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select throws_ok($$select public.record_cookie_consent('cc100000-0000-4000-8000-000000000001','cookies-draft-inventory-3',
  '{"essential":true,"tracking":true}'::jsonb,'banner',false)$$, '22023', null, 'Categoria desconhecida é recusada no banco');
select throws_ok($$select public.record_cookie_consent('cc100000-0000-4000-8000-000000000001','cookies-draft-inventory-3',
  '{"essential":true,"analytics":"yes"}'::jsonb,'banner',false)$$, '22023', null, 'Valor não booleano é recusado no banco');
select throws_ok($$select public.record_cookie_consent('cc100000-0000-4000-8000-000000000001','cookies-draft-inventory-3',
  '{"essential":false}'::jsonb,'banner',false)$$, '22023', null, 'Categoria essencial não pode ser desativada');
select throws_ok($$select public.record_cookie_consent('cc100000-0000-4000-8000-000000000001','<script>',
  '{"essential":true}'::jsonb,'banner',false)$$, '22023', null, 'Versão de política inválida é recusada');

select lives_ok($$select public.record_cookie_consent('cc100000-0000-4000-8000-000000000001','cookies-draft-inventory-3',
  '{"essential":true,"preferences":false,"analytics":false}'::jsonb,'banner',false)$$, 'Primeira recusa registrada');

-- Antes da autorização nada é coletado, nem mesmo pela versão antiga da RPC.
select is(public.ingest_intelligence_events('cc200000-0000-4000-8000-000000000001',
  pg_temp.page_view('cc300000-0000-4000-8000-000000000001'),true,'cc100000-0000-4000-8000-000000000001') ->> 'enabled',
  'false', 'Recusa não permite coleta');
select is(public.ingest_intelligence_events('cc200000-0000-4000-8000-000000000001',
  pg_temp.page_view('cc300000-0000-4000-8000-000000000002'),true) ->> 'enabled',
  'false', 'Assinatura antiga sem prova de consentimento não coleta');
select is(public.ingest_intelligence_events('cc200000-0000-4000-8000-000000000001',
  pg_temp.page_view('cc300000-0000-4000-8000-000000000003'),true,'cc100000-0000-4000-8000-0000000000ff') ->> 'enabled',
  'false', 'Consentimento inexistente não coleta');

select lives_ok($$select public.record_cookie_consent('cc100000-0000-4000-8000-000000000001','cookies-draft-inventory-3',
  '{"essential":true,"preferences":true,"analytics":true}'::jsonb,'preferences',false)$$, 'Aceite posterior registrado');
select is(public.ingest_intelligence_events('cc200000-0000-4000-8000-000000000001',
  pg_temp.page_view('cc300000-0000-4000-8000-000000000004'),true,'cc100000-0000-4000-8000-000000000001') ->> 'accepted',
  '1', 'Consentimento vigente com analytics permite a coleta');
select is(public.ingest_intelligence_events('cc200000-0000-4000-8000-000000000002',
  pg_temp.page_view('cc300000-0000-4000-8000-000000000005'),true,'cc100000-0000-4000-8000-000000000001') ->> 'accepted',
  '1', 'Outra aba do mesmo navegador também coleta');

-- Retirada da medição.
select lives_ok($$select public.record_cookie_consent('cc100000-0000-4000-8000-000000000001','cookies-draft-inventory-3',
  '{"essential":true,"preferences":true,"analytics":false}'::jsonb,'preferences',false)$$, 'Retirada da medição registrada');
select is(public.ingest_intelligence_events('cc200000-0000-4000-8000-000000000001',
  pg_temp.page_view('cc300000-0000-4000-8000-000000000006'),true,'cc100000-0000-4000-8000-000000000001') ->> 'enabled',
  'false', 'Envio atrasado após a retirada é recusado');

reset role;
select is((select count(*)::integer from public.marketing_events where consent_id = 'cc100000-0000-4000-8000-000000000001'),
  0, 'Retirada apaga os eventos de todas as sessões vinculadas');
select is((select array_agg(action order by id)::text from private.cookie_consent_events
  where consent_id = 'cc100000-0000-4000-8000-000000000001'),
  '{rejected,updated,revoked}', 'Histórico imutável registra recusa, aceite e retirada');
select is((select revoked from public.cookie_consents where id = 'cc100000-0000-4000-8000-000000000001'),
  true, 'Registro atual marca a retirada');
select is((select categories from public.cookie_consents where id = 'cc100000-0000-4000-8000-000000000001'),
  '{"essential":true,"preferences":true,"analytics":false,"marketing":false}'::jsonb, 'Categorias gravadas normalizadas');

-- Escolha expirada ou de política anterior deixa de autorizar.
insert into public.cookie_consents(id, policy_version, categories, origin, revoked, updated_at)
values ('cc100000-0000-4000-8000-000000000002','cookies-draft-inventory-3',
    '{"essential":true,"analytics":true}'::jsonb,'banner',false, now() - interval '366 days'),
  ('cc100000-0000-4000-8000-000000000003','cookies-v0-inventory-2',
    '{"essential":true,"analytics":true}'::jsonb,'banner',false, now());
select ok(not private.cookie_consent_allows('cc100000-0000-4000-8000-000000000002','analytics'),
  'Consentimento com mais de 12 meses não autoriza');
select ok(not private.cookie_consent_allows('cc100000-0000-4000-8000-000000000003','analytics'),
  'Consentimento de outra versão da política não autoriza');

-- Registro vinculado a uma conta não pode ser alterado por outra pessoa.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"cc000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}', true);
select lives_ok($$select public.record_cookie_consent('cc100000-0000-4000-8000-000000000004','cookies-draft-inventory-3',
  '{"essential":true,"analytics":true}'::jsonb,'account',false)$$, 'Cliente registra a própria escolha');
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$select public.record_cookie_consent('cc100000-0000-4000-8000-000000000004','cookies-draft-inventory-3',
  '{"essential":true,"analytics":false}'::jsonb,'banner',false)$$, '42501', null,
  'Visitante anônimo não altera escolha vinculada a uma conta');
select throws_ok($$select count(*) from private.cookie_consent_events$$, '42501', null,
  'Histórico de consentimento não é exposto ao visitante');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"cc000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}', true);
select throws_ok($$select count(*) from private.cookie_consent_events$$, '42501', null,
  'Histórico de consentimento não é exposto ao cliente');
select throws_ok($$select private.cookie_consent_allows('cc100000-0000-4000-8000-000000000004','analytics')$$, '42501', null,
  'Verificação interna de consentimento não é chamável pelo cliente');
reset role;

select * from finish();
rollback;

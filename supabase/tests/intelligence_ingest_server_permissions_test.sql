begin;
create extension if not exists pgtap with schema extensions;
select plan(5);
select ok(not has_function_privilege('anon','public.ingest_intelligence_events(uuid,jsonb,boolean)','execute'), 'anonymous callers cannot bypass consent');
select ok(not has_function_privilege('authenticated','public.ingest_intelligence_events(uuid,jsonb,boolean)','execute'), 'users cannot bypass consent');
select ok(not has_function_privilege('authenticated','public.ingest_intelligence_events_server(uuid,jsonb,uuid)','execute'), 'users cannot impersonate the server');
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
values ('f8100000-0000-4000-8000-000000000001','intelligence-fixture@example.invalid','{}','{}');
insert into public.feature_flags(key,enabled) values ('intelligence.tracking',true)
on conflict(key) do update set enabled=true;
set local role service_role;
select lives_ok($$select public.ingest_intelligence_events_server('f8200000-0000-4000-8000-000000000001',
  '[{"id":"f8300000-0000-4000-8000-000000000001","type":"page_view","device":"mobile"}]',
  'f8100000-0000-4000-8000-000000000001')$$,'server can ingest events');
select is((select user_id::text from public.marketing_events where client_event_id='f8300000-0000-4000-8000-000000000001'),
  'f8100000-0000-4000-8000-000000000001','ingestion preserves verified identity');
select * from finish();
rollback;

begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

insert into auth.users(id,instance_id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('c7300000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','draft-admin-a@test.local','{}','{}',now(),now()),
 ('c7300000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','draft-admin-b@test.local','{}','{}',now(),now()),
 ('c7300000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','draft-customer@test.local','{}','{}',now(),now());
update public.profiles set status='active' where id in
 ('c7300000-0000-4000-8000-000000000001','c7300000-0000-4000-8000-000000000002','c7300000-0000-4000-8000-000000000003');
insert into public.user_roles(user_id,role) values
 ('c7300000-0000-4000-8000-000000000001','admin'),
 ('c7300000-0000-4000-8000-000000000002','admin'),
 ('c7300000-0000-4000-8000-000000000003','customer') on conflict do nothing;

select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.product_editor_drafts'::regclass),
  'Draft table enables and forces RLS');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"c7300000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
select is((select count(*) from public.product_editor_drafts),0::bigint,'User starts without a draft');
select lives_ok($sql$ select public.save_product_editor_draft(1,'{"schemaVersion":1,"savedAt":"2026-09-20T12:00:00.000Z","fields":{"name":"Primeiro"}}'::jsonb,'2026-09-20T12:00:00.000Z') $sql$,
  'First autosave creates the draft');
select is((select count(*) from public.product_editor_drafts),1::bigint,'First autosave creates one row');
select lives_ok($sql$ select public.save_product_editor_draft(1,'{"schemaVersion":1,"savedAt":"2026-09-20T12:01:00.000Z","fields":{"name":"Segundo"}}'::jsonb,'2026-09-20T12:01:00.000Z') $sql$,
  'Second autosave replaces the draft');
select lives_ok($sql$ select public.save_product_editor_draft(1,'{"schemaVersion":1,"savedAt":"2026-09-20T12:02:00.000Z","fields":{"name":"Terceiro"}}'::jsonb,'2026-09-20T12:02:00.000Z') $sql$,
  'Third autosave replaces the draft');
select is((select count(*) from public.product_editor_drafts),1::bigint,'Repeated autosaves still keep one row');
select is((select payload->'fields'->>'name' from public.product_editor_drafts),'Terceiro','Latest autosave wins');
select lives_ok($sql$ select public.save_product_editor_draft(1,'{"schemaVersion":1,"savedAt":"2026-09-20T12:01:30.000Z","fields":{"name":"Atrasado"}}'::jsonb,'2026-09-20T12:01:30.000Z') $sql$,
  'An older in-flight autosave is accepted without overwriting');
select is((select payload->'fields'->>'name' from public.product_editor_drafts),'Terceiro','Older request cannot overwrite newer data');

select set_config('request.jwt.claims','{"sub":"c7300000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',true);
select is((select count(*) from public.product_editor_drafts),0::bigint,'User B cannot read user A draft');
update public.product_editor_drafts set payload='{"tampered":true}'::jsonb where user_id='c7300000-0000-4000-8000-000000000001';
delete from public.product_editor_drafts where user_id='c7300000-0000-4000-8000-000000000001';

select set_config('request.jwt.claims','{"sub":"c7300000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
select is((select count(*) from public.product_editor_drafts),1::bigint,'User B cannot delete user A draft');
select is((select payload->'fields'->>'name' from public.product_editor_drafts),'Terceiro','User B cannot alter user A draft');

select set_config('request.jwt.claims','{"sub":"c7300000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal1"}',true);
select throws_ok($sql$ select public.save_product_editor_draft(1,'{"schemaVersion":1}'::jsonb,now()) $sql$,'42501',null,
  'User without product permissions cannot save an administrative draft');

select set_config('request.jwt.claims','{"sub":"c7300000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
select throws_ok($sql$
  select public.admin_save_product_authorized_and_clear_draft(
    '{"name":"X","slug":"draft-wrapper-invalid","status":"active","variants":[]}'::jsonb
  )
$sql$,'P0001','active product is incomplete','Failed product save raises before draft cleanup');
select is((select count(*) from public.product_editor_drafts),1::bigint,'Failed product save keeps the draft');
select lives_ok($sql$
  select public.admin_save_product_authorized_and_clear_draft(
    '{"name":"Draft wrapper product","slug":"draft-wrapper-product","status":"draft","stockReason":"Cadastro de teste","variants":[]}'::jsonb
  )
$sql$,'Successful new product save completes through the draft-clearing wrapper');
select is((select count(*) from public.product_editor_drafts),0::bigint,'Successful new product save removes the draft atomically');
select lives_ok($sql$
  select public.save_product_editor_draft(1,'{"schemaVersion":1,"savedAt":"2026-09-20T12:03:00.000Z","fields":{"name":"Excluir"}}'::jsonb,'2026-09-20T12:03:00.000Z')
$sql$,'Owner can create another draft before explicit discard');
delete from public.product_editor_drafts;
select is((select count(*) from public.product_editor_drafts),0::bigint,'Owner can delete the draft permanently');

select * from finish();
rollback;

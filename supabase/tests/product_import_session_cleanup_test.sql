begin;
create extension if not exists pgtap with schema extensions;
select plan(8);
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
values ('cd000000-0000-4000-8000-000000000001','import-cleanup-admin@example.invalid','{}','{}'),
  ('cd000000-0000-4000-8000-000000000002','import-cleanup-customer@example.invalid','{}','{}');
update public.profiles set status='active' where id in
  ('cd000000-0000-4000-8000-000000000001','cd000000-0000-4000-8000-000000000002');
insert into public.user_roles(user_id,role) values
  ('cd000000-0000-4000-8000-000000000001','admin'),
  ('cd000000-0000-4000-8000-000000000002','customer') on conflict do nothing;
insert into public.product_import_sessions(id,user_id,schema_version,batch_hash,payload,created_at,expires_at)
values ('cd100000-0000-4000-8000-000000000001','cd000000-0000-4000-8000-000000000001','curtiz_import_v1',repeat('a',64),'{"batch":{"products":[{}]}}',now()-interval '2 hours',now()-interval '1 hour'),
  ('cd100000-0000-4000-8000-000000000002','cd000000-0000-4000-8000-000000000001','curtiz_import_v1',repeat('b',64),'{"batch":{"products":[{}]}}',now(),now()+interval '1 hour'),
  ('cd100000-0000-4000-8000-000000000003','cd000000-0000-4000-8000-000000000002','curtiz_import_v1',repeat('c',64),'{"batch":{"products":[{}]}}',now()-interval '2 hours',now()-interval '1 hour');
select ok(not has_function_privilege('anon','public.delete_product_import_sessions(uuid)','execute'),'Anonymous deletion is denied');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"cd000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
select is((select count(*) from public.product_import_sessions where id='cd100000-0000-4000-8000-000000000001'),0::bigint,'Expired payload remains invisible');
select is(public.delete_product_import_sessions('cd100000-0000-4000-8000-000000000003'),0,'Caller cannot delete another owner session');
select is(public.delete_product_import_sessions(null),1,'Cleanup deletes only caller expired session');
select is((select count(*) from public.product_import_sessions where id='cd100000-0000-4000-8000-000000000002'),1::bigint,'Live session remains usable');
select set_config('request.jwt.claims','{"sub":"cd000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}',true);
select throws_ok($$select public.delete_product_import_sessions(null)$$,'42501','permission denied','Customer cannot invoke import cleanup');
reset role;
select is((select count(*) from public.product_import_sessions where id='cd100000-0000-4000-8000-000000000001'),0::bigint,'Expired row was actually deleted');
select is((select count(*) from public.product_import_sessions where id='cd100000-0000-4000-8000-000000000003'),1::bigint,'Other owner row is preserved');
select * from finish();
rollback;

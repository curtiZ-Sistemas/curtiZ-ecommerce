begin;
create extension if not exists pgtap with schema extensions;
select plan(3);
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
values ('f7100000-0000-4000-8000-000000000001','help-feedback@example.invalid','{}','{}');
insert into public.support_categories(id,name,slug,active,public_visible)
values ('f7200000-0000-4000-8000-000000000001','Fixture','fixture-feedback',true,true);
insert into public.help_contents(id,category_id,content_type,slug,title,author_id,audiences,status)
values ('f7300000-0000-4000-8000-000000000001','f7200000-0000-4000-8000-000000000001',
  'article','fixture-feedback','Fixture','f7100000-0000-4000-8000-000000000001',array['visitor'],'published');
insert into public.help_content_versions(id,content_id,version,snapshot,change_summary,status,created_by)
values ('f7400000-0000-4000-8000-000000000001','f7300000-0000-4000-8000-000000000001',1,
  '{"content":{"slug":"fixture-feedback","content_type":"article","audiences":["visitor"]},"category":{"name":"Fixture","slug":"fixture-feedback"},"related":[]}',
  'Fixture','published','f7100000-0000-4000-8000-000000000001');
update public.help_contents set published_version_id='f7400000-0000-4000-8000-000000000001'
where id='f7300000-0000-4000-8000-000000000001';
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select lives_ok($$select public.record_help_feedback_server('f7300000-0000-4000-8000-000000000001','f7500000-0000-4000-8000-000000000001','f7100000-0000-4000-8000-000000000001',true,null,null)$$,'server records feedback');
select is((select user_id::text from public.help_content_feedback where session_id='f7500000-0000-4000-8000-000000000001'),'f7100000-0000-4000-8000-000000000001','server preserves actor');
select throws_ok($$select public.record_help_feedback_server('f7300000-0000-4000-8000-000000000001','f7500000-0000-4000-8000-000000000001',null,false,null,null)$$,'42501',null,'another actor cannot overwrite feedback');
select * from finish();
rollback;

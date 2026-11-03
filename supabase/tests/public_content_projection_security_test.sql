begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users(id,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
values ('f7000000-0000-4000-8000-000000000001','public-projection@example.invalid','',now(),'{}','{}');

-- The test database is isolated and the whole fixture is rolled back.
update public.store_campaign_messages set active=false where active;
insert into public.store_campaign_messages(id,message_text,active,sort_order,starts_at,ends_at,created_by,updated_by) values
('f7100000-0000-4000-8000-000000000001','Mensagem publica vigente',true,0,now()-interval '1 day',now()+interval '1 day','f7000000-0000-4000-8000-000000000001','f7000000-0000-4000-8000-000000000001'),
('f7100000-0000-4000-8000-000000000002','Mensagem inativa privada',false,1,null,null,'f7000000-0000-4000-8000-000000000001','f7000000-0000-4000-8000-000000000001'),
('f7100000-0000-4000-8000-000000000003','Mensagem futura privada',true,2,now()+interval '1 day',now()+interval '2 days','f7000000-0000-4000-8000-000000000001','f7000000-0000-4000-8000-000000000001'),
('f7100000-0000-4000-8000-000000000004','Mensagem expirada privada',true,3,now()-interval '2 days',now()-interval '1 day','f7000000-0000-4000-8000-000000000001','f7000000-0000-4000-8000-000000000001');

select ok(not exists (
  select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in (
    'store_campaign_messages','help_content_versions','help_contents','home_page_versions','home_pages',
    'homepage_section_versions','homepage_sections','legal_document_versions','legal_documents'
  ) and has_any_column_privilege('anon',c.oid,'select')
),'anon has no direct column access to any underlying editorial table');

set local role anon;
select lives_ok('select count(*) from public.current_store_promotion_messages','anonymous visitors can read the promotion projection');
select lives_ok('select count(*) from public.published_homepage_sections','anonymous visitors can read published homepage sections');
select lives_ok('select count(*) from public.published_help_contents','anonymous visitors can read published help');
select lives_ok('select count(*) from public.published_legal_documents','anonymous visitors can read published policies');
select is((select array_agg(message_text order by sort_order) from public.current_store_promotion_messages),
  array['Mensagem publica vigente'],'anonymous visitors cannot see inactive, future or expired promotion messages');
select ok(not exists (
  select 1 from public.published_legal_documents
  where (snapshot->'document') ?| array['internal_name','internal_notes','responsible_id','reviewer_id','created_by','updated_by','approved_by']
),'published legal documents do not expose editorial identifiers or internal notes');

select * from finish();
rollback;

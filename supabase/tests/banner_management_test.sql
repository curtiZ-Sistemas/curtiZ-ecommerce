-- Transactional contract/RLS tests for an isolated migrated Supabase database.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into auth.users(id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
 ('ba000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','banner-admin@test.local','{}','{"full_name":"Banner test admin"}',now(),now()),
 ('ba000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','banner-customer@test.local','{}','{"full_name":"Banner test customer"}',now(),now());
update public.profiles set status = 'active' where id in ('ba000000-0000-4000-8000-000000000001','ba000000-0000-4000-8000-000000000002');
insert into public.user_roles(user_id,role) values ('ba000000-0000-4000-8000-000000000001','admin') on conflict do nothing;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"ba000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
select throws_ok($$insert into public.banners(image_path_desktop,image_path_mobile,destination_id) values ('test.webp','test.webp','produtos')$$,'22P02',null,'Old internal page slug reproduces UUID failure');
select throws_ok($$insert into public.banners(image_path_desktop,image_path_mobile,priority) values ('test.webp','test.webp',null)$$,'23502',null,'Explicit null bypasses priority default');
select lives_ok($$insert into public.banners(id,image_path_desktop,image_path_mobile,destination_type,destination_url,destination_type_mobile,destination_url_mobile) values ('bb000000-0000-4000-8000-000000000001','desktop.webp','mobile.webp','internal_page','/produtos','internal_page','/ofertas')$$,'Admin saves without legacy fields');
select is((select destination_id from public.banners where id='bb000000-0000-4000-8000-000000000001'),null::uuid,'Internal page does not require UUID');
select is((select destination_url_mobile from public.banners where id='bb000000-0000-4000-8000-000000000001'),'/ofertas','Mobile destination persisted independently');
select lives_ok($$update public.banners set position='home',status='published',image_path_mobile='replacement.webp' where id='bb000000-0000-4000-8000-000000000001'$$,'Admin replaces only mobile image');
select is((select image_path_desktop from public.banners where id='bb000000-0000-4000-8000-000000000001'),'desktop.webp','Desktop remains unchanged');

set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
select is((select count(*) from public.banners where id='bb000000-0000-4000-8000-000000000001'),1::bigint,'Visitor reads published banner');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"ba000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}',true);
select throws_ok($$insert into public.banners(image_path_desktop,image_path_mobile) values ('test.webp','test.webp')$$,'42501',null,'Customer cannot create');
select is((with changed as (update public.banners set destination_url='/ofertas' where id='bb000000-0000-4000-8000-000000000001' returning id) select count(*) from changed),0::bigint,'Customer cannot edit');
select is((with changed as (delete from public.banners where id='bb000000-0000-4000-8000-000000000001' returning id) select count(*) from changed),0::bigint,'Customer cannot delete');

select set_config('request.jwt.claims','{"sub":"ba000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
update public.banners set status='inactive' where id='bb000000-0000-4000-8000-000000000001';
set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
select is((select count(*) from public.banners where id='bb000000-0000-4000-8000-000000000001'),0::bigint,'Visitor cannot read inactive banner');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"ba000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
select is((with changed as (delete from public.banners where id='bb000000-0000-4000-8000-000000000001' returning id) select count(*) from changed),1::bigint,'Admin can delete');
select * from finish();
rollback;

begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values
 ('cc000000-0000-4000-8000-000000000001','package-representative@example.invalid','{}','{"full_name":"Package Representative"}'),
 ('cc000000-0000-4000-8000-000000000002','package-customer@example.invalid','{}','{"full_name":"Package Customer"}'),
 ('cc000000-0000-4000-8000-000000000003','package-admin@example.invalid','{}','{"full_name":"Package Admin"}');
update public.profiles set status='active' where id in (
 'cc000000-0000-4000-8000-000000000001','cc000000-0000-4000-8000-000000000002','cc000000-0000-4000-8000-000000000003');
delete from public.user_roles where user_id in (
 'cc000000-0000-4000-8000-000000000001','cc000000-0000-4000-8000-000000000002','cc000000-0000-4000-8000-000000000003');
insert into public.user_roles(user_id,role) values
 ('cc000000-0000-4000-8000-000000000001','representative'),
 ('cc000000-0000-4000-8000-000000000002','customer'),
 ('cc000000-0000-4000-8000-000000000003','admin');
insert into public.representative_applications(id,user_id) values
 ('cc100000-0000-4000-8000-000000000001','cc000000-0000-4000-8000-000000000001');
insert into public.representatives(user_id,application_id,status) values
 ('cc000000-0000-4000-8000-000000000001','cc100000-0000-4000-8000-000000000001','active');
insert into public.creative_campaigns(id,name,slug,description,status,created_by) values
 ('cc200000-0000-4000-8000-000000000001','Allowed packages','package-isolation-allowed','Fixture','published','cc000000-0000-4000-8000-000000000003'),
 ('cc200000-0000-4000-8000-000000000002','Restricted packages','package-isolation-restricted','Fixture','published','cc000000-0000-4000-8000-000000000003');
insert into public.creative_assets(campaign_id,title,asset_type,platform,status,storage_path,thumbnail_path,created_by) values
 ('cc200000-0000-4000-8000-000000000001','Allowed asset','image','fixture','published','package-isolation/allowed.webp','package-isolation/allowed-thumb.webp','cc000000-0000-4000-8000-000000000003'),
 ('cc200000-0000-4000-8000-000000000002','Draft asset','image','fixture','draft','package-isolation/hidden.webp','package-isolation/hidden-thumb.webp','cc000000-0000-4000-8000-000000000003');
insert into public.creative_packages(campaign_id,name,storage_path,checksum_sha256,size_bytes,generated_by) values
 ('cc200000-0000-4000-8000-000000000001','Allowed label','package-isolation/allowed.zip',repeat('a',64),100,'cc000000-0000-4000-8000-000000000003'),
 ('cc200000-0000-4000-8000-000000000001','package-isolation/equal.zip','package-isolation/equal.zip',repeat('b',64),100,'cc000000-0000-4000-8000-000000000003'),
 ('cc200000-0000-4000-8000-000000000002','Restricted label','package-isolation/hidden.zip',repeat('c',64),100,'cc000000-0000-4000-8000-000000000003');
insert into storage.objects(bucket_id,name) values
 ('campaign-packages','package-isolation/allowed.zip'),('campaign-packages','package-isolation/equal.zip'),
 ('campaign-packages','package-isolation/hidden.zip'),('campaign-packages','package-isolation/orphan.zip'),
 ('representative-creatives','package-isolation/allowed.webp'),('representative-creatives','package-isolation/hidden.webp'),
 ('creative-thumbnails','package-isolation/allowed-thumb.webp'),('creative-thumbnails','package-isolation/hidden-thumb.webp');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"cc000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
select results_eq($$select name from storage.objects where bucket_id='campaign-packages' and name like 'package-isolation/%' order by name$$,
 array['package-isolation/allowed.zip','package-isolation/equal.zip']::text[],
 'Representative reads only its allowed package paths, including labels different from paths');
select is((select count(*) from storage.objects where bucket_id='campaign-packages' and name='package-isolation/hidden.zip'),0::bigint,
 'An equal label and path never unlock a restricted package');
select is((select count(*) from storage.objects where bucket_id='campaign-packages' and name='package-isolation/orphan.zip'),0::bigint,
 'A package cannot authorize an unrelated orphan object');
select results_eq($$select name from storage.objects where bucket_id='representative-creatives' and name like 'package-isolation/%'$$,
 array['package-isolation/allowed.webp']::text[],'Original media remains scoped to an accessible asset');
select results_eq($$select name from storage.objects where bucket_id='creative-thumbnails' and name like 'package-isolation/%'$$,
 array['package-isolation/allowed-thumb.webp']::text[],'Thumbnails remain scoped to an accessible asset');
select set_config('request.jwt.claims','{"sub":"cc000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',true);
select is((select count(*) from storage.objects where name like 'package-isolation/%'),0::bigint,'Customer cannot read representative files');
select set_config('request.jwt.claims','{"sub":"cc000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}',true);
select is((select count(*) from storage.objects where bucket_id='campaign-packages' and name like 'package-isolation/%'),3::bigint,
 'Creative manager retains access to linked packages, including draft assets');
reset role;
set local role anon;
select is((select count(*) from storage.objects where name like 'package-isolation/%'),0::bigint,'Anonymous callers cannot read private creative files');
reset role;
select * from finish();
rollback;

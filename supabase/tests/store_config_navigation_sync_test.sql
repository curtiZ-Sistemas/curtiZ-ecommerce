begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users(id,instance_id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('fc230000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','store-config-navigation@test.local','{}','{}',now(),now());
update public.profiles set status='active' where id='fc230000-0000-4000-8000-000000000001';
insert into public.user_roles(user_id,role) values ('fc230000-0000-4000-8000-000000000001','admin') on conflict do nothing;

insert into public.categories(name,slug,active,show_in_menu,show_on_home,sort_order,home_sort_order)
values ('Chinelos','chinelos',true,false,false,0,100),('Feminino','feminino',true,false,false,0,100)
on conflict (slug) do update set show_in_menu=false, show_on_home=false;
insert into public.store_navigation_items(id,label,placement,destination_type,destination_value,visible,sort_order,source,created_by,updated_by)
values ('fc230000-0000-4000-8000-000000000002','Atendimento','main','internal_url','/atendimento',true,30,
  'manual','fc230000-0000-4000-8000-000000000001','fc230000-0000-4000-8000-000000000001')
on conflict (id) do nothing;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"fc230000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);

select lives_ok($sql$
  select public.admin_sync_store_navigation(
    '[{"name":"Chinelos","slug":"chinelos","active":true,"showMenu":true,"showHome":true,"sortOrder":1,"description":""},
      {"name":"Feminino","slug":"feminino","active":true,"showMenu":true,"showHome":true,"sortOrder":2,"description":""}]'::jsonb,
    '[{"key":"inicio","label":"Início","type":"page","destination":"/","sortOrder":0,"visible":true},
      {"key":"produtos","label":"Produtos","type":"page","destination":"/produtos","sortOrder":10,"visible":true},
      {"key":"feminino","label":"Feminino","type":"category","destination":"feminino","sortOrder":20,"visible":true},
      {"key":"chinelos","label":"Chinelos","type":"category","destination":"chinelos","sortOrder":30,"visible":true},
      {"key":"atendimento","label":"Atendimento","type":"page","destination":"/atendimento","sortOrder":40,"visible":true}]'::jsonb,
    true
  )
$sql$, 'Existing hidden categories and the five navigation destinations synchronize without an exception');

select is((select count(*)::integer from public.categories
  where slug in ('chinelos','feminino') and active and show_in_menu and show_on_home),2,
  'Existing category rows become active and visible in menu/home');
select is((select count(*)::integer from public.store_navigation_items where visible and (
  (destination_type='internal_url' and destination_value in ('/','/produtos','/atendimento'))
  or (destination_type='category' and destination_value in ('feminino','chinelos')))),5,
  'The five destinations exist exactly once including the preserved manual Atendimento entry');

select lives_ok($sql$
  select public.admin_sync_store_navigation(
    '[{"name":"Chinelos","slug":"chinelos","active":true,"showMenu":true,"showHome":true,"sortOrder":1,"description":""},
      {"name":"Feminino","slug":"feminino","active":true,"showMenu":true,"showHome":true,"sortOrder":2,"description":""}]'::jsonb,
    '[{"key":"inicio","label":"Início","type":"page","destination":"/","sortOrder":0,"visible":true},
      {"key":"produtos","label":"Produtos","type":"page","destination":"/produtos","sortOrder":10,"visible":true},
      {"key":"feminino","label":"Feminino","type":"category","destination":"feminino","sortOrder":20,"visible":true},
      {"key":"chinelos","label":"Chinelos","type":"category","destination":"chinelos","sortOrder":30,"visible":true},
      {"key":"atendimento","label":"Atendimento","type":"page","destination":"/atendimento","sortOrder":40,"visible":true}]'::jsonb,
    true
  )
$sql$, 'Repeating the same workbook is idempotent');
select is((select count(*)::integer from public.store_navigation_items where visible and (
  (destination_type='internal_url' and destination_value in ('/','/produtos','/atendimento'))
  or (destination_type='category' and destination_value in ('feminino','chinelos')))),5,
  'A repeated import does not create duplicate menu destinations');
select is((select source from public.store_navigation_items where id='fc230000-0000-4000-8000-000000000002'),
  'manual','Manual navigation entry remains manual and is not replaced');
select is((select count(*)::integer from public.categories where slug in ('chinelos','feminino')),2,
  'Category upsert reuses the existing rows');

select * from finish();
rollback;

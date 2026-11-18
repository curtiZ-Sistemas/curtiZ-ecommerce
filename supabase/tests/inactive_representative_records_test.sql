begin;
create extension if not exists pgtap with schema extensions;
select plan(9);
insert into auth.users(id,instance_id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
('e8000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','rep-owner@example.invalid','{}','{}',now(),now()),
('e8000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','rep-member@example.invalid','{}','{}',now(),now());
update public.profiles set status='active' where id in ('e8000000-0000-4000-8000-000000000001','e8000000-0000-4000-8000-000000000002');
insert into public.representative_applications(id,user_id) values
('e8100000-0000-4000-8000-000000000001','e8000000-0000-4000-8000-000000000001'),
('e8100000-0000-4000-8000-000000000002','e8000000-0000-4000-8000-000000000002');
insert into public.representatives(id,user_id,application_id,status) values
('e8200000-0000-4000-8000-000000000001','e8000000-0000-4000-8000-000000000001','e8100000-0000-4000-8000-000000000001','active'),
('e8200000-0000-4000-8000-000000000002','e8000000-0000-4000-8000-000000000002','e8100000-0000-4000-8000-000000000002','active');
insert into public.representative_network_closure(ancestor_id,descendant_id,depth)
values ('e8200000-0000-4000-8000-000000000001','e8200000-0000-4000-8000-000000000002',1);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e8000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is((select count(id) from public.representatives where id='e8200000-0000-4000-8000-000000000001'),1::bigint,'Ativo ve proprio perfil');
select is((select count(id) from public.representative_applications where id='e8100000-0000-4000-8000-000000000001'),1::bigint,'Ativo ve candidatura');
select is((select count(*) from public.representative_network_closure where ancestor_id='e8200000-0000-4000-8000-000000000001' and depth=1),1::bigint,'Ativo ve propria rede');
reset role;
update public.profiles set status='suspended' where id='e8000000-0000-4000-8000-000000000001';
set local role authenticated;
select is((select count(id) from public.representatives where id='e8200000-0000-4000-8000-000000000001'),0::bigint,'Suspenso nao ve perfil');
select is((select count(id) from public.representative_applications where id='e8100000-0000-4000-8000-000000000001'),0::bigint,'Suspenso nao ve candidatura');
select is((select count(*) from public.representative_network_closure where ancestor_id='e8200000-0000-4000-8000-000000000001' and depth=1),0::bigint,'Suspenso nao ve rede');
reset role;
update public.profiles set status='active',account_closed_at=now() where id='e8000000-0000-4000-8000-000000000001';
set local role authenticated;
select is((select count(id) from public.representatives where id='e8200000-0000-4000-8000-000000000001'),0::bigint,'Encerrado nao ve perfil');
select is((select count(id) from public.representative_applications where id='e8100000-0000-4000-8000-000000000001'),0::bigint,'Encerrado nao ve candidatura');
select is((select count(*) from public.representative_network_closure where ancestor_id='e8200000-0000-4000-8000-000000000001' and depth=1),0::bigint,'Encerrado nao ve rede');
select * from finish();
rollback;

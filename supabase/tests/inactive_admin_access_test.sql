begin;
create extension if not exists pgtap with schema extensions;
select plan(9);
insert into auth.users(id,instance_id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
('ea000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','admin-inactive@example.invalid','{}','{}',now(),now()),
('ea000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','admin-victim@example.invalid','{}','{}',now(),now());
update public.profiles set status='active' where id in ('ea000000-0000-4000-8000-000000000001','ea000000-0000-4000-8000-000000000002');
insert into public.user_roles(user_id,role) values ('ea000000-0000-4000-8000-000000000001','admin') on conflict do nothing;
insert into public.audit_logs(id,action,entity_type) values ('ea100000-0000-4000-8000-000000000001','test','test');
insert into public.background_jobs(id,queue,job_type,payload_sanitized) values ('ea200000-0000-4000-8000-000000000001','test','test','{}');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"ea000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is((select count(id) from public.profiles where id='ea000000-0000-4000-8000-000000000002'),1::bigint,'Admin ativo ve outro perfil');
select is((select count(id) from public.audit_logs where id='ea100000-0000-4000-8000-000000000001'),1::bigint,'Admin ativo ve auditoria');
select is((select count(id) from public.background_jobs where id='ea200000-0000-4000-8000-000000000001'),1::bigint,'Admin ativo ve fila');
select is((select count(*) from public.user_roles where user_id='ea000000-0000-4000-8000-000000000001' and role='admin'),1::bigint,'Admin ativo ve proprio papel');
reset role;
update public.profiles set status='suspended' where id='ea000000-0000-4000-8000-000000000001';
set local role authenticated;
select is((select count(id) from public.profiles where id='ea000000-0000-4000-8000-000000000002'),0::bigint,'Admin suspenso nao ve outro perfil');
select is((select count(id) from public.audit_logs where id='ea100000-0000-4000-8000-000000000001'),0::bigint,'Admin suspenso nao ve auditoria');
select is((select count(id) from public.background_jobs where id='ea200000-0000-4000-8000-000000000001'),0::bigint,'Admin suspenso nao ve fila');
select is((select count(*) from public.user_roles where user_id='ea000000-0000-4000-8000-000000000001' and role='admin'),0::bigint,'Admin suspenso nao acessa papeis');
select is((select count(id) from public.profiles where id='ea000000-0000-4000-8000-000000000001'),1::bigint,'Perfil proprio continua disponivel para identificacao da suspensao');
select * from finish();
rollback;

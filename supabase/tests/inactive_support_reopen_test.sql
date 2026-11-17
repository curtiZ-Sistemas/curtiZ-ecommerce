begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
('ef000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','reopen-owner@test.local',crypt('Test-password-123',gen_salt('bf')),now(),'{"role":"customer"}','{"full_name":"Owner"}',now(),now()),
('ef000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','reopen-other@test.local',crypt('Test-password-123',gen_salt('bf')),now(),'{"role":"customer"}','{"full_name":"Other"}',now(),now());
insert into public.support_conversations(id,customer_id,category_id,priority,origin,subject,status)
values ('ef100000-0000-0000-0000-000000000001','ef000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000001','normal','account','Teste de reabertura','closed');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"ef000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select throws_ok($$select public.reopen_own_support_conversation('ef100000-0000-0000-0000-000000000001','Motivo valido')$$,'P0001',null,'Outro cliente nao reabre atendimento');
reset role;
update public.profiles set status='suspended' where id='ef000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"ef000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select throws_ok($$select public.reopen_own_support_conversation('ef100000-0000-0000-0000-000000000001','Motivo valido')$$,'42501',null,'Conta suspensa nao reabre atendimento');
reset role;
update public.profiles set status='active',account_closed_at=now() where id='ef000000-0000-0000-0000-000000000001';
set local role authenticated;
select throws_ok($$select public.reopen_own_support_conversation('ef100000-0000-0000-0000-000000000001','Motivo valido')$$,'42501',null,'Conta encerrada nao reabre atendimento');
reset role;
update public.profiles set account_closed_at=null where id='ef000000-0000-0000-0000-000000000001';
set local role authenticated;
select lives_ok($$select public.reopen_own_support_conversation('ef100000-0000-0000-0000-000000000001','Motivo valido')$$,'Conta ativa reabre proprio atendimento');
select set_config('request.jwt.claims','{}',true);
select throws_ok($$select public.reopen_own_support_conversation('ef100000-0000-0000-0000-000000000001','Motivo valido')$$,'42501',null,'Sessao sem usuario nao reabre atendimento');
select * from finish();
rollback;

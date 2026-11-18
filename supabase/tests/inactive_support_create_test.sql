begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('ee000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','support-create@test.local',crypt('Test-password-123',gen_salt('bf')),now(),'{"role":"customer"}','{"full_name":"Cliente teste"}',now(),now());
insert into public.support_conversations(id,customer_id,category_id,priority,origin,subject,client_request_id)
values ('ee100000-0000-0000-0000-000000000001','ee000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000001','normal','account','Teste atendimento','ee200000-0000-0000-0000-000000000001');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"ee000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select lives_ok($$select public.create_support_conversation('account','Assunto valido','Mensagem de teste valida',null,'ee200000-0000-0000-0000-000000000001')$$,'Conta ativa recupera seu atendimento');
reset role;
update public.profiles set status='suspended' where id='ee000000-0000-0000-0000-000000000001';
set local role authenticated;
select throws_ok($$select public.create_support_conversation('account','Assunto valido','Mensagem de teste valida',null,'ee200000-0000-0000-0000-000000000001')$$,'42501',null,'Conta suspensa nao recupera atendimento');
reset role;
update public.profiles set status='active',account_closed_at=now() where id='ee000000-0000-0000-0000-000000000001';
set local role authenticated;
select throws_ok($$select public.create_support_conversation('account','Assunto valido','Mensagem de teste valida',null,'ee200000-0000-0000-0000-000000000001')$$,'42501',null,'Conta encerrada nao recupera atendimento');
select set_config('request.jwt.claims','{}',true);
select throws_ok($$select public.create_support_conversation('account','Assunto valido','Mensagem de teste valida',null,'ee200000-0000-0000-0000-000000000001')$$,'42501',null,'Sessao sem usuario nao recupera atendimento');
select * from finish();
rollback;

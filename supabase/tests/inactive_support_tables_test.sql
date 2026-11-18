begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('ed000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','support-tables@test.local',crypt('Test-password-123',gen_salt('bf')),now(),'{"role":"customer"}','{"full_name":"Cliente teste"}',now(),now());
insert into public.support_conversations(id,customer_id,category_id,priority,origin,subject)
values ('ed100000-0000-0000-0000-000000000001','ed000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000001','normal','account','Atendimento teste');
insert into public.support_participants(conversation_id,user_id,participant_role)
values ('ed100000-0000-0000-0000-000000000001','ed000000-0000-0000-0000-000000000001','customer');
insert into public.support_messages(id,conversation_id,sender_id,sender_role,content_sanitized,is_internal_note)
values ('ed200000-0000-0000-0000-000000000001','ed100000-0000-0000-0000-000000000001','ed000000-0000-0000-0000-000000000001','customer','Mensagem teste',false);
insert into public.support_attachments(message_id,storage_path,original_name_sanitized,mime_type,size_bytes,scan_status)
values ('ed200000-0000-0000-0000-000000000001','ed000000-0000-0000-0000-000000000001/support/test.png','test.png','image/png',100,'clean');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"ed000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select is((select count(*) from public.support_conversations where id='ed100000-0000-0000-0000-000000000001'),1::bigint,'Ativo ve atendimento');
select is((select count(*) from public.support_messages where id='ed200000-0000-0000-0000-000000000001'),1::bigint,'Ativo ve mensagem');
select is((select count(*) from public.support_participants where conversation_id='ed100000-0000-0000-0000-000000000001'),1::bigint,'Ativo ve participante');
select is((select count(*) from public.support_attachments where message_id='ed200000-0000-0000-0000-000000000001'),1::bigint,'Ativo ve anexo');
reset role;
update public.profiles set status='suspended' where id='ed000000-0000-0000-0000-000000000001';
set local role authenticated;
select is((select count(*) from public.support_conversations where id='ed100000-0000-0000-0000-000000000001'),0::bigint,'Suspenso nao ve atendimento');
select is((select count(*) from public.support_messages where id='ed200000-0000-0000-0000-000000000001'),0::bigint,'Suspenso nao ve mensagem');
select is((select count(*) from public.support_participants where conversation_id='ed100000-0000-0000-0000-000000000001'),0::bigint,'Suspenso nao ve participante');
select is((select count(*) from public.support_attachments where message_id='ed200000-0000-0000-0000-000000000001'),0::bigint,'Suspenso nao ve anexo');
reset role;
update public.profiles set status='active',account_closed_at=now() where id='ed000000-0000-0000-0000-000000000001';
set local role authenticated;
select is((select count(*) from public.support_conversations where id='ed100000-0000-0000-0000-000000000001'),0::bigint,'Encerrado nao ve atendimento');
select is((select count(*) from public.support_messages where id='ed200000-0000-0000-0000-000000000001'),0::bigint,'Encerrado nao ve mensagem');
select is((select count(*) from public.support_participants where conversation_id='ed100000-0000-0000-0000-000000000001'),0::bigint,'Encerrado nao ve participante');
select is((select count(*) from public.support_attachments where message_id='ed200000-0000-0000-0000-000000000001'),0::bigint,'Encerrado nao ve anexo');
select * from finish();
rollback;

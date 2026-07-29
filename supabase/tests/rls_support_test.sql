begin;

create extension if not exists pgtap with schema extensions;
select plan(15);

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'customer-a@test.local', crypt('Test-password-123', gen_salt('bf')), now(), '{"role":"customer"}', '{"full_name":"Cliente A"}', now(), now()),
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'customer-b@test.local', crypt('Test-password-123', gen_salt('bf')), now(), '{"role":"customer"}', '{"full_name":"Cliente B"}', now(), now()),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local', crypt('Test-password-123', gen_salt('bf')), now(), '{"role":"admin"}', '{"full_name":"Admin Teste"}', now(), now()),
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'operational@test.local', crypt('Test-password-123', gen_salt('bf')), now(), '{"role":"operational"}', '{"full_name":"Operacional Teste"}', now(), now()),
  ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'manager@test.local', crypt('Test-password-123', gen_salt('bf')), now(), '{"role":"manager"}', '{"full_name":"Gerência Teste"}', now(), now()),
  ('a0000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'technical@test.local', crypt('Test-password-123', gen_salt('bf')), now(), '{"role":"technical"}', '{"full_name":"Técnico Teste"}', now(), now());

insert into public.user_roles(user_id, role) values
  ('a0000000-0000-0000-0000-000000000003', 'admin'),
  ('a0000000-0000-0000-0000-000000000004', 'operational'),
  ('a0000000-0000-0000-0000-000000000005', 'manager'),
  ('a0000000-0000-0000-0000-000000000006', 'technical')
on conflict do nothing;

insert into public.support_conversations(
  id, customer_id, category_id, priority, origin, subject
)
values (
  'b0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',
  '41000000-0000-0000-0000-000000000001',
  'normal', 'account', 'Pedido atrasado para teste'
);

insert into public.support_messages(
  id, conversation_id, sender_id, sender_role, content_sanitized, is_internal_note
)
values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'customer', 'Mensagem do cliente', false),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000003', 'admin', 'Nota interna', true);

insert into public.support_attachments(
  message_id, storage_path, original_name_sanitized, mime_type, size_bytes, scan_status
)
values (
  'c0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001/evidence.png',
  'evidence.png', 'image/png', 1200, 'clean'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1","app_metadata":{"role":"customer"}}', true);

select is(
  (select count(*) from public.support_conversations),
  1::bigint,
  '1. Cliente vê somente a própria conversa'
);
select is(
  (select count(*) from public.support_messages),
  1::bigint,
  '2. Cliente não vê nota interna'
);
select is(
  (select count(*) from public.support_attachments),
  1::bigint,
  '3. Cliente vê apenas anexo autorizado'
);
select throws_ok(
  $$update public.support_conversations set assigned_user_id = 'a0000000-0000-0000-0000-000000000004' where id = 'b0000000-0000-0000-0000-000000000001'$$,
  '42501',
  null,
  '4. Cliente não altera responsável'
);
select throws_ok(
  $$update public.support_conversations set priority = 'urgent' where id = 'b0000000-0000-0000-0000-000000000001'$$,
  '42501',
  null,
  '5. Cliente não altera prioridade'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal1","app_metadata":{"role":"customer"}}', true);
select is(
  (select count(*) from public.support_conversations),
  0::bigint,
  '6. Outro cliente não vê a conversa'
);
select is(
  (select count(*) from public.support_messages),
  0::bigint,
  '7. Outro cliente não vê mensagens'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2","app_metadata":{"role":"admin"}}', true);
select is(
  (select count(*) from public.support_conversations),
  1::bigint,
  '8. Administrador vê a fila administrativa'
);
select is(
  (select count(*) from public.support_messages),
  2::bigint,
  '9. Administrador vê mensagens e notas internas'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2","app_metadata":{"role":"operational"}}', true);
select is(
  (select count(*) from public.support_conversations),
  0::bigint,
  '10. Operacional não vê chamado sem transferência'
);

reset role;
update public.support_conversations
set assigned_role = 'operational', assigned_user_id = 'a0000000-0000-0000-0000-000000000004', status = 'assigned'
where id = 'b0000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2","app_metadata":{"role":"operational"}}', true);
select is(
  (select count(*) from public.support_conversations),
  1::bigint,
  '11. Operacional vê chamado transferido a ele'
);

reset role;
update public.support_conversations
set assigned_role = 'technical', assigned_user_id = 'a0000000-0000-0000-0000-000000000006', status = 'escalated'
where id = 'b0000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000006","role":"authenticated","aal":"aal2","app_metadata":{"role":"technical"}}', true);
select is(
  (select count(*) from public.support_conversations),
  1::bigint,
  '12. Técnico vê somente chamado técnico escalado'
);

reset role;
update public.profiles set status = 'suspended'
where id = 'a0000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1","app_metadata":{"role":"customer"}}', true);
select throws_ok(
  $$insert into public.support_messages(conversation_id, sender_id, sender_role, content_sanitized) values ('b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','customer','Mensagem bloqueada')$$,
  '42501',
  null,
  '13. Usuário suspenso não envia mensagem'
);
select throws_ok(
  $$update public.audit_logs set action = 'tampered'$$,
  '42501',
  null,
  '14. Cliente não altera auditoria'
);

reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is(
  (select count(*) from public.support_conversations),
  0::bigint,
  '15. Anônimo não lê conversas sensíveis'
);

select * from finish();
rollback;

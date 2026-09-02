begin;

create extension if not exists pgtap with schema extensions;
select plan(20);

select is(private.audit_action_type('product.created'), 'CREATE', '1. Classifica criação');
select is(private.audit_action_type('product.updated'), 'UPDATE', '2. Classifica alteração');
select is(private.audit_action_type('product.deleted'), 'DELETE', '3. Classifica exclusão');
select is(private.audit_action_type('payment.refunded'), 'REFUND', '4. Classifica estorno');
select is(private.audit_action_type('auth.login'), 'LOGIN', '5. Classifica login');
select is(private.audit_action_type('auth.logout'), 'LOGOUT', '6. Classifica logout');
select is(
  private.sanitize_audit_json('{"password":"segredo","note":"admin@curtiz.test"}'::jsonb)->>'password',
  '[REDACTED]',
  '7. Remove senha do payload'
);
select is(
  private.sanitize_audit_json('{"note":"admin@curtiz.test"}'::jsonb)->>'note',
  '[EMAIL]',
  '8. Mascara e-mail dentro do payload'
);
select is(
  private.audit_changed_fields('{"status":"pending","same":1}'::jsonb, '{"status":"paid","same":1}'::jsonb),
  array['status']::text[],
  '9. Calcula campos alterados'
);

insert into public.audit_logs(action, entity_type, description, previous_data_sanitized, new_data_sanitized, origin_type, origin_name)
values
  ('audit_test.created', 'audit_test', 'Registro único criação auditável', null, '{"password":"never-store"}'::jsonb, 'system', 'Teste automatizado'),
  ('audit_test.updated', 'audit_test', 'Registro único alteração auditável', '{"status":"before"}'::jsonb, '{"status":"after"}'::jsonb, 'system', 'Teste automatizado'),
  ('audit_test.deleted', 'audit_test', 'Registro único exclusão auditável', '{"status":"active"}'::jsonb, null, 'system', 'Teste automatizado');

select is((select action_type from public.audit_logs where description = 'Registro único criação auditável'), 'CREATE', '10. Trigger prepara criação');
select is((select action_type from public.audit_logs where description = 'Registro único alteração auditável'), 'UPDATE', '11. Trigger prepara alteração');
select is((select action_type from public.audit_logs where description = 'Registro único exclusão auditável'), 'DELETE', '12. Trigger prepara exclusão');
select is((select origin_type from public.audit_logs where description = 'Registro único alteração auditável'), 'system', '13. Preserva ator de sistema');
select is((select new_data_sanitized->>'password' from public.audit_logs where description = 'Registro único criação auditável'), '[REDACTED]', '14. Trigger sanitiza antes de persistir');
select throws_ok(
  $$update public.audit_logs set description = 'adulterado' where description = 'Registro único alteração auditável'$$,
  '42501', 'audit logs are immutable', '15. Registro não pode ser alterado'
);
select throws_ok(
  $$delete from public.audit_logs where description = 'Registro único exclusão auditável'$$,
  '42501', 'audit logs are immutable', '16. Registro não pode ser excluído'
);

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'a0000000-0000-4000-8000-000000000099', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'audit-manager@test.local', crypt('Test-password-123', gen_salt('bf')),
  now(), '{"role":"manager"}', '{"full_name":"Gerente Auditoria"}', now(), now()
) on conflict (id) do nothing;
insert into public.user_roles(user_id, role)
values ('a0000000-0000-4000-8000-000000000099', 'manager') on conflict do nothing;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000099","role":"authenticated","aal":"aal2","app_metadata":{"role":"manager"}}', true);
select ok(
  ((public.activity_log_page(1, 2, null, null, null, null, 'audit_test', 'system', 'Registro único')->>'total')::integer >= 3),
  '17. Paginação, módulo, origem e busca retornam registros filtrados'
);
select ok(
  jsonb_array_length((public.export_activity_logs(now() - interval '1 hour', now() + interval '1 hour', null, null, 'audit_test', 'system', null))->'items') >= 3,
  '18. Exportação aplica período, módulo e origem no servidor'
);
select is(
  (select action_type from public.audit_logs where action = 'audit.exported' order by created_at desc limit 1),
  'EXPORT',
  '19. Exportação gera sua própria auditoria'
);
select throws_ok(
  $$insert into public.audit_logs(action,entity_type) values ('forbidden','audit_test')$$,
  '42501', null, '20. Usuário autenticado não escreve diretamente na auditoria'
);

select * from finish();
rollback;

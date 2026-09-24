begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into auth.users(id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values ('d1000000-0000-4000-8000-000000000001', 'homepage-editor-test@example.invalid', '', now(), '{}', '{}'),
  ('d1000000-0000-4000-8000-000000000002', 'homepage-manager-test@example.invalid', '', now(), '{}', '{}');
update public.profiles set status = 'active' where id in
  ('d1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002');
insert into public.user_roles(user_id, role) values
  ('d1000000-0000-4000-8000-000000000001', 'admin'),
  ('d1000000-0000-4000-8000-000000000002', 'manager');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
select is(private.has_permission('homepage.edit'), true, 'admin editor may submit sections');
select is(private.has_permission('homepage.review'), false, 'admin editor lacks review by default');
select is(private.has_permission('homepage.publish'), false, 'admin editor lacks publish by default');
select throws_ok($$select public.prepare_xlsx_homepage_publication('Revisão explícita', '[]'::jsonb, true)$$,
  '42501', 'permission denied', 'edit-only user cannot self approve');

reset role;
insert into public.user_permission_overrides(user_id, permission_id, allowed, reason, created_by)
select 'd1000000-0000-4000-8000-000000000001', permission.id, true,
  'Teste de permissão parcial', 'd1000000-0000-4000-8000-000000000001'
from public.permissions permission where permission.code = 'homepage.review';
set local role authenticated;
select is(private.has_permission('homepage.review'), true, 'revisor parcial recebe review');
select throws_ok($$select public.prepare_xlsx_homepage_publication('Revisão explícita', '[]'::jsonb, true)$$,
  '42501', 'permission denied', 'review sem publish não autoaprova');

reset role;
select set_config('request.jwt.claims',
  '{"sub":"d1000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select is(private.has_permission('homepage.edit'), true, 'manager has edit');
select is(private.has_permission('homepage.review'), true, 'manager has review');
select is(private.has_permission('homepage.publish'), true, 'manager has publish');
select public.save_homepage_section(jsonb_build_object(
  'internalName', 'xlsx:teste-publicacao', 'sectionType', 'image_links',
  'layout', 'content_centered', 'visibility', 'all', 'style', '{}'::jsonb,
  'content', '{}'::jsonb, 'sortOrder', 1, 'changeSummary', 'Teste de publicação',
  'items', '[]'::jsonb), null);
select public.prepare_xlsx_homepage_publication('Enviar para revisão',
  (select jsonb_agg(jsonb_build_object('sectionId', id, 'versionId', current_version_id) order by id)
   from public.homepage_sections where internal_name = 'xlsx:teste-publicacao'), false);
select throws_ok($$select public.transition_homepage_section(
  (select id from public.homepage_sections where internal_name = 'xlsx:teste-publicacao'),
  'approve', 'Revisão comum')$$, 'P0001', 'author cannot review own homepage section',
  'workflow normal continua bloqueando o autor');
select ok((select public.prepare_xlsx_homepage_publication('Aprovar e publicar versão própria',
  jsonb_build_array(jsonb_build_object('sectionId', id, 'versionId', current_version_id)), true) is not null
  from public.homepage_sections where internal_name = 'xlsx:teste-publicacao'),
  'override explícito publica uma versão');
select is((select count(*)::integer from public.home_section_audit_logs
  where action = 'homepage.section.self_approved_for_publication'
    and actor_id = 'd1000000-0000-4000-8000-000000000002'
    and section_id = (select id from public.homepage_sections where internal_name = 'xlsx:teste-publicacao')
    and new_data->>'versionId' is not null and reason = 'Aprovar e publicar versão própria'),
  1, 'auditoria registra ator, seção, versão e motivo');
select is((select status from public.homepage_sections where internal_name = 'xlsx:teste-publicacao'),
  'published', 'seção foi publicada');
select throws_ok($$select public.prepare_xlsx_homepage_publication('Versão antiga',
  '[{"sectionId":"d2000000-0000-4000-8000-000000000001","versionId":"d3000000-0000-4000-8000-000000000001"}]'::jsonb,
  true)$$, 'P4004', 'homepage sections changed since confirmation',
  'versões antigas bloqueiam nova publicação');

reset role;
select throws_ok($$select private.validate_homepage_publication_snapshot(
  '{"style":{},"content":{},"startsAt":"2026-09-25T00:00:00Z","endsAt":"2026-09-24T00:00:00Z","items":[]}'::jsonb)$$,
  'P4002', 'homepage section validation failed', 'horário inválido impede publicação');
select throws_ok($$select private.validate_homepage_publication_snapshot(
  '{"style":{},"content":{},"items":[{"targetType":"product","targetRoute":"/produto/ausente","targetId":"d4000000-0000-4000-8000-000000000001","media":[]}]}'::jsonb)$$,
  'P4002', 'homepage section validation failed', 'produto alvo ausente impede publicação');
select throws_ok($$select private.validate_homepage_publication_snapshot(
  '{"style":{},"content":{},"items":[{"targetType":"none","media":[{"path":"home-sections/ausente.webp"}]}]}'::jsonb)$$,
  'P4002', 'homepage section validation failed', 'mídia ausente impede publicação');

select * from finish();
rollback;

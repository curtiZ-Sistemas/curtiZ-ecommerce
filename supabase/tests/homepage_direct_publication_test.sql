begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into auth.users(id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values ('d1000000-0000-4000-8000-000000000001', 'homepage-publisher-test@example.invalid', '', now(), '{}', '{}'),
  ('d1000000-0000-4000-8000-000000000002', 'homepage-no-publish-test@example.invalid', '', now(), '{}', '{}');
update public.profiles set status = 'active' where id in
  ('d1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002');
insert into public.user_roles(user_id, role)
values ('d1000000-0000-4000-8000-000000000001', 'admin'),
  ('d1000000-0000-4000-8000-000000000002', 'admin');
insert into public.user_permission_overrides(user_id, permission_id, allowed, reason, created_by)
select 'd1000000-0000-4000-8000-000000000001', permission.id, true,
  'Teste de publicação sem revisão', 'd1000000-0000-4000-8000-000000000001'
from public.permissions permission where permission.code = 'homepage.publish';

insert into public.categories(id, name, slug)
values ('d2000000-0000-4000-8000-000000000001', 'Categoria da home', 'categoria-home-direta');
insert into public.products(id, name, slug, short_description, description, category_id,
  status, base_price, weight_grams, height_cm, width_cm, length_cm)
values ('d3000000-0000-4000-8000-000000000001', 'Produto da home', 'produto-home-direta',
  'Teste', 'Produto para validação', 'd2000000-0000-4000-8000-000000000001',
  'active', 50, 100, 5, 10, 20);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"d1000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
select throws_ok($$select public.publish_homepage('Sem permissão de publicar', null)$$,
  '42501', 'permission denied', 'homepage.publish continua obrigatório no banco');
select set_config('request.jwt.claims',
  '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
select is(private.has_permission('homepage.publish'), true, 'usuário possui homepage.publish');
select is(private.has_permission('homepage.review'), false, 'usuário não possui homepage.review');

select public.save_homepage_section(jsonb_build_object(
  'internalName', 'xlsx:direct-' || index, 'sectionType', 'image_links',
  'layout', 'content_centered', 'visibility', 'all', 'style', '{}'::jsonb,
  'content', '{}'::jsonb, 'sortOrder', index, 'changeSummary', 'Teste de publicação',
  'items', '[]'::jsonb), null)
from generate_series(1, 6) index;
select public.transition_homepage_section(section.id, 'submit_review', 'Teste de publicação')
from public.homepage_sections section where section.internal_name like 'xlsx:direct-%';
select is((select count(*)::integer from public.homepage_sections
  where internal_name like 'xlsx:direct-%' and status = 'pending_review'),
  6, 'seis seções estão pendentes antes de publicar');

select ok(public.publish_homepage('Publicar seis seções pendentes', null) is not null,
  'homepage.publish publica as seis sem homepage.review');
select is((select count(*)::integer from public.home_page_versions page_version
  cross join lateral jsonb_array_elements(page_version.manifest->'sections') entry
  join public.homepage_sections section on section.id = (entry->>'sectionId')::uuid
  where page_version.id = (select published_version_id from public.home_pages where slug = 'principal')
    and section.internal_name like 'xlsx:direct-%'
    and (entry->>'versionId')::uuid = section.current_version_id),
  6, 'manifesto usa current_version_id das seis seções');
select is((select count(*)::integer from public.homepage_sections
  where internal_name like 'xlsx:direct-%' and status = 'published'),
  6, 'seis seções ficam publicadas');
select is((select count(*)::integer from public.homepage_section_versions version
  join public.homepage_sections section on section.current_version_id = version.id
  where section.internal_name like 'xlsx:direct-%' and version.status = 'published'),
  6, 'seis versões atuais ficam publicadas');
select is((select count(*)::integer from public.home_section_approvals approval
  join public.homepage_sections section on section.id = approval.section_id
  where section.internal_name like 'xlsx:direct-%'),
  0, 'publicação não cria aprovações artificiais');
select is((select count(*)::integer from public.home_section_audit_logs
  where action = 'homepage.published'
    and actor_id = 'd1000000-0000-4000-8000-000000000001'
    and reason = 'Publicar seis seções pendentes'
    and jsonb_array_length(new_data->'sectionVersionIds') >= 6),
  1, 'auditoria mantém autor, motivo e versões publicadas');

select public.save_homepage_section(jsonb_build_object(
  'internalName', 'xlsx:direct-invalid', 'sectionType', 'image_links',
  'layout', 'content_centered', 'visibility', 'all', 'style', '{}'::jsonb,
  'content', '{}'::jsonb, 'sortOrder', 7, 'changeSummary', 'Teste de validação',
  'items', jsonb_build_array(jsonb_build_object(
    'itemType', 'content', 'internalName', 'Produto alvo', 'decorative', false,
    'targetType', 'product', 'targetId', 'd3000000-0000-4000-8000-000000000001',
    'targetRoute', '/produto/produto-home-direta', 'sortOrder', 0, 'config', '{}'::jsonb,
    'media', '[]'::jsonb))), null);
reset role;
update public.products set status = 'archived' where id = 'd3000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.publish_homepage('Não publicar produto arquivado', null)$$,
  'P4002', 'homepage section validation failed', 'produto arquivado bloqueia a publicação inteira');
select is((select count(*)::integer from public.home_page_versions
  where created_by = 'd1000000-0000-4000-8000-000000000001'
    and reason = 'Não publicar produto arquivado'), 0,
  'falha de validação não cria versão parcial');

reset role;
update public.products set status = 'active' where id = 'd3000000-0000-4000-8000-000000000001';
update public.homepage_sections set status = case internal_name
  when 'xlsx:direct-1' then 'rejected'
  when 'xlsx:direct-2' then 'approved'
  when 'xlsx:direct-3' then 'scheduled'
  else status end
where internal_name in ('xlsx:direct-1', 'xlsx:direct-2', 'xlsx:direct-3');
set local role authenticated;
select ok(public.publish_homepage('Publicar versões atuais de todos os estados', null) is not null,
  'rascunho, rejeitada, aprovada, agendada e publicada também são elegíveis');
select is((select count(*)::integer from public.homepage_sections
  where internal_name like 'xlsx:direct-%' and status = 'published'),
  7, 'todas as versões atuais elegíveis foram publicadas');

reset role;
select throws_ok($$select private.validate_homepage_publication_snapshot(
  '{"style":{},"content":{},"startsAt":"2026-09-25T00:00:00Z","endsAt":"2026-09-24T00:00:00Z","items":[]}'::jsonb)$$,
  'P4002', 'homepage section validation failed', 'horário inválido é rejeitado');
select throws_ok($$select private.validate_homepage_publication_snapshot(
  '{"style":{},"content":{},"items":[{"targetType":"category","targetRoute":"/produtos?categoria=ausente","targetId":"d4000000-0000-4000-8000-000000000001","media":[]}]}'::jsonb)$$,
  'P4002', 'homepage section validation failed', 'categoria indisponível é rejeitada');
select throws_ok($$select private.validate_homepage_publication_snapshot(
  '{"style":{},"content":{},"items":[{"targetType":"none","media":[{"path":"home-sections/ausente.webp"}]}]}'::jsonb)$$,
  'P4002', 'homepage section validation failed', 'mídia indisponível é rejeitada');

select * from finish();
rollback;

-- Executar somente em banco isolado com todas as migrations aplicadas.
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);
insert into auth.users(id,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
values ('e1000000-0000-4000-8000-000000000001','legal-manager-test@example.invalid','',now(),'{}','{}'),
  ('e1000000-0000-4000-8000-000000000002','legal-editor-test@example.invalid','',now(),'{}','{}');
update public.profiles set status='active' where id in
  ('e1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000002');
insert into public.user_roles(user_id,role) values
  ('e1000000-0000-4000-8000-000000000001','manager'),('e1000000-0000-4000-8000-000000000002','admin');
insert into public.user_permission_overrides(user_id,permission_id,allowed,reason,created_by)
select 'e1000000-0000-4000-8000-000000000002',id,false,'Fixture editor sem publicação',
  'e1000000-0000-4000-8000-000000000001' from public.permissions where code='legal_content.publish';
update public.company_legal_information set completeness_status='complete',legal_name=null,tax_id=null,
  address=null,email=null,privacy_channel=null where id;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e1000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',true);
select lives_ok($$select public.import_legal_policy('aviso-de-privacidade','Política de Privacidade',
  '[{"section_number":"1","title":"Responsável","content":"[CNPJ] e direitos dos titulares.","content_format":"markdown","sort_order":0}]',
  (select updated_at from public.legal_documents where slug='aviso-de-privacidade'))$$,'editor importa sem permissão de publicação');
select throws_ok($$select public.publish_legal_policy((select id from public.legal_documents where slug='aviso-de-privacidade'),now())$$,
  '42501','permission denied','permissão de publicação exigida no banco');
select throws_ok($$update public.legal_documents set public_visible=true where slug='aviso-de-privacidade'$$,
  '42501','permission denied for table legal_documents','escrita direta não burla publicação');
select throws_ok($$select public.import_legal_policy('politica-de-privacidade','Privacidade','[]',null)$$,
  'P0001','invalid legal destination','destino não canônico é rejeitado');
select set_config('request.jwt.claims','{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
select ok((public.publish_legal_policy((select id from public.legal_documents where slug='aviso-de-privacidade'),
  (select updated_at from public.legal_documents where slug='aviso-de-privacidade'))->'problems') ? '[CNPJ]',
  'placeholder bloqueia publicação');
select ok((public.publish_legal_policy((select id from public.legal_documents where slug='aviso-de-privacidade'),
  (select updated_at from public.legal_documents where slug='aviso-de-privacidade'))->'problems') ? 'Razão social',
  'flag completa não substitui campos reais');
create temporary table legal_before as select id,requires_acceptance,display_locations,audience,updated_at
  from public.legal_documents where slug='aviso-de-privacidade';
select is((public.import_legal_policy('aviso-de-privacidade','Política de Privacidade',
  '[{"section_number":"1","title":"Responsável","content":"[CNPJ] e direitos dos titulares.","content_format":"markdown","sort_order":0}]',
  (select updated_at from public.legal_documents where slug='aviso-de-privacidade'))->>'unchanged')::boolean,true,
  'reimportar conteúdo igual não muda o documento');
select is((select updated_at from public.legal_documents where slug='aviso-de-privacidade'),
  (select updated_at from legal_before),'reimportação preserva timestamp e evita auditoria duplicada');
reset role;
update public.company_legal_information set legal_name='Empresa isolada de teste',tax_id='11222333000181',
  address='Endereço fictício de teste, 100, São Paulo, SP, 01000-000',email='legal-test@example.invalid',
  privacy_channel='privacy-test@example.invalid',completeness_status='complete' where id;
set local role authenticated;
select public.import_legal_policy('aviso-de-privacidade','Política de Privacidade',
  '[{"section_number":"1","title":"Responsável","content":"Dados pessoais e **direitos dos titulares**.","content_format":"markdown","sort_order":0}]',
  (select updated_at from public.legal_documents where slug='aviso-de-privacidade'));
select ok(public.publish_legal_policy((select id from public.legal_documents where slug='aviso-de-privacidade'),
  (select updated_at from public.legal_documents where slug='aviso-de-privacidade')) ? 'versionId',
  'responsável publica diretamente com conteúdo completo');
create temporary table legal_published as select v.id,v.version,v.snapshot,v.content_hash,d.updated_at
  from public.legal_document_versions v join public.legal_documents d on d.id=v.document_id
  where d.slug='aviso-de-privacidade' order by v.version desc limit 1;
select is((select count(*)::integer from public.legal_document_reviews where document_id=(select id from legal_before)
  and decision='legally_reviewed'),0,'publicação não inventa revisão jurídica');
select ok(exists(select 1 from public.legal_document_reviews r join legal_published v on r.content_hash=v.content_hash
  where r.decision='approved'),'aprovação vinculada ao hash publicado');
select is((public.publish_legal_policy((select id from legal_before),(select updated_at from legal_published))->>'unchanged')::boolean,
  true,'retry da publicação é idempotente');
select is((select count(*)::integer from public.legal_document_versions where document_id=(select id from legal_before)),
  1,'retry não duplica versões');
with attempted as (
  update public.legal_document_versions set snapshot='{}' where id=(select id from legal_published) returning id
)
select is((select count(*) from attempted),0::bigint,'RLS impede edição direta da versão imutável');
select public.import_legal_policy('aviso-de-privacidade','Política de Privacidade',
  '[{"section_number":"1","title":"Responsável","content":"Nova minuta com [RETENCAO_CONFIRMADA].","content_format":"markdown","sort_order":0}]',
  (select updated_at from public.legal_documents where slug='aviso-de-privacidade'));
select is((select version_id from public.published_legal_documents where slug='aviso-de-privacidade'),
  (select id from legal_published),'nova minuta mantém a versão pública anterior');
select ok((select approved_at is null and approved_by is null and legally_reviewed_at is null
  from public.legal_documents where slug='aviso-de-privacidade'),'texto modificado invalida aprovação anterior');
select throws_ok($$select public.import_legal_policy('aviso-de-privacidade','Política de Privacidade',
  '[{"section_number":"1","title":"Responsável","content":"Texto concorrente.","content_format":"plain","sort_order":0}]',
  (select updated_at from legal_published))$$,'40001','legal concurrent change','edição detecta concorrência');
select throws_ok($$select public.publish_legal_policy((select id from legal_before),(select updated_at from legal_published))$$,
  '40001','legal concurrent change','publicação detecta concorrência');
select is((select row(requires_acceptance,display_locations,audience)::text from public.legal_documents where slug='aviso-de-privacidade'),
  (select row(requires_acceptance,display_locations,audience)::text from legal_before),'importação preserva configurações de aceite e exibição');
select is((select snapshot from public.legal_document_versions where id=(select id from legal_published)),
  (select snapshot from legal_published),'histórico permanece intacto após substituição');
reset role;
insert into public.legal_acceptances(user_id,document_version_id,context,accepted)
  values('e1000000-0000-4000-8000-000000000001',(select id from legal_published),'other',true);
set local role authenticated;
select public.import_legal_policy('aviso-de-privacidade','Política de Privacidade',
  '[{"section_number":"1","title":"Responsável","content":"Texto definitivo dos direitos dos titulares.","content_format":"markdown","sort_order":0}]',
  (select updated_at from public.legal_documents where slug='aviso-de-privacidade'));
select public.publish_legal_policy((select id from legal_before),(select updated_at from public.legal_documents where slug='aviso-de-privacidade'));
select is((select document_version_id from public.legal_acceptances where user_id='e1000000-0000-4000-8000-000000000001' and context='other'),
  (select id from legal_published),'aceite antigo permanece vinculado à versão original');
select is((select count(*)::integer from public.legal_acceptances where user_id='e1000000-0000-4000-8000-000000000001'),1,
  'publicação não cria aceites de clientes');
select * from finish();
rollback;

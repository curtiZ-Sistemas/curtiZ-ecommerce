begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users(id,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
values ('f1000000-0000-4000-8000-000000000001','help-expiration@example.invalid','',now(),'{}','{}');
insert into public.support_categories(id,name,slug)
values ('f2000000-0000-4000-8000-000000000001','Ajuda de teste','help-expiration-test');

-- Published: expired, exact deadline, future deadline, no deadline.
-- Scheduled: due, due but expired, future. Finally, an unpublished draft.
insert into public.help_contents(id,category_id,content_type,slug,title,author_id,expires_at,status)
select ('f3000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
  'f2000000-0000-4000-8000-000000000001','article','help-expiration-'||i,'Ajuda de teste '||i,
  'f1000000-0000-4000-8000-000000000001',
  case when i in (1,6) then now()-interval '1 minute' when i=2 then now()
    when i=3 then now()+interval '1 minute' else null end,
  case when i<=4 then 'published' when i<=7 then 'scheduled' else 'draft' end
from generate_series(1,8) i;
insert into public.help_content_versions(id,content_id,version,snapshot,change_summary,status,created_by)
select ('f4000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
  ('f3000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,1,
  jsonb_build_object('content',jsonb_build_object('slug','help-expiration-'||i,'content_type','article',
    'title','Ajuda de teste '||i,'summary','','body','Conteúdo fictício para validação.',
    'audiences',jsonb_build_array('visitor','customer'),'author_id','private-author',
    'reviewer_id','private-reviewer','attachments',jsonb_build_array('private-attachment')),
    'category',jsonb_build_object('name','Ajuda de teste','slug','help-expiration-test'),'related','[]'::jsonb),
  'Fixture de expiração','published','f1000000-0000-4000-8000-000000000001'
from generate_series(1,8) i;
update public.help_contents set
  published_version_id=case when right(slug,1)::integer<=4 then
    ('f4000000-0000-4000-8000-'||lpad(right(slug,1),12,'0'))::uuid else null end,
  scheduled_version_id=case when right(slug,1)::integer between 5 and 7 then
    ('f4000000-0000-4000-8000-'||lpad(right(slug,1),12,'0'))::uuid else null end,
  scheduled_at=case when right(slug,1)::integer in (5,6) then now()-interval '1 minute'
    when right(slug,1)::integer=7 then now()+interval '1 minute' else null end
where category_id='f2000000-0000-4000-8000-000000000001';

set local role anon;
select is((select array_agg(slug order by slug) from public.published_help_contents
  where slug like 'help-expiration-%'),
  array['help-expiration-3','help-expiration-4','help-expiration-5'],
  'anon vê apenas publicações vigentes e agendamento já devido');
select is((select count(*)::integer from public.search_published_help('Ajuda de teste','visitor',1,24)
  where slug like 'help-expiration-%'),3,'busca pública também exclui expirados, limite exato, agendamento futuro e rascunho');
select ok((select bool_and(not ((snapshot->'content') ?| array['author_id','reviewer_id','attachments']))
  from public.published_help_contents where slug like 'help-expiration-%'),
  'projeção pública preserva remoção dos metadados privados');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',true);
select is((select array_agg(slug order by slug) from public.published_help_contents
  where slug like 'help-expiration-%'),array['help-expiration-3','help-expiration-4','help-expiration-5'],
  'cliente autenticado recebe a mesma projeção vigente');
select is((select count(*)::integer from public.search_published_help('Ajuda de teste','customer',1,24)
  where slug like 'help-expiration-%'),3,'busca autenticada respeita a mesma expiração');
select ok((select bool_and(not ((snapshot->'content') ?| array['author_id','reviewer_id','attachments']))
  from public.published_help_contents where slug like 'help-expiration-%'),
  'metadados privados continuam ocultos na projeção autenticada');

set local role service_role;
select is((select count(*)::integer from public.published_help_contents where slug like 'help-expiration-%'),
  3,'leitura interna da projeção também respeita a expiração');
reset role;
select ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class
  where oid in ('public.help_contents'::regclass,'public.help_content_versions'::regclass)),
  'RLS das tabelas editoriais permanece ativa e forçada');
select ok(has_table_privilege('anon','public.published_help_contents','SELECT')
  and has_table_privilege('authenticated','public.published_help_contents','SELECT'),
  'grants de leitura pública e autenticada são preservados');

select * from finish();
rollback;

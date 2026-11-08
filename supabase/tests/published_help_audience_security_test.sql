begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values
 ('f6100000-0000-4000-8000-000000000001','help-customer@example.invalid','{}','{}'),
 ('f6100000-0000-4000-8000-000000000002','help-representative@example.invalid','{}','{}'),
 ('f6100000-0000-4000-8000-000000000003','help-technical@example.invalid','{}','{}'),
 ('f6100000-0000-4000-8000-000000000004','help-admin@example.invalid','{}','{}'),
 ('f6100000-0000-4000-8000-000000000005','help-manager@example.invalid','{}','{}'),
 ('f6100000-0000-4000-8000-000000000006','help-operational@example.invalid','{}','{}');
update public.profiles set status='active' where id in
 ('f6100000-0000-4000-8000-000000000001','f6100000-0000-4000-8000-000000000002','f6100000-0000-4000-8000-000000000003',
  'f6100000-0000-4000-8000-000000000004','f6100000-0000-4000-8000-000000000005','f6100000-0000-4000-8000-000000000006');
insert into public.user_roles(user_id,role) values
 ('f6100000-0000-4000-8000-000000000002','representative'),
 ('f6100000-0000-4000-8000-000000000003','technical'),
 ('f6100000-0000-4000-8000-000000000004','admin'),
 ('f6100000-0000-4000-8000-000000000005','manager'),
 ('f6100000-0000-4000-8000-000000000006','operational') on conflict do nothing;
-- Exercise both branches of the audience guard without changing the product's
-- explicit setting, which currently disables internal authenticator MFA.
create or replace function private.internal_mfa_satisfied()
returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce(auth.jwt()->>'aal','aal1') = 'aal2' $$;
insert into public.support_categories(id,name,slug,active,public_visible) values
 ('f6200000-0000-4000-8000-000000000001','Fixture ajuda','fixture-help-audience',true,true),
 ('f6200000-0000-4000-8000-000000000002','Fixture interna','fixture-help-internal',true,false),
 ('f6200000-0000-4000-8000-000000000003','Fixture inativa','fixture-help-inactive',false,true);

insert into public.help_contents(id,category_id,content_type,slug,title,author_id,audiences,status)
select ('f6300000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 case when i=8 then 'f6200000-0000-4000-8000-000000000002'::uuid when i=9 then 'f6200000-0000-4000-8000-000000000003'::uuid else 'f6200000-0000-4000-8000-000000000001'::uuid end,
 'article','fixture-help-audience-'||i,'Fixture ajuda '||i,
 'f6100000-0000-4000-8000-000000000001',array[(array['visitor','customer','representative','technical','admin','manager','operational','visitor','visitor'])[i]],'published'
from generate_series(1,9) i;
insert into public.help_content_versions(id,content_id,version,snapshot,change_summary,status,created_by)
select ('f6400000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 ('f6300000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,1,
 jsonb_build_object('content',jsonb_build_object('slug','fixture-help-audience-'||i,'content_type','article',
   'title','Fixture ajuda '||i,'summary','','body','Conteúdo fictício',
   'audiences',jsonb_build_array((array['visitor','customer','representative','technical','admin','manager','operational','visitor','visitor'])[i])),
   'category',jsonb_build_object('name','Fixture','slug','fixture-help-audience'),
   'related',case when i=1 then jsonb_build_array(jsonb_build_object('slug','fixture-help-audience-4','title','Conteúdo interno'),jsonb_build_object('slug','fixture-help-audience-8','title','Categoria interna')) else '[]'::jsonb end),
 'Fixture','published','f6100000-0000-4000-8000-000000000001'
from generate_series(1,9) i;
update public.help_contents set published_version_id=
 ('f6400000-0000-4000-8000-'||lpad(right(slug,1),12,'0'))::uuid
where category_id in ('f6200000-0000-4000-8000-000000000001','f6200000-0000-4000-8000-000000000002','f6200000-0000-4000-8000-000000000003');

set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
select is((select count(*) from public.published_help_contents where slug like 'fixture-help-audience-%'),1::bigint,'Visitante lê apenas conteúdo público');
select is((select count(*) from public.search_published_help('','technical',1,24) where slug like 'fixture-help-audience-%'),0::bigint,'Visitante não escolhe público interno pela RPC');
select is((select snapshot->'related' from public.published_help_contents where slug='fixture-help-audience-1'),'[]'::jsonb,'Referências internas não aparecem no conteúdo público');
select is((select count(*) from public.published_help_contents where slug='fixture-help-audience-8'),0::bigint,'Categoria interna não divulga conteúdo ao visitante');
select is((select count(*) from public.published_help_contents where slug='fixture-help-audience-9'),0::bigint,'Categoria inativa não divulga conteúdo ao visitante');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"f6100000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',true);
select is((select count(*) from public.published_help_contents where slug like 'fixture-help-audience-%'),2::bigint,'Cliente lê conteúdo público e para clientes');
select is((select count(*) from public.search_published_help('','technical',1,24) where slug like 'fixture-help-audience-%'),0::bigint,'Cliente não acessa conteúdo técnico pela RPC');

select set_config('request.jwt.claims','{"sub":"f6100000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}',true);
select is((select count(*) from public.published_help_contents where slug like 'fixture-help-audience-%'),3::bigint,'Representante lê seu público sem MFA interno');
select is((select count(*) from public.search_published_help('','technical',1,24) where slug like 'fixture-help-audience-%'),0::bigint,'Representante não acessa conteúdo técnico');

select set_config('request.jwt.claims','{"sub":"f6100000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal1"}',true);
select is((select count(*) from public.published_help_contents where slug like 'fixture-help-audience-%'),2::bigint,'Papel interno sem MFA não acessa conteúdo interno');
select set_config('request.jwt.claims','{"sub":"f6100000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}',true);
select is((select count(*) from public.search_published_help('','technical',1,24) where slug like 'fixture-help-audience-%'),1::bigint,'Papel técnico com MFA acessa seu conteúdo');
select is((select jsonb_array_length(snapshot->'related') from public.published_help_contents where slug='fixture-help-audience-1'),1,'Papel autorizado vê referência interna');
select set_config('request.jwt.claims','{"sub":"f6100000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}',true);
select is((select count(*) from public.search_published_help('','admin',1,24) where slug like 'fixture-help-audience-%'),1::bigint,'Administrador acessa seu público');
select set_config('request.jwt.claims','{"sub":"f6100000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal2"}',true);
select is((select count(*) from public.search_published_help('','manager',1,24) where slug like 'fixture-help-audience-%'),1::bigint,'Gerente acessa seu público');
select set_config('request.jwt.claims','{"sub":"f6100000-0000-4000-8000-000000000006","role":"authenticated","aal":"aal2"}',true);
select is((select count(*) from public.search_published_help('','operational',1,24) where slug like 'fixture-help-audience-%'),1::bigint,'Operacional acessa seu público');
select set_config('request.jwt.claims','{"sub":"f6100000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":true}',true);
select is((select count(*) from public.published_help_contents where slug like 'fixture-help-audience-%'),1::bigint,'Sessão anônima não recebe conteúdo de cliente');

reset role;
update public.profiles set status='suspended' where id='f6100000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"f6100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is((select count(*) from public.published_help_contents where slug like 'fixture-help-audience-%'),1::bigint,'Perfil suspenso não acessa conteúdo de cliente');
reset role;
update public.profiles set status='active',account_closed_at=now() where id='f6100000-0000-4000-8000-000000000001';
set local role authenticated;
select is((select count(*) from public.published_help_contents where slug like 'fixture-help-audience-%'),1::bigint,'Conta encerrada não acessa conteúdo de cliente');

set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is((select count(*) from public.published_help_contents where slug like 'fixture-help-audience-%'),9::bigint,'Serviço mantém acesso aos conteúdos publicados');
select * from finish();
rollback;

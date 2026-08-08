-- Central de Ajuda e atendimento: conteúdo editorial, busca, feedback e permissões.

insert into public.permissions(code, description) values
  ('support_content.view', 'Consultar conteúdo da Central de Ajuda'),
  ('support_content.create', 'Criar rascunhos de ajuda'),
  ('support_content.edit', 'Editar rascunhos de ajuda'),
  ('support_content.review', 'Revisar e aprovar conteúdo de ajuda'),
  ('support_content.publish', 'Publicar, agendar e restaurar conteúdo de ajuda'),
  ('support_ticket.view', 'Consultar chamados autorizados'),
  ('support_ticket.assign', 'Atribuir e transferir chamados'),
  ('support_ticket.reply', 'Responder chamados autorizados'),
  ('support_ticket.close', 'Resolver, encerrar e reabrir chamados'),
  ('support_settings.manage', 'Gerenciar categorias e respostas rápidas')
on conflict(code) do update set description = excluded.description;

insert into public.role_permissions(role, permission_id)
select role_name::public.app_role, permission.id
from (values
  ('manager','support_content.view'),('manager','support_content.create'),
  ('manager','support_content.edit'),('manager','support_content.review'),
  ('manager','support_content.publish'),('manager','support_ticket.view'),
  ('manager','support_ticket.assign'),('manager','support_ticket.reply'),
  ('manager','support_ticket.close'),('manager','support_settings.manage'),
  ('admin','support_content.view'),('admin','support_content.create'),
  ('admin','support_content.edit'),('admin','support_ticket.view'),
  ('admin','support_ticket.assign'),('admin','support_ticket.reply'),
  ('admin','support_ticket.close'),('admin','support_settings.manage'),
  ('operational','support_content.view'),('operational','support_content.create'),
  ('operational','support_content.edit'),('operational','support_ticket.view'),
  ('operational','support_ticket.reply'),('operational','support_ticket.close'),
  ('technical','support_ticket.view')
) assigned(role_name, permission_code)
join public.permissions permission on permission.code = assigned.permission_code
on conflict do nothing;

-- Mantém compatibilidade com as funções e políticas do atendimento já implantado.
insert into public.role_permissions(role, permission_id)
select assigned.role_name::public.app_role, permission.id
from (values
  ('manager','support.conversations.read'),('manager','support.conversations.assign'),
  ('manager','support.conversations.reply'),('manager','support.conversations.transfer'),
  ('manager','support.internal_notes.create'),('manager','support.close'),('manager','support.reopen'),
  ('admin','support.conversations.read'),('admin','support.conversations.assign'),
  ('admin','support.conversations.reply'),('admin','support.conversations.transfer'),
  ('admin','support.internal_notes.create'),('admin','support.close'),('admin','support.reopen'),
  ('operational','support.conversations.read'),('operational','support.conversations.reply'),
  ('operational','support.close'),
  ('technical','support.conversations.read'),('technical','support.conversations.reply')
) assigned(role_name,permission_code)
join public.permissions permission on permission.code=assigned.permission_code
on conflict do nothing;

alter table public.support_categories
  add column if not exists sort_order integer not null default 0,
  add column if not exists icon_name text,
  add column if not exists public_visible boolean not null default true,
  add column if not exists created_by uuid references public.profiles(id),
  add column if not exists updated_by uuid references public.profiles(id);

insert into public.support_categories(name, slug, description, sort_order, public_visible) values
  ('Conta e cadastro','conta-cadastro','Acesso, cadastro e dados da conta',10,true),
  ('Pedidos','pedidos','Pedidos e acompanhamento',20,true),
  ('Pagamentos','pagamentos','Pagamento e confirmação',30,true),
  ('Entregas e rastreamento','entregas-rastreamento','Entrega e rastreamento',40,true),
  ('Produtos e tamanhos','produtos-tamanhos','Produtos, medidas e tamanhos',50,true),
  ('Carrinho','carrinho','Uso e sincronização do carrinho',60,true),
  ('Cupons','cupons','Cupons e condições publicadas',70,true),
  ('Trocas e devoluções','trocas-devolucoes','Trocas e devoluções',80,true),
  ('Cancelamentos','cancelamentos','Cancelamentos de pedidos',90,true),
  ('Avaliações','avaliacoes','Avaliações de produtos',100,true),
  ('Segurança e privacidade','seguranca-privacidade','Segurança e privacidade',110,true),
  ('Representante Curtiz','representante-curtiz','Programa de representantes',120,true),
  ('Kits','kits','Kits do programa de representantes',130,true),
  ('Comissões','comissoes','Comissões configuradas no programa',140,true),
  ('Criativos','criativos','Criativos autorizados',150,true),
  ('Atendimento','atendimento','Central e chamados',160,true)
on conflict(slug) do nothing;

create table public.help_contents (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.support_categories(id),
  content_type text not null check(content_type in ('faq','article','tutorial','step_by_step','notice','video','document','quick_reply','contextual')),
  slug text not null unique check(slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  title text not null check(char_length(title) between 3 and 180),
  summary text not null default '' check(char_length(summary) <= 1000),
  body text not null default '' check(char_length(body) <= 30000),
  keywords text[] not null default '{}',
  synonyms text[] not null default '{}',
  audiences text[] not null default array['visitor','customer'],
  status text not null default 'draft' check(status in ('draft','under_review','changes_requested','approved','scheduled','published','outdated','archived')),
  priority integer not null default 0 check(priority between 0 and 1000),
  media jsonb not null default '[]'::jsonb,
  attachments jsonb not null default '[]'::jsonb,
  related_action jsonb,
  author_id uuid not null references public.profiles(id),
  reviewer_id uuid references public.profiles(id),
  current_version integer not null default 0,
  published_version_id uuid,
  scheduled_version_id uuid,
  scheduled_at timestamptz,
  published_at timestamptz,
  last_reviewed_at timestamptz,
  expires_at timestamptz,
  views_count bigint not null default 0,
  helpful_count bigint not null default 0,
  unhelpful_count bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(audiences <@ array['visitor','customer','representative','operational','admin','manager','technical']::text[]),
  check(jsonb_typeof(media) = 'array' and jsonb_typeof(attachments) = 'array'),
  check(related_action is null or jsonb_typeof(related_action) = 'object')
);

create table public.help_content_versions (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.help_contents(id) on delete cascade,
  version integer not null check(version > 0),
  snapshot jsonb not null,
  change_summary text not null,
  status text not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(content_id, version)
);

alter table public.help_contents add constraint help_contents_published_version_fk
  foreign key(published_version_id) references public.help_content_versions(id) on delete restrict;
alter table public.help_contents add constraint help_contents_scheduled_version_fk
  foreign key(scheduled_version_id) references public.help_content_versions(id) on delete restrict;

create table public.help_content_relations (
  content_id uuid not null references public.help_contents(id) on delete cascade,
  related_content_id uuid not null references public.help_contents(id) on delete cascade,
  sort_order integer not null default 0,
  created_by uuid not null references public.profiles(id),
  primary key(content_id, related_content_id),
  check(content_id <> related_content_id)
);

create table public.help_search_events (
  id bigint generated always as identity primary key,
  normalized_query text not null check(char_length(normalized_query) between 1 and 160),
  audience text not null,
  result_count integer not null check(result_count >= 0),
  origin text not null default 'help_center',
  created_at timestamptz not null default now()
);

create table public.help_content_feedback (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.help_contents(id) on delete cascade,
  session_id uuid not null,
  user_id uuid references public.profiles(id),
  helpful boolean not null,
  reason text check(reason is null or char_length(reason) <= 500),
  action_taken text check(action_taken is null or char_length(action_taken) <= 120),
  created_at timestamptz not null default now(),
  unique(content_id, session_id)
);

create index help_contents_category_status_idx on public.help_contents(category_id,status,priority desc);
create index help_contents_search_idx on public.help_contents using gin(
  to_tsvector('portuguese'::regconfig, coalesce(title,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(body,''))
);
create index help_contents_keywords_idx on public.help_contents using gin(keywords);
create index help_contents_synonyms_idx on public.help_contents using gin(synonyms);
create index help_search_no_result_idx on public.help_search_events(created_at desc) where result_count = 0;
create index help_feedback_content_idx on public.help_content_feedback(content_id,created_at desc);

create or replace function public.has_support_permission(p_permission text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.has_permission(p_permission) and p_permission like 'support_%';
$$;

create or replace function private.protect_help_version()
returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'published help versions are immutable'; end;
$$;
create trigger protect_help_version before update or delete on public.help_content_versions
for each row execute function private.protect_help_version();

create or replace function private.help_snapshot(p_content_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'content', to_jsonb(content) - 'published_version_id' - 'scheduled_version_id' - 'views_count' - 'helpful_count' - 'unhelpful_count',
    'category', jsonb_build_object('name',category.name,'slug',category.slug),
    'related', coalesce((select jsonb_agg(jsonb_build_object('slug',related.slug,'title',related.title) order by relation.sort_order)
      from public.help_content_relations relation join public.help_contents related on related.id=relation.related_content_id
      where relation.content_id=content.id and related.status='published' and related.published_version_id is not null),'[]'::jsonb)
  ) from public.help_contents content join public.support_categories category on category.id=content.category_id
  where content.id=p_content_id;
$$;

create or replace function private.validate_help_payload(p_payload jsonb)
returns void language plpgsql immutable set search_path = '' as $$
begin
  if p_payload->>'body' ~* '<\s*(script|iframe|object|embed)' or p_payload->>'body' ~* 'javascript\s*:' then
    raise exception 'unsafe help content';
  end if;
  if nullif(p_payload->'related_action','null'::jsonb) is not null and (
    p_payload#>>'{related_action,href}' not like '/%' or p_payload#>>'{related_action,href}' like '//%'
  ) then raise exception 'unsafe related action'; end if;
  if exists(select 1 from jsonb_array_elements(coalesce(p_payload->'media','[]'::jsonb)) media
    where media->>'url' not like 'https://%') then raise exception 'unsafe media URL'; end if;
end;
$$;

create or replace function public.create_help_content(p_payload jsonb)
returns public.help_contents language plpgsql security definer set search_path = '' as $$
declare created public.help_contents;
begin
  perform private.require_permission('support_content.create');
  perform private.validate_help_payload(p_payload);
  insert into public.help_contents(category_id,content_type,slug,title,summary,body,keywords,synonyms,audiences,priority,media,attachments,related_action,author_id)
  values(
    (p_payload->>'category_id')::uuid,p_payload->>'content_type',p_payload->>'slug',trim(p_payload->>'title'),
    trim(coalesce(p_payload->>'summary','')),trim(coalesce(p_payload->>'body','')),
    coalesce(array(select jsonb_array_elements_text(p_payload->'keywords')),'{}'),
    coalesce(array(select jsonb_array_elements_text(p_payload->'synonyms')),'{}'),
    coalesce(array(select jsonb_array_elements_text(p_payload->'audiences')),array['visitor','customer']),
    coalesce((p_payload->>'priority')::integer,0),coalesce(p_payload->'media','[]'::jsonb),
    coalesce(p_payload->'attachments','[]'::jsonb),nullif(p_payload->'related_action','null'::jsonb),auth.uid()
  ) returning * into created;
  insert into public.help_content_relations(content_id,related_content_id,sort_order,created_by)
  select created.id,value::uuid,ordinality::integer,auth.uid()
  from jsonb_array_elements_text(coalesce(p_payload->'related_ids','[]'::jsonb)) with ordinality
  where value::uuid<>created.id
  on conflict do nothing;
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized,reason)
  values(auth.uid(),private.current_app_role(),'help_content.create','help_content',created.id,jsonb_build_object('title',created.title,'status',created.status),'Criação de rascunho');
  return created;
end;
$$;

create or replace function public.save_help_content(p_id uuid,p_payload jsonb,p_change_summary text)
returns public.help_contents language plpgsql security definer set search_path = '' as $$
declare content public.help_contents; next_version integer;
begin
  perform private.require_permission('support_content.edit');
  select * into content from public.help_contents where id=p_id for update;
  if not found or content.status not in ('draft','changes_requested','outdated') then raise exception 'content is not editable'; end if;
  if private.current_app_role()='operational' and content.author_id<>auth.uid() then raise exception 'operational can edit only own suggestions'; end if;
  perform private.validate_help_payload(p_payload);
  next_version:=content.current_version+1;
  update public.help_contents set
    category_id=(p_payload->>'category_id')::uuid,content_type=p_payload->>'content_type',slug=p_payload->>'slug',
    title=trim(p_payload->>'title'),summary=trim(coalesce(p_payload->>'summary','')),body=trim(coalesce(p_payload->>'body','')),
    keywords=coalesce(array(select jsonb_array_elements_text(p_payload->'keywords')),'{}'),
    synonyms=coalesce(array(select jsonb_array_elements_text(p_payload->'synonyms')),'{}'),
    audiences=coalesce(array(select jsonb_array_elements_text(p_payload->'audiences')),array['visitor','customer']),
    priority=coalesce((p_payload->>'priority')::integer,0),media=coalesce(p_payload->'media','[]'::jsonb),
    attachments=coalesce(p_payload->'attachments','[]'::jsonb),related_action=nullif(p_payload->'related_action','null'::jsonb),
    current_version=next_version,updated_at=now()
  where id=p_id returning * into content;
  delete from public.help_content_relations where content_id=content.id;
  insert into public.help_content_relations(content_id,related_content_id,sort_order,created_by)
  select content.id,value::uuid,ordinality::integer,auth.uid()
  from jsonb_array_elements_text(coalesce(p_payload->'related_ids','[]'::jsonb)) with ordinality
  where value::uuid<>content.id
  on conflict do nothing;
  insert into public.help_content_versions(content_id,version,snapshot,change_summary,status,created_by)
  values(content.id,next_version,private.help_snapshot(content.id),trim(p_change_summary),content.status,auth.uid());
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized,reason)
  values(auth.uid(),private.current_app_role(),'help_content.save','help_content',content.id,jsonb_build_object('version',next_version,'status',content.status),trim(p_change_summary));
  return content;
end;
$$;

create or replace function public.transition_help_content(p_id uuid,p_action text,p_reason text,p_scheduled_at timestamptz default null)
returns public.help_contents language plpgsql security definer set search_path = '' as $$
declare content public.help_contents; next_status text; next_version integer; version_id uuid;
begin
  if p_action in ('submit_review') then perform private.require_permission('support_content.edit');
  elsif p_action in ('approve','reject') then perform private.require_permission('support_content.review');
  else perform private.require_permission('support_content.publish'); end if;
  if char_length(trim(p_reason))<3 then raise exception 'reason required'; end if;
  select * into content from public.help_contents where id=p_id for update;
  if not found then raise exception 'content not found'; end if;
  next_status:=case p_action when 'submit_review' then 'under_review' when 'approve' then 'approved'
    when 'reject' then 'changes_requested' when 'publish' then 'published' when 'schedule' then 'scheduled'
    when 'unpublish' then 'draft' when 'mark_outdated' then 'outdated' when 'archive' then 'archived'
    when 'restore' then 'draft' when 'begin_revision' then 'draft' else null end;
  if next_status is null then raise exception 'unsupported transition'; end if;
  if p_action='submit_review' and content.status not in ('draft','changes_requested','outdated') then raise exception 'invalid transition'; end if;
  if p_action in ('approve','reject') and content.status<>'under_review' then raise exception 'invalid transition'; end if;
  if p_action in ('publish','schedule') and content.status<>'approved' then raise exception 'approval required'; end if;
  if p_action in ('publish','schedule') and (trim(content.body)='' or trim(content.summary)='' or content.reviewer_id is null) then raise exception 'reviewed content is incomplete'; end if;
  if p_action='begin_revision' and not (content.status='published' or (content.status='scheduled' and content.scheduled_at<=now())) then raise exception 'published content required'; end if;
  if p_action='restore' and content.status<>'archived' then raise exception 'archived content required'; end if;
  if p_action='unpublish' and content.published_version_id is null and content.scheduled_version_id is null then raise exception 'content is not public or scheduled'; end if;
  if p_action='mark_outdated' and content.published_version_id is null then raise exception 'published content required'; end if;
  if p_action='approve' and content.author_id=auth.uid() then raise exception 'author cannot approve own content'; end if;
  if p_action='schedule' and (p_scheduled_at is null or p_scheduled_at<=now()) then raise exception 'future schedule required'; end if;
  if p_action in ('publish','schedule') then
    next_version:=content.current_version+1;
    insert into public.help_content_versions(content_id,version,snapshot,change_summary,status,created_by)
    values(content.id,next_version,private.help_snapshot(content.id),trim(p_reason),next_status,auth.uid()) returning id into version_id;
  end if;
  update public.help_contents set status=next_status,
    reviewer_id=case when p_action='approve' then auth.uid() else reviewer_id end,
    last_reviewed_at=case when p_action='approve' then now() else last_reviewed_at end,
    current_version=case when p_action in ('publish','schedule') then next_version else current_version end,
    published_version_id=case when p_action='publish' then version_id when p_action in ('unpublish','archive','mark_outdated') then null else published_version_id end,
    scheduled_version_id=case when p_action='schedule' then version_id when p_action in ('publish','unpublish','archive','mark_outdated') then null else scheduled_version_id end,
    published_at=case when p_action='publish' then now() else published_at end,
    scheduled_at=case when p_action='schedule' then p_scheduled_at when p_action='publish' then null else scheduled_at end,
    updated_at=now() where id=p_id returning * into content;
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized,reason)
  values(auth.uid(),private.current_app_role(),'help_content.'||p_action,'help_content',content.id,jsonb_build_object('status',content.status,'version',content.current_version),trim(p_reason));
  return content;
end;
$$;

create or replace function public.restore_help_content_version(p_version_id uuid,p_reason text)
returns public.help_contents language plpgsql security definer set search_path = '' as $$
declare version_row public.help_content_versions; source jsonb; restored public.help_contents;
begin
  perform private.require_permission('support_content.publish');
  select * into version_row from public.help_content_versions where id=p_version_id;
  if not found or char_length(trim(p_reason))<3 then raise exception 'invalid restore'; end if;
  source:=version_row.snapshot->'content';
  update public.help_contents set category_id=(source->>'category_id')::uuid,content_type=source->>'content_type',
    slug=source->>'slug',title=source->>'title',summary=coalesce(source->>'summary',''),body=coalesce(source->>'body',''),
    keywords=coalesce(array(select jsonb_array_elements_text(source->'keywords')),'{}'),
    synonyms=coalesce(array(select jsonb_array_elements_text(source->'synonyms')),'{}'),
    audiences=coalesce(array(select jsonb_array_elements_text(source->'audiences')),array['visitor','customer']),
    priority=coalesce((source->>'priority')::integer,0),media=coalesce(source->'media','[]'::jsonb),
    attachments=coalesce(source->'attachments','[]'::jsonb),related_action=source->'related_action',status='draft',updated_at=now()
  where id=version_row.content_id returning * into restored;
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized,reason)
  values(auth.uid(),private.current_app_role(),'help_content.restore','help_content',restored.id,jsonb_build_object('source_version',version_row.version),trim(p_reason));
  return restored;
end;
$$;

create or replace function public.delete_help_content_draft(p_id uuid,p_confirmation text)
returns void language plpgsql security definer set search_path = '' as $$
declare content public.help_contents;
begin
  perform private.require_permission('support_content.edit');
  select * into content from public.help_contents where id=p_id for update;
  if not found or content.status<>'draft' or content.published_version_id is not null or content.current_version>0
    or p_confirmation<>'EXCLUIR' then raise exception 'only untouched drafts can be deleted'; end if;
  delete from public.help_contents where id=p_id;
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,old_data_sanitized,reason)
  values(auth.uid(),private.current_app_role(),'help_content.delete','help_content',p_id,jsonb_build_object('title',content.title),'Exclusão confirmada de rascunho sem versões');
end;
$$;

create or replace view public.published_help_contents with (security_barrier=true) as
select content.id,version.snapshot#>>'{content,slug}' slug,version.snapshot#>>'{content,content_type}' content_type,
  coalesce((version.snapshot#>>'{content,priority}')::integer,0) priority,
  content.views_count,content.helpful_count,content.unhelpful_count,
  version.version,version.created_at as version_created_at,
  jsonb_build_object(
    'content',(version.snapshot->'content') - 'category_id' - 'author_id' - 'reviewer_id' - 'attachments' - 'created_at' - 'updated_at',
    'category',version.snapshot->'category','related',version.snapshot->'related'
  ) snapshot,
  version.snapshot#>>'{category,name}' as category_name,version.snapshot#>>'{category,slug}' as category_slug
from public.help_contents content
join public.help_content_versions version on version.id=case
  when content.scheduled_version_id is not null and content.scheduled_at<=now() then content.scheduled_version_id
  else content.published_version_id end
where content.published_version_id is not null
  or (content.scheduled_version_id is not null and content.scheduled_at<=now())
  and (content.expires_at is null or content.expires_at>now());

create or replace function public.search_published_help(p_query text,p_audience text default 'visitor',p_page integer default 1,p_page_size integer default 12)
returns table(id uuid,slug text,content_type text,title text,summary text,body text,category_name text,category_slug text,
  keywords text[],related_action jsonb,media jsonb,related jsonb,version integer,updated_at timestamptz,rank real,total_count bigint)
language sql stable security definer set search_path = '' as $$
  with candidates as (
    select view.id,view.slug,view.content_type,view.snapshot#>>'{content,title}' title,
      view.snapshot#>>'{content,summary}' summary,view.snapshot#>>'{content,body}' body,
      view.category_name,view.category_slug,
      coalesce(array(select jsonb_array_elements_text(view.snapshot#>'{content,keywords}')),'{}') keywords,
      view.snapshot#>'{content,related_action}' related_action,view.snapshot#>'{content,media}' media,
      view.snapshot->'related' related,view.version,view.version_created_at updated_at,
      case when trim(p_query)='' then (view.priority::real + least(view.views_count,1000)::real/1000)
        else ts_rank(to_tsvector('portuguese',coalesce(view.snapshot#>>'{content,title}','')||' '||coalesce(view.snapshot#>>'{content,summary}','')||' '||coalesce(view.snapshot#>>'{content,body}','')||' '||coalesce(view.snapshot#>>'{content,keywords}','')||' '||coalesce(view.snapshot#>>'{content,synonyms}','')),
          plainto_tsquery('portuguese',trim(p_query)))::real end rank
    from public.published_help_contents view
    where p_audience=any(coalesce(array(select jsonb_array_elements_text(view.snapshot#>'{content,audiences}')),'{}'))
      and (trim(p_query)='' or to_tsvector('portuguese',coalesce(view.snapshot#>>'{content,title}','')||' '||coalesce(view.snapshot#>>'{content,summary}','')||' '||coalesce(view.snapshot#>>'{content,body}','')||' '||coalesce(view.snapshot#>>'{content,keywords}','')||' '||coalesce(view.snapshot#>>'{content,synonyms}','')) @@ plainto_tsquery('portuguese',trim(p_query))
        or view.snapshot#>>'{content,title}' ilike '%'||trim(p_query)||'%')
  ) select candidates.*,count(*) over() total_count from candidates
    order by rank desc, title
    limit least(greatest(p_page_size,1),24) offset (greatest(p_page,1)-1)*least(greatest(p_page_size,1),24);
$$;

create or replace function public.record_help_search(p_query text,p_audience text,p_result_count integer,p_origin text default 'help_center')
returns void language plpgsql security definer set search_path = '' as $$
declare sanitized text;
begin
  sanitized:=left(regexp_replace(regexp_replace(lower(trim(p_query)),'[^@\s]+@[^\s]+','[email]','g'),'\m[0-9]{11,16}\M','[number]','g'),160);
  if sanitized<>'' and p_result_count>=0 and p_result_count<=10000 then
    insert into public.help_search_events(normalized_query,audience,result_count,origin)
    values(sanitized,left(p_audience,30),p_result_count,left(p_origin,40));
  end if;
end;
$$;

create or replace function public.record_help_feedback(p_content_id uuid,p_session_id uuid,p_helpful boolean,p_reason text default null,p_action text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.published_help_contents where id=p_content_id) then raise exception 'content unavailable'; end if;
  insert into public.help_content_feedback(content_id,session_id,user_id,helpful,reason,action_taken)
  values(p_content_id,p_session_id,auth.uid(),p_helpful,nullif(left(trim(coalesce(p_reason,'')),500),''),nullif(left(trim(coalesce(p_action,'')),120),''))
  on conflict(content_id,session_id) do update set helpful=excluded.helpful,reason=excluded.reason,action_taken=excluded.action_taken,created_at=now();
  update public.help_contents set helpful_count=(select count(*) from public.help_content_feedback where content_id=p_content_id and helpful),
    unhelpful_count=(select count(*) from public.help_content_feedback where content_id=p_content_id and not helpful) where id=p_content_id;
end;
$$;

create or replace function public.record_help_view(p_content_id uuid)
returns void language sql security definer set search_path = '' as $$
  update public.help_contents set views_count=views_count+1
  where id=p_content_id and exists(select 1 from public.published_help_contents published where published.id=p_content_id);
$$;

alter table public.help_contents enable row level security;
alter table public.help_contents force row level security;
alter table public.help_content_versions enable row level security;
alter table public.help_content_versions force row level security;
alter table public.help_content_relations enable row level security;
alter table public.help_content_relations force row level security;
alter table public.help_search_events enable row level security;
alter table public.help_search_events force row level security;
alter table public.help_content_feedback enable row level security;
alter table public.help_content_feedback force row level security;

create policy "support content viewers read drafts" on public.help_contents for select to authenticated using(private.has_permission('support_content.view'));
create policy "support content creators create drafts" on public.help_contents for insert to authenticated with check(private.has_permission('support_content.create') and author_id=auth.uid() and status='draft');
create policy "support content editors update drafts" on public.help_contents for update to authenticated
  using(private.has_permission('support_content.edit') and (private.current_app_role()<>'operational' or author_id=auth.uid()))
  with check(private.has_permission('support_content.edit'));
create policy "support viewers read versions" on public.help_content_versions for select to authenticated using(private.has_permission('support_content.view'));
create policy "support viewers read relations" on public.help_content_relations for select to authenticated using(private.has_permission('support_content.view'));
create policy "support editors manage relations" on public.help_content_relations for all to authenticated
  using(private.has_permission('support_content.edit')) with check(private.has_permission('support_content.edit'));
create policy "support managers read searches" on public.help_search_events for select to authenticated using(private.has_permission('support_content.review'));
create policy "support managers read feedback" on public.help_content_feedback for select to authenticated using(private.has_permission('support_content.review'));
create policy "support settings manage categories" on public.support_categories for all to authenticated
  using(private.has_permission('support_settings.manage')) with check(private.has_permission('support_settings.manage'));
create policy "support settings read saved replies" on public.support_saved_replies for select to authenticated using(private.has_permission('support_ticket.reply'));
create policy "support settings manage saved replies" on public.support_saved_replies for all to authenticated
  using(private.has_permission('support_settings.manage')) with check(private.has_permission('support_settings.manage'));

create policy "support participants read attachment files" on storage.objects for select to authenticated using(
  bucket_id='customer-private' and exists(select 1 from public.support_attachments attachment
    join public.support_messages message on message.id=attachment.message_id
    join public.support_conversations conversation on conversation.id=message.conversation_id
    where attachment.storage_path=name and private.can_access_support(conversation)
      and (conversation.customer_id<>auth.uid() or not message.is_internal_note))
);
create policy "support authors remove failed attachment uploads" on storage.objects for delete to authenticated using(
  bucket_id='customer-private' and name like auth.uid()::text || '/support/%'
);

create policy "support participants create attachment metadata" on public.support_attachments for insert to authenticated with check(
  storage_path like auth.uid()::text || '/support/%'
  and exists(select 1 from public.support_messages message
    join public.support_conversations conversation on conversation.id=message.conversation_id
    where message.id=message_id and message.sender_id=auth.uid() and private.can_access_support(conversation))
);

create or replace function private.rate_limit_support_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name='support_conversations' and (
    select count(*) from public.support_conversations where customer_id=new.customer_id and created_at>now()-interval '15 minutes'
  )>=5 then raise exception 'support rate limit exceeded' using errcode='54000'; end if;
  if tg_table_name='support_messages' and (
    select count(*) from public.support_messages where sender_id=new.sender_id and created_at>now()-interval '5 minutes'
  )>=30 then raise exception 'message rate limit exceeded' using errcode='54000'; end if;
  return new;
end;
$$;
create trigger rate_limit_support_conversation before insert on public.support_conversations
for each row execute function private.rate_limit_support_write();
create trigger rate_limit_support_message before insert on public.support_messages
for each row execute function private.rate_limit_support_write();

create or replace function public.reopen_own_support_conversation(p_conversation_id uuid,p_reason text)
returns public.support_conversations language plpgsql security definer set search_path = '' as $$
declare conversation public.support_conversations; previous_status public.support_status;
begin
  if auth.uid() is null or char_length(trim(p_reason)) not between 5 and 500 then raise exception 'invalid reopen'; end if;
  select * into conversation from public.support_conversations where id=p_conversation_id and customer_id=auth.uid() for update;
  if not found or conversation.status not in ('resolved','closed') then raise exception 'conversation cannot be reopened'; end if;
  previous_status:=conversation.status;
  update public.support_conversations set status='reopened',reopened_at=now(),closed_at=null,updated_at=now()
  where id=p_conversation_id returning * into conversation;
  insert into public.support_status_history(conversation_id,previous_status,new_status,reason,changed_by)
  values(conversation.id,previous_status,'reopened',trim(p_reason),auth.uid());
  if conversation.assigned_user_id is not null then
    insert into public.notifications(user_id,type,title,body)
    values(conversation.assigned_user_id,'support_reopened','Atendimento reaberto',conversation.public_code);
  else
    insert into public.notifications(user_id,type,title,body)
    select distinct role.user_id,'support_reopened','Atendimento reaberto',conversation.public_code
    from public.user_roles role join public.profiles profile on profile.id=role.user_id and profile.status='active'
    where role.role='admin';
  end if;
  return conversation;
end;
$$;

create or replace function public.set_support_priority(p_conversation_id uuid,p_priority public.support_priority,p_reason text)
returns public.support_conversations language plpgsql security definer set search_path = '' as $$
declare conversation public.support_conversations;
begin
  perform private.require_permission('support_ticket.close');
  if char_length(trim(p_reason))<5 then raise exception 'reason required'; end if;
  select * into conversation from public.support_conversations where id=p_conversation_id for update;
  if not found or (private.current_app_role()<>'manager' and conversation.assigned_user_id<>auth.uid()) then raise exception 'assignment required'; end if;
  update public.support_conversations set priority=p_priority,updated_at=now() where id=p_conversation_id returning * into conversation;
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized,reason)
  values(auth.uid(),private.current_app_role(),'support.priority','support_conversation',conversation.id,jsonb_build_object('priority',p_priority),trim(p_reason));
  return conversation;
end;
$$;

grant select on public.published_help_contents to anon,authenticated;
revoke all on public.help_contents,public.help_content_versions,public.help_content_relations,public.help_search_events,public.help_content_feedback from anon;
revoke insert,update,delete,truncate on public.help_content_versions,public.help_search_events,public.help_content_feedback from authenticated;
revoke all on function private.protect_help_version(),private.help_snapshot(uuid),private.validate_help_payload(jsonb) from public,anon,authenticated;
revoke all on function private.rate_limit_support_write() from public,anon,authenticated;
revoke all on function public.has_support_permission(text) from public,anon;
grant execute on function public.has_support_permission(text) to authenticated;
revoke all on function public.create_help_content(jsonb),public.save_help_content(uuid,jsonb,text),public.transition_help_content(uuid,text,text,timestamptz),public.restore_help_content_version(uuid,text),public.delete_help_content_draft(uuid,text) from public,anon;
grant execute on function public.create_help_content(jsonb),public.save_help_content(uuid,jsonb,text),public.transition_help_content(uuid,text,text,timestamptz),public.restore_help_content_version(uuid,text),public.delete_help_content_draft(uuid,text) to authenticated;
revoke all on function public.reopen_own_support_conversation(uuid,text),public.set_support_priority(uuid,public.support_priority,text) from public,anon;
grant execute on function public.reopen_own_support_conversation(uuid,text),public.set_support_priority(uuid,public.support_priority,text) to authenticated;
revoke all on function public.search_published_help(text,text,integer,integer),public.record_help_search(text,text,integer,text),public.record_help_feedback(uuid,uuid,boolean,text,text),public.record_help_view(uuid) from public;
grant execute on function public.search_published_help(text,text,integer,integer),public.record_help_search(text,text,integer,text),public.record_help_feedback(uuid,uuid,boolean,text,text),public.record_help_view(uuid) to anon,authenticated;

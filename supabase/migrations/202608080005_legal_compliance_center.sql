-- Centro de políticas e conformidade. Todo conteúdo inicial permanece como minuta.

insert into public.permissions(code, description) values
  ('legal_content.view', 'Consultar documentos jurídicos internos e versões'),
  ('legal_content.create', 'Criar minutas jurídicas'),
  ('legal_content.edit', 'Editar minutas e seções não publicadas'),
  ('legal_content.review', 'Revisar e solicitar ajustes em minutas jurídicas'),
  ('legal_content.publish', 'Aprovar, publicar e agendar documentos jurídicos'),
  ('legal_content.archive', 'Arquivar documentos jurídicos'),
  ('legal_acceptance.view', 'Consultar aceites de documentos vigentes'),
  ('privacy_request.manage', 'Gerenciar solicitações de titulares'),
  ('cookie_settings.manage', 'Gerenciar inventário e categorias de cookies')
on conflict (code) do update set description = excluded.description;

insert into public.role_permissions(role, permission_id)
select 'admin', id from public.permissions where code in (
  'legal_content.view','legal_content.create','legal_content.edit','legal_content.archive',
  'legal_acceptance.view','privacy_request.manage','cookie_settings.manage'
) on conflict do nothing;

insert into public.role_permissions(role, permission_id)
select 'manager', id from public.permissions where code like 'legal_%'
  or code in ('privacy_request.manage','cookie_settings.manage')
on conflict do nothing;

create table public.legal_documents (
  id uuid primary key default gen_random_uuid(),
  internal_name text not null check (char_length(trim(internal_name)) between 3 and 160),
  public_title text not null check (char_length(trim(public_title)) between 3 and 180),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  summary text not null default '',
  document_type text not null,
  language text not null default 'pt-BR',
  audience text not null default 'public',
  status text not null default 'draft' check (status in (
    'draft','under_review','changes_requested','legally_reviewed','approved',
    'scheduled','published','superseded','archived'
  )),
  next_version integer not null default 1 check (next_version > 0),
  effective_from timestamptz,
  effective_until timestamptz,
  review_due_at timestamptz,
  responsible_id uuid references public.profiles(id),
  reviewer_id uuid references public.profiles(id),
  requires_acceptance boolean not null default false,
  requires_new_acceptance boolean not null default false,
  display_locations text[] not null default '{}',
  change_summary text not null default '',
  internal_notes text not null default '',
  public_visible boolean not null default false,
  legally_reviewed_at timestamptz,
  approved_at timestamptz,
  approved_by uuid references public.profiles(id),
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_until is null or effective_from is null or effective_until > effective_from)
);

create table public.legal_document_sections (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.legal_documents(id) on delete cascade,
  section_number text not null check (section_number ~ '^[0-9]+(?:\.[0-9]+)*$'),
  title text not null check (char_length(trim(title)) between 2 and 180),
  content text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(document_id, section_number)
);

create table public.legal_references (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  related_article text,
  official_url text not null check (official_url like 'https://%'),
  consulted_on date not null,
  notes text not null default '',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(name, official_url)
);

create table public.legal_document_reference_links (
  document_id uuid not null references public.legal_documents(id) on delete cascade,
  reference_id uuid not null references public.legal_references(id) on delete restrict,
  primary key(document_id, reference_id)
);

create table public.legal_document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.legal_documents(id) on delete restrict,
  version integer not null check (version > 0),
  snapshot jsonb not null,
  content_hash text not null,
  effective_from timestamptz not null,
  effective_until timestamptz,
  published_by uuid not null references public.profiles(id),
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(document_id, version),
  check (effective_until is null or effective_until > effective_from)
);

create table public.legal_document_reviews (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.legal_documents(id) on delete cascade,
  reviewer_id uuid not null references public.profiles(id),
  decision text not null check (decision in (
    'submitted','changes_requested','legally_reviewed','approved','rejected','published','scheduled','archived','restored','revision_started'
  )),
  reason text not null,
  created_at timestamptz not null default now()
);

create table public.legal_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  document_version_id uuid not null references public.legal_document_versions(id) on delete restrict,
  context text not null check (context in ('signup','checkout','representative','marketing','cookies','other')),
  acceptance_type text not null default 'explicit',
  accepted boolean not null,
  accepted_at timestamptz not null default now(),
  revoked_at timestamptz,
  user_agent_summary text,
  created_at timestamptz not null default now()
);
create unique index legal_acceptances_unique_context_idx
  on public.legal_acceptances(user_id,document_version_id,context)
  where user_id is not null and revoked_at is null;

create table public.company_legal_information (
  id boolean primary key default true check (id),
  legal_name text,
  trade_name text,
  tax_id text,
  address text,
  email text,
  phone text,
  privacy_channel text,
  data_protection_contact text,
  support_channel text,
  completeness_status text not null default 'incomplete' check (completeness_status in ('incomplete','review','complete')),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

insert into public.company_legal_information(id, completeness_status)
values (true, 'incomplete') on conflict (id) do nothing;

insert into public.system_settings(key,value,is_public)
values ('privacy_request_internal_deadline','{"days":null,"requires_configuration":true}'::jsonb,false)
on conflict (key) do nothing;

create table public.cookie_categories (
  id text primary key check (id ~ '^[a-z][a-z0-9_-]*$'),
  label text not null,
  description text not null,
  required boolean not null default false,
  active boolean not null default true,
  sort_order integer not null default 0,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

create table public.cookie_definitions (
  id uuid primary key default gen_random_uuid(),
  name_pattern text not null,
  category_id text not null references public.cookie_categories(id),
  provider text not null,
  purpose text not null,
  duration_description text not null,
  first_party boolean not null default true,
  active boolean not null default true,
  last_verified_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  unique(name_pattern, provider)
);

create table public.cookie_consents (
  id uuid primary key,
  user_id uuid references public.profiles(id) on delete set null,
  policy_version text not null,
  categories jsonb not null check (jsonb_typeof(categories) = 'object'),
  origin text not null check (origin in ('banner','preferences','account')),
  revoked boolean not null default false,
  recorded_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.data_requests alter column customer_id drop not null;
alter table public.data_requests
  add column public_code text unique default ('LGPD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  add column requester_name text,
  add column requester_email extensions.citext,
  add column details text not null default '',
  add column identity_status text not null default 'pending' check (identity_status in ('pending','verified','rejected')),
  add column assigned_to uuid references public.profiles(id),
  add column response_summary text,
  add column due_at timestamptz,
  add column updated_at timestamptz not null default now();

alter table public.data_requests add constraint data_requests_requester_check
  check (customer_id is not null or requester_email is not null) not valid;

create table public.privacy_request_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.data_requests(id) on delete cascade,
  event_type text not null,
  public_note text,
  internal_note text,
  actor_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index legal_documents_status_idx on public.legal_documents(status, document_type, updated_at desc);
create index legal_versions_effective_idx on public.legal_document_versions(document_id, effective_from desc);
create index legal_acceptances_user_idx on public.legal_acceptances(user_id, accepted_at desc);
create index data_requests_privacy_idx on public.data_requests(status, requested_at desc);
create index privacy_request_events_idx on public.privacy_request_events(request_id, created_at);

insert into public.cookie_categories(id,label,description,required,active,sort_order) values
  ('essential','Essenciais','Autenticação, segurança, sessão e funcionamento solicitado pelo usuário.',true,true,1),
  ('functional','Funcionais','Preferências e atribuições solicitadas pelo usuário.',false,true,2),
  ('analytics','Analíticos','Medição de uso; permanece inativa enquanto não houver ferramenta configurada.',false,false,3),
  ('marketing','Marketing','Publicidade personalizada; permanece inativa enquanto não houver ferramenta configurada.',false,false,4)
on conflict (id) do nothing;

insert into public.cookie_definitions(name_pattern,category_id,provider,purpose,duration_description,first_party) values
  ('sb-*-auth-token','essential','Supabase Auth','Manter a sessão autenticada com segurança.','Duração definida pela sessão autenticada.',true),
  ('curtiz-demo-session','essential','Curtiz','Manter a sessão do modo de demonstração.','Até o encerramento ou expiração da sessão.',true),
  ('curtiz-cookie-preferences','essential','Curtiz','Memorizar e aplicar as escolhas de cookies do visitante.','Até 12 meses ou até nova escolha.',true),
  ('curtiz-referral-attribution','functional','Curtiz','Preservar uma indicação iniciada pelo próprio visitante.','Prazo configurado no fluxo de indicação.',true)
on conflict (name_pattern,provider) do nothing;

insert into public.legal_references(name,related_article,official_url,consulted_on,notes) values
  ('Lei Geral de Proteção de Dados Pessoais — Lei nº 13.709/2018','Arts. 7º, 9º, 18 e 20','https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm','2026-08-08','Texto oficial compilado.'),
  ('Código de Defesa do Consumidor — Lei nº 8.078/1990',null,'https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm','2026-08-08','Aplicar somente aos temas pertinentes e após revisão jurídica.'),
  ('Decreto do comércio eletrônico — Decreto nº 7.962/2013',null,'https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2013/decreto/d7962.htm','2026-08-08','Fonte oficial.'),
  ('Marco Civil da Internet — Lei nº 12.965/2014',null,'https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2014/lei/l12965.htm','2026-08-08','Fonte oficial.'),
  ('Lei Brasileira de Inclusão — Lei nº 13.146/2015',null,'https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2015/lei/l13146.htm','2026-08-08','Fonte oficial.'),
  ('Guia orientativo Cookies e Proteção de Dados Pessoais — ANPD',null,'https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia_orientativo_cookies_e_protecao_de_dados_pessoais','2026-08-08','Orientação oficial; não substitui análise jurídica.'),
  ('Direitos dos Titulares — ANPD','Art. 18 da LGPD','https://www.gov.br/anpd/pt-br/assuntos/titular-de-dados-1/direito-dos-titulares','2026-08-08','Página oficial da ANPD.'),
  ('Catálogo oficial ABNT',null,'https://www.abntcatalogo.com.br/','2026-08-08','Confirmar no catálogo as edições vigentes da NBR 6023, NBR 6024 e NBR 10520 antes da aprovação jurídica.')
on conflict (name,official_url) do nothing;

with templates(internal_name, public_title, slug, document_type, summary, requires_acceptance, locations) as (values
  ('Minuta — Termos de Uso','Termos de Uso','termos-de-uso','terms','Condições de acesso, cadastro, compra e uso da plataforma.',true,array['signup','footer']),
  ('Minuta — Aviso de Privacidade','Aviso de Privacidade','aviso-de-privacidade','privacy','Informações sobre tratamentos de dados pessoais e direitos dos titulares.',true,array['signup','checkout','footer']),
  ('Minuta — Política de Cookies','Política de Cookies','politica-de-cookies','cookies','Categorias, finalidades e controles aplicáveis aos cookies efetivamente utilizados.',false,array['cookie_banner','footer']),
  ('Minuta — Trocas e Devoluções','Trocas e Devoluções','trocas-e-devolucoes','returns','Regras e fluxo para troca, devolução e análise de produtos.',false,array['footer','account']),
  ('Minuta — Direito de Arrependimento','Direito de Arrependimento','direito-de-arrependimento','withdrawal','Orientações sobre exercício do direito de arrependimento, sujeitas à revisão jurídica.',false,array['footer']),
  ('Minuta — Entrega','Entrega','entrega','shipping','Processamento, rastreamento e tratamento de ocorrências na entrega.',false,array['footer','checkout']),
  ('Minuta — Pagamento','Pagamento','pagamento','payment','Meios efetivamente disponíveis, aprovação, cancelamento e estorno.',false,array['footer','checkout']),
  ('Minuta — Cancelamento','Cancelamento','cancelamento','cancellation','Hipóteses e fluxo de cancelamento de pedidos.',false,array['account']),
  ('Minuta — Garantia','Garantia','garantia','warranty','Condições de garantia legal e atendimento de defeitos.',false,array['footer','product']),
  ('Minuta — Atendimento','Atendimento','atendimento','support','Canais oficiais e fluxo de atendimento.',false,array['footer']),
  ('Minuta — Avaliações','Política de Avaliações','avaliacoes','reviews','Compra verificada, moderação, mídias e conteúdo proibido.',false,array['product']),
  ('Minuta — Cupons e Promoções','Cupons e Promoções','cupons-e-promocoes','promotions','Aplicação de regras comerciais versionadas e condições de ofertas.',false,array['checkout']),
  ('Minuta — Segurança','Segurança','seguranca','security','Práticas gerais de segurança sem expor controles internos sensíveis.',false,array['footer']),
  ('Minuta — Acessibilidade','Acessibilidade','acessibilidade','accessibility','Compromissos, recursos e canal de acessibilidade.',false,array['footer']),
  ('Minuta — Termos do Representante','Termos do Representante Curtiz','termos-representante','representative_terms','Regras do programa, conduta, marca, estoque e encerramento.',true,array['representative']),
  ('Minuta — Kits e Qualificação','Política de Kits e Qualificação','kits-e-qualificacao','representative_kits','Regras configuráveis e versionadas de kits e qualificação.',true,array['representative']),
  ('Minuta — Comissões','Política de Comissões','comissoes','representative_commissions','Regras configuráveis de comissões, estornos e fechamentos.',true,array['representative']),
  ('Minuta — Criativos','Política de Criativos','criativos','representative_creatives','Uso autorizado de criativos, marca e canais.',true,array['representative']),
  ('Minuta — Avisos legais','Avisos legais','avisos-legais','legal_notices','Avisos complementares aplicáveis à plataforma.',false,array['footer'])
)
insert into public.legal_documents(
  internal_name,public_title,slug,document_type,summary,requires_acceptance,display_locations,internal_notes
)
select internal_name,public_title,slug,document_type,summary,requires_acceptance,locations,
  'MINUTA: exige preenchimento dos dados empresariais configuráveis e revisão por advogado antes da aprovação.'
from templates on conflict (slug) do nothing;

insert into public.legal_document_sections(document_id,section_number,title,content,sort_order)
select document.id, section.section_number, section.title, section.content, section.sort_order
from public.legal_documents document
cross join (values
  ('1','Objeto e escopo','Esta minuta organiza o tema indicado no título. O texto definitivo deve refletir apenas práticas reais da Curtiz.',1),
  ('2','Informações configuráveis','[PREENCHER APÓS VALIDAÇÃO] Dados empresariais, canais, prazos, fornecedores e regras comerciais aplicáveis. Não publicar com placeholders.',2),
  ('3','Revisão, vigência e contato','A publicação depende de responsável, revisão jurídica, aprovação gerencial e data de vigência. O canal oficial será inserido a partir dos dados empresariais congelados na versão.',3)
) as section(section_number,title,content,sort_order)
where not exists (
  select 1 from public.legal_document_sections existing
  where existing.document_id = document.id and existing.section_number = section.section_number
);

create or replace function public.has_legal_permission(p_permission text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select p_permission in (
    'legal_content.view','legal_content.create','legal_content.edit','legal_content.review',
    'legal_content.publish','legal_content.archive','legal_acceptance.view',
    'privacy_request.manage','cookie_settings.manage'
  ) and private.has_permission(p_permission);
$$;

create or replace function public.create_legal_document(p_document jsonb, p_sections jsonb)
returns public.legal_documents
language plpgsql security definer set search_path = '' as $$
declare document public.legal_documents; section jsonb;
begin
  perform private.require_permission('legal_content.create');
  if jsonb_typeof(p_sections) <> 'array' or jsonb_array_length(p_sections) = 0 then
    raise exception 'document sections required';
  end if;
  insert into public.legal_documents(
    internal_name,public_title,slug,summary,document_type,language,audience,
    requires_acceptance,requires_new_acceptance,display_locations,change_summary,
    internal_notes,responsible_id,created_by,updated_by
  ) values (
    trim(p_document ->> 'internal_name'),trim(p_document ->> 'public_title'),trim(p_document ->> 'slug'),
    trim(coalesce(p_document ->> 'summary','')),trim(p_document ->> 'document_type'),
    coalesce(nullif(trim(p_document ->> 'language'),''),'pt-BR'),
    coalesce(nullif(trim(p_document ->> 'audience'),''),'public'),
    coalesce((p_document ->> 'requires_acceptance')::boolean,false),
    coalesce((p_document ->> 'requires_new_acceptance')::boolean,false),
    coalesce(array(select jsonb_array_elements_text(p_document -> 'display_locations')),'{}'),
    trim(coalesce(p_document ->> 'change_summary','')),
    trim(coalesce(p_document ->> 'internal_notes','')),
    auth.uid(),auth.uid(),auth.uid()
  ) returning * into document;
  for section in select * from jsonb_array_elements(p_sections) loop
    insert into public.legal_document_sections(document_id,section_number,title,content,sort_order)
    values(document.id,section ->> 'section_number',trim(section ->> 'title'),coalesce(section ->> 'content',''),
      coalesce((section ->> 'sort_order')::integer,0));
  end loop;
  insert into public.legal_document_reference_links(document_id,reference_id)
  select document.id,(reference_id)::uuid
  from jsonb_array_elements_text(coalesce(p_document -> 'reference_ids','[]'::jsonb)) reference_id
  join public.legal_references reference on reference.id=(reference_id)::uuid;
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized,reason)
  values(auth.uid(),private.current_app_role(),'legal_document.created','legal_document',document.id,
    jsonb_build_object('slug',document.slug,'status',document.status),'Criação de minuta');
  return document;
end;
$$;

create or replace function public.save_legal_document(p_document_id uuid, p_document jsonb, p_sections jsonb)
returns public.legal_documents
language plpgsql security definer set search_path = '' as $$
declare document public.legal_documents; section jsonb;
begin
  perform private.require_permission('legal_content.edit');
  select * into document from public.legal_documents where id = p_document_id for update;
  if document.id is null then raise exception 'legal document not found' using errcode = 'P0002'; end if;
  if document.status not in ('draft','changes_requested') then raise exception 'only drafts can be edited'; end if;
  if jsonb_typeof(p_sections) <> 'array' or jsonb_array_length(p_sections) = 0 then
    raise exception 'document sections required';
  end if;
  update public.legal_documents set
    internal_name=trim(p_document ->> 'internal_name'),public_title=trim(p_document ->> 'public_title'),
    slug=trim(p_document ->> 'slug'),summary=trim(coalesce(p_document ->> 'summary','')),
    document_type=trim(p_document ->> 'document_type'),
    language=coalesce(nullif(trim(p_document ->> 'language'),''),'pt-BR'),
    audience=coalesce(nullif(trim(p_document ->> 'audience'),''),'public'),
    requires_acceptance=coalesce((p_document ->> 'requires_acceptance')::boolean,false),
    requires_new_acceptance=coalesce((p_document ->> 'requires_new_acceptance')::boolean,false),
    display_locations=coalesce(array(select jsonb_array_elements_text(p_document -> 'display_locations')),'{}'),
    change_summary=trim(coalesce(p_document ->> 'change_summary','')),
    internal_notes=trim(coalesce(p_document ->> 'internal_notes','')),
    responsible_id=coalesce(responsible_id,auth.uid()),
    updated_by=auth.uid(),updated_at=now()
  where id=document.id returning * into document;
  delete from public.legal_document_sections where document_id=document.id;
  for section in select * from jsonb_array_elements(p_sections) loop
    insert into public.legal_document_sections(document_id,section_number,title,content,sort_order)
    values(document.id,section ->> 'section_number',trim(section ->> 'title'),coalesce(section ->> 'content',''),
      coalesce((section ->> 'sort_order')::integer,0));
  end loop;
  delete from public.legal_document_reference_links where document_id=document.id;
  insert into public.legal_document_reference_links(document_id,reference_id)
  select document.id,(reference_id)::uuid
  from jsonb_array_elements_text(coalesce(p_document -> 'reference_ids','[]'::jsonb)) reference_id
  join public.legal_references reference on reference.id=(reference_id)::uuid;
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized,reason)
  values(auth.uid(),private.current_app_role(),'legal_document.updated','legal_document',document.id,
    jsonb_build_object('slug',document.slug,'section_count',jsonb_array_length(p_sections)),'Edição de minuta');
  return document;
end;
$$;

create or replace function private.protect_legal_version()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'published legal versions are immutable' using errcode = '42501';
end;
$$;

create trigger protect_legal_version before update or delete on public.legal_document_versions
for each row execute function private.protect_legal_version();

create or replace function public.transition_legal_document(
  p_document_id uuid,
  p_action text,
  p_reason text,
  p_effective_from timestamptz default null
)
returns public.legal_documents
language plpgsql security definer set search_path = '' as $$
declare
  document public.legal_documents;
  company public.company_legal_information;
  snapshot jsonb;
  next_status text;
  review_permission text;
begin
  select * into document from public.legal_documents where id = p_document_id for update;
  if document.id is null then raise exception 'legal document not found' using errcode = 'P0002'; end if;
  if char_length(trim(coalesce(p_reason,''))) < 3 then raise exception 'transition reason required'; end if;

  review_permission := case
    when p_action in ('submit_review','begin_revision') then 'legal_content.edit'
    when p_action in ('request_changes','legally_reviewed','reject') then 'legal_content.review'
    when p_action in ('approve','publish','schedule','restore') then 'legal_content.publish'
    when p_action = 'archive' then 'legal_content.archive'
    else '' end;
  perform private.require_permission(review_permission);

  next_status := case p_action
    when 'submit_review' then 'under_review'
    when 'request_changes' then 'changes_requested'
    when 'legally_reviewed' then 'legally_reviewed'
    when 'approve' then 'approved'
    when 'reject' then 'changes_requested'
    when 'schedule' then 'scheduled'
    when 'publish' then 'published'
    when 'archive' then 'archived'
    when 'restore' then 'draft'
    when 'begin_revision' then 'draft'
    else null end;
  if next_status is null then raise exception 'unsupported legal transition'; end if;

  if p_action = 'submit_review' and document.status not in ('draft','changes_requested') then raise exception 'invalid legal transition'; end if;
  if p_action = 'begin_revision' and document.status not in ('published','scheduled') then raise exception 'invalid legal transition'; end if;
  if p_action in ('request_changes','legally_reviewed','reject') and document.status not in ('under_review','legally_reviewed') then raise exception 'invalid legal transition'; end if;
  if p_action = 'approve' and document.status <> 'legally_reviewed' then raise exception 'legal review required'; end if;
  if p_action in ('publish','schedule') then
    if document.status <> 'approved' or document.responsible_id is null or document.reviewer_id is null
      or document.legally_reviewed_at is null or document.approved_at is null then
      raise exception 'responsible, legal review and management approval required';
    end if;
    if not exists(select 1 from public.legal_document_sections s where s.document_id = document.id and trim(s.content) <> '') then
      raise exception 'document sections required';
    end if;
    select * into company from public.company_legal_information where id = true;
    if company.completeness_status <> 'complete' then raise exception 'company legal information is incomplete'; end if;
    if p_effective_from is null then raise exception 'effective date required'; end if;

    select jsonb_build_object(
      'document', to_jsonb(document) - 'internal_notes',
      'sections', coalesce((select jsonb_agg(
        to_jsonb(s) - 'document_id' - 'id' - 'created_at' - 'updated_at'
        order by s.sort_order, s.section_number
      )
        from public.legal_document_sections s where s.document_id = document.id),'[]'::jsonb),
      'references', coalesce((select jsonb_agg(
        to_jsonb(r) - 'id' - 'created_by' - 'created_at'
        order by r.name
      )
        from public.legal_document_reference_links link join public.legal_references r on r.id = link.reference_id
        where link.document_id = document.id),'[]'::jsonb),
      'company', to_jsonb(company) - 'updated_by'
    ) into snapshot;

    insert into public.legal_document_versions(
      document_id,version,snapshot,content_hash,effective_from,effective_until,published_by
    ) values (
      document.id,document.next_version,snapshot,
      encode(extensions.digest(convert_to(snapshot::text,'UTF8'),'sha256'),'hex'),
      p_effective_from,document.effective_until,auth.uid()
    );
  end if;

  update public.legal_documents set
    status = next_status,
    effective_from = case when p_action in ('publish','schedule') then p_effective_from else effective_from end,
    next_version = case when p_action in ('publish','schedule') then next_version + 1 else next_version end,
    legally_reviewed_at = case when p_action = 'legally_reviewed' then now() else legally_reviewed_at end,
    reviewer_id = case when p_action = 'legally_reviewed' then auth.uid() else reviewer_id end,
    approved_at = case when p_action = 'approve' then now() else approved_at end,
    approved_by = case when p_action = 'approve' then auth.uid() else approved_by end,
    public_visible = case
      when p_action in ('publish','schedule') then true
      when p_action in ('archive','restore') then false
      else public_visible end,
    updated_by = auth.uid(), updated_at = now()
  where id = document.id returning * into document;

  insert into public.legal_document_reviews(document_id,reviewer_id,decision,reason)
  values(document.id,auth.uid(),case
    when p_action = 'reject' then 'rejected'
    when p_action = 'begin_revision' then 'revision_started'
    else p_action end,trim(p_reason));
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized,reason)
  values(auth.uid(),private.current_app_role(),'legal_document.' || p_action,'legal_document',document.id,
    jsonb_build_object('status',document.status,'next_version',document.next_version),trim(p_reason));
  return document;
end;
$$;

create or replace function public.restore_legal_document_version(p_version_id uuid, p_reason text)
returns public.legal_documents
language plpgsql security definer set search_path = '' as $$
declare
  version_row public.legal_document_versions;
  document public.legal_documents;
  section jsonb;
begin
  perform private.require_permission('legal_content.publish');
  if char_length(trim(coalesce(p_reason,''))) < 3 then raise exception 'restore reason required'; end if;
  select * into version_row from public.legal_document_versions where id = p_version_id;
  if version_row.id is null then raise exception 'legal version not found' using errcode = 'P0002'; end if;
  select * into document from public.legal_documents where id = version_row.document_id for update;

  update public.legal_documents set
    public_title = coalesce(version_row.snapshot #>> '{document,public_title}', public_title),
    summary = coalesce(version_row.snapshot #>> '{document,summary}', summary),
    audience = coalesce(version_row.snapshot #>> '{document,audience}', audience),
    language = coalesce(version_row.snapshot #>> '{document,language}', language),
    status = 'draft', public_visible = false,
    change_summary = 'Restauração da versão ' || version_row.version::text || ': ' || trim(p_reason),
    legally_reviewed_at = null, approved_at = null, approved_by = null,
    updated_by = auth.uid(), updated_at = now()
  where id = document.id returning * into document;

  delete from public.legal_document_sections where document_id = document.id;
  for section in select * from jsonb_array_elements(version_row.snapshot -> 'sections') loop
    insert into public.legal_document_sections(document_id,section_number,title,content,sort_order)
    values(document.id,section ->> 'section_number',section ->> 'title',section ->> 'content',
      coalesce((section ->> 'sort_order')::integer,0));
  end loop;

  insert into public.legal_document_reviews(document_id,reviewer_id,decision,reason)
  values(document.id,auth.uid(),'restored',trim(p_reason));
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized,reason)
  values(auth.uid(),private.current_app_role(),'legal_document.version_restored','legal_document',document.id,
    jsonb_build_object('source_version',version_row.version,'status','draft'),trim(p_reason));
  return document;
end;
$$;

create or replace function public.record_cookie_consent(
  p_id uuid,
  p_policy_version text,
  p_categories jsonb,
  p_origin text,
  p_revoked boolean default false
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if jsonb_typeof(p_categories) <> 'object' or jsonb_object_length(p_categories) > 8
    or char_length(p_policy_version) > 40 or p_origin not in ('banner','preferences','account') then
    raise exception 'invalid cookie consent';
  end if;
  insert into public.cookie_consents(id,user_id,policy_version,categories,origin,revoked)
  values(p_id,auth.uid(),p_policy_version,p_categories,p_origin,p_revoked)
  on conflict(id) do update set
    user_id = coalesce(public.cookie_consents.user_id,auth.uid()),
    policy_version = excluded.policy_version,categories = excluded.categories,
    origin = excluded.origin,revoked = excluded.revoked,updated_at = now();
end;
$$;

create or replace function public.record_legal_acceptances(p_context text, p_version_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or p_context not in ('signup','checkout','representative','marketing','cookies','other')
    or cardinality(p_version_ids) = 0 or cardinality(p_version_ids) > 10 then
    raise exception 'invalid legal acceptance';
  end if;
  insert into public.legal_acceptances(user_id,document_version_id,context,acceptance_type,accepted)
  select auth.uid(),version.id,p_context,'explicit',true
  from public.legal_document_versions version
  join public.legal_documents document on document.id=version.document_id
  where version.id=any(p_version_ids) and document.requires_acceptance
    and version.effective_from<=now() and (version.effective_until is null or version.effective_until>now())
  on conflict(user_id,document_version_id,context) where user_id is not null and revoked_at is null do nothing;
end;
$$;

create or replace function public.submit_privacy_request(
  p_request_type text,
  p_requester_name text,
  p_requester_email text,
  p_details text
)
returns text language plpgsql security definer set search_path = '' as $$
declare created_request public.data_requests;
begin
  if p_request_type not in ('confirmation','access','correction','sharing','withdraw_consent','opposition','deletion','portability','automated_review','other')
    or char_length(trim(p_requester_name)) not between 3 and 120
    or p_requester_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    or char_length(trim(p_details)) not between 10 and 2000 then
    raise exception 'invalid privacy request';
  end if;
  insert into public.data_requests(customer_id,request_type,requester_name,requester_email,details,status)
  values(auth.uid(),p_request_type,trim(p_requester_name),lower(trim(p_requester_email))::extensions.citext,trim(p_details),'requested')
  returning * into created_request;
  insert into public.privacy_request_events(request_id,event_type,public_note,actor_id)
  values(created_request.id,'created','Solicitação recebida e aguardando verificação de identidade.',auth.uid());
  return created_request.public_code;
end;
$$;

create or replace function private.touch_legal_record()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger touch_legal_documents before update on public.legal_documents
for each row execute function private.touch_legal_record();
create trigger touch_legal_sections before update on public.legal_document_sections
for each row execute function private.touch_legal_record();
create trigger touch_cookie_categories before update on public.cookie_categories
for each row execute function private.touch_legal_record();
create trigger touch_cookie_definitions before update on public.cookie_definitions
for each row execute function private.touch_legal_record();
create trigger touch_company_legal_information before update on public.company_legal_information
for each row execute function private.touch_legal_record();
create trigger touch_data_requests before update on public.data_requests
for each row execute function private.touch_legal_record();

do $$ declare table_name text; begin
  foreach table_name in array array[
    'legal_documents','legal_document_sections','legal_references','legal_document_reference_links',
    'legal_document_versions','legal_document_reviews','legal_acceptances','company_legal_information',
    'cookie_categories','cookie_definitions','cookie_consents','privacy_request_events'
  ] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('alter table public.%I force row level security',table_name);
  end loop;
end $$;

create policy "legal viewers read documents" on public.legal_documents for select to authenticated
  using (private.has_permission('legal_content.view'));
create policy "legal creators create documents" on public.legal_documents for insert to authenticated
  with check (private.has_permission('legal_content.create') and created_by = auth.uid());
create policy "legal editors update drafts" on public.legal_documents for update to authenticated
  using (private.has_permission('legal_content.edit') and status in ('draft','changes_requested'))
  with check (private.has_permission('legal_content.edit') and status in ('draft','changes_requested'));

create policy "legal viewers read sections" on public.legal_document_sections for select to authenticated
  using (private.has_permission('legal_content.view'));
create policy "legal editors manage sections" on public.legal_document_sections for all to authenticated
  using (private.has_permission('legal_content.edit') and exists(
    select 1 from public.legal_documents d where d.id = document_id and d.status in ('draft','changes_requested')
  )) with check (private.has_permission('legal_content.edit') and exists(
    select 1 from public.legal_documents d where d.id = document_id and d.status in ('draft','changes_requested')
  ));

create policy "legal viewers read references" on public.legal_references for select to authenticated
  using (private.has_permission('legal_content.view'));
create policy "legal editors manage references" on public.legal_references for all to authenticated
  using (private.has_permission('legal_content.edit')) with check (private.has_permission('legal_content.edit'));
create policy "legal viewers read reference links" on public.legal_document_reference_links for select to authenticated
  using (private.has_permission('legal_content.view'));
create policy "legal editors manage reference links" on public.legal_document_reference_links for all to authenticated
  using (private.has_permission('legal_content.edit')) with check (private.has_permission('legal_content.edit'));

create policy "legal viewers read versions" on public.legal_document_versions for select to authenticated
  using (private.has_permission('legal_content.view'));
create policy "legal viewers read reviews" on public.legal_document_reviews for select to authenticated
  using (private.has_permission('legal_content.view'));
create policy "acceptance viewers read acceptances" on public.legal_acceptances for select to authenticated
  using (user_id = auth.uid() or private.has_permission('legal_acceptance.view'));

create policy "legal viewers read company information" on public.company_legal_information for select to authenticated
  using (private.has_permission('legal_content.view'));
create policy "legal editors update company information" on public.company_legal_information for update to authenticated
  using (private.has_permission('legal_content.edit')) with check (private.has_permission('legal_content.edit'));

create policy "public reads active cookie categories" on public.cookie_categories for select to anon, authenticated using (active);
create policy "cookie managers manage categories" on public.cookie_categories for all to authenticated
  using (private.has_permission('cookie_settings.manage')) with check (private.has_permission('cookie_settings.manage'));
create policy "public reads active cookie definitions" on public.cookie_definitions for select to anon, authenticated using (active);
create policy "cookie managers manage definitions" on public.cookie_definitions for all to authenticated
  using (private.has_permission('cookie_settings.manage')) with check (private.has_permission('cookie_settings.manage'));
create policy "users read own cookie consents" on public.cookie_consents for select to authenticated using (user_id = auth.uid());
create policy "privacy managers read cookie consents" on public.cookie_consents for select to authenticated
  using (private.has_permission('cookie_settings.manage'));

drop policy if exists "customer owns data requests" on public.data_requests;
create policy "customers read own privacy requests" on public.data_requests for select to authenticated
  using (customer_id = auth.uid() or private.has_permission('privacy_request.manage'));
create policy "customers create own privacy requests" on public.data_requests for insert to authenticated
  with check (customer_id = auth.uid() and private.is_active_user());
create policy "privacy managers update requests" on public.data_requests for update to authenticated
  using (private.has_permission('privacy_request.manage')) with check (private.has_permission('privacy_request.manage'));
create policy "privacy events scoped read" on public.privacy_request_events for select to authenticated
  using (exists(select 1 from public.data_requests request
    where request.id = request_id and (request.customer_id = auth.uid() or private.has_permission('privacy_request.manage'))));
create policy "privacy managers create events" on public.privacy_request_events for insert to authenticated
  with check (private.has_permission('privacy_request.manage') and actor_id = auth.uid());

create or replace view public.published_legal_documents
with (security_barrier = true) as
select distinct on (document.id)
  document.id as document_id,
  coalesce(version.snapshot #>> '{document,slug}',document.slug) as slug,
  coalesce(version.snapshot #>> '{document,public_title}',document.public_title) as public_title,
  coalesce(version.snapshot #>> '{document,summary}',document.summary) as summary,
  coalesce(version.snapshot #>> '{document,document_type}',document.document_type) as document_type,
  coalesce(version.snapshot #>> '{document,language}',document.language) as language,
  version.id as version_id, version.version,
  jsonb_build_object(
    'document', (version.snapshot -> 'document')
      - 'internal_name' - 'internal_notes' - 'responsible_id' - 'reviewer_id'
      - 'created_by' - 'updated_by' - 'approved_by' - 'public_visible',
    'sections', version.snapshot -> 'sections',
    'references', version.snapshot -> 'references',
    'company', version.snapshot -> 'company'
  ) as snapshot,
  version.effective_from, version.effective_until, version.published_at
from public.legal_documents document
join public.legal_document_versions version on version.document_id = document.id
where document.public_visible
  and version.effective_from <= now()
  and (version.effective_until is null or version.effective_until > now())
order by document.id, version.version desc;

grant select on public.published_legal_documents to anon, authenticated;
revoke insert,update,delete,truncate on public.legal_document_versions,public.legal_document_reviews,
  public.legal_acceptances,public.cookie_consents from anon,authenticated;
revoke all on function private.protect_legal_version(),private.touch_legal_record() from public,anon,authenticated;
revoke all on function public.transition_legal_document(uuid,text,text,timestamptz) from public,anon;
grant execute on function public.transition_legal_document(uuid,text,text,timestamptz) to authenticated;
revoke all on function public.restore_legal_document_version(uuid,text) from public,anon;
grant execute on function public.restore_legal_document_version(uuid,text) to authenticated;
revoke all on function public.has_legal_permission(text) from public,anon;
grant execute on function public.has_legal_permission(text) to authenticated;
revoke all on function public.create_legal_document(jsonb,jsonb),public.save_legal_document(uuid,jsonb,jsonb) from public,anon;
grant execute on function public.create_legal_document(jsonb,jsonb),public.save_legal_document(uuid,jsonb,jsonb) to authenticated;
revoke all on function public.record_cookie_consent(uuid,text,jsonb,text,boolean) from public;
grant execute on function public.record_cookie_consent(uuid,text,jsonb,text,boolean) to anon,authenticated;
revoke all on function public.record_legal_acceptances(text,uuid[]) from public,anon;
grant execute on function public.record_legal_acceptances(text,uuid[]) to authenticated;
revoke all on function public.submit_privacy_request(text,text,text,text) from public;
grant execute on function public.submit_privacy_request(text,text,text,text) to anon,authenticated;

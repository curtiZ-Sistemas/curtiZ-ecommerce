-- Importação conserva destinos/configurações. Publicação direta é aprovação do
-- responsável autorizado, nunca uma declaração de revisão jurídica.
alter table public.legal_document_sections add column content_format text not null default 'plain'
  check (content_format in ('plain','markdown'));
alter table public.legal_documents add column last_published_at timestamptz;
update public.legal_documents d set last_published_at = (
  select max(v.published_at) from public.legal_document_versions v where v.document_id = d.id
);
alter table public.legal_document_reviews add column content_hash text;
-- Retira somente escrita direta de documentos; as RPCs existentes continuam disponíveis.
revoke insert,update,delete on public.legal_documents,public.legal_document_sections from authenticated;

create function private.legal_canonical_type(p_slug text) returns text
language sql immutable set search_path = '' as $$
  select case p_slug
    when 'termos-de-uso' then 'terms' when 'aviso-de-privacidade' then 'privacy'
    when 'politica-de-cookies' then 'cookies' when 'trocas-e-devolucoes' then 'returns'
    when 'entrega' then 'shipping' when 'pagamento' then 'payment'
    when 'garantia' then 'warranty' when 'termos-representante' then 'representative_terms' end;
$$;

create function private.legal_draft_snapshot(p_id uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'document', jsonb_build_object('slug',d.slug,'public_title',d.public_title,
      'summary',d.summary,'document_type',d.document_type,'language',d.language,
      'audience',d.audience,'requires_acceptance',d.requires_acceptance,
      'requires_new_acceptance',d.requires_new_acceptance,'display_locations',d.display_locations),
    'sections',coalesce((select jsonb_agg(jsonb_build_object('section_number',s.section_number,
      'title',s.title,'content',s.content,'content_format',s.content_format,'sort_order',s.sort_order)
      order by s.sort_order,s.section_number) from public.legal_document_sections s where s.document_id=d.id),'[]'::jsonb),
    'references',coalesce((select jsonb_agg(to_jsonb(r)-'id'-'created_by'-'created_at' order by r.name)
      from public.legal_document_reference_links l join public.legal_references r on r.id=l.reference_id
      where l.document_id=d.id),'[]'::jsonb),
    'company',(select to_jsonb(c)-'updated_by'-'updated_at' from public.company_legal_information c where c.id)
  ) from public.legal_documents d where d.id=p_id;
$$;

create function private.invalidate_legal_content_approval() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (to_jsonb(new)-array['status','effective_from','effective_until','next_version','last_published_at',
      'reviewer_id','legally_reviewed_at','approved_by','approved_at','updated_at','updated_by','public_visible'])
    is distinct from (to_jsonb(old)-array['status','effective_from','effective_until','next_version','last_published_at',
      'reviewer_id','legally_reviewed_at','approved_by','approved_at','updated_at','updated_by','public_visible']) then
    new.legally_reviewed_at := null; new.reviewer_id := null;
    new.approved_at := null; new.approved_by := null;
    if new.status in ('under_review','legally_reviewed','approved') then new.status := 'draft'; end if;
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
create trigger zlegal_content_approval before update on public.legal_documents
  for each row execute function private.invalidate_legal_content_approval();

create function private.invalidate_legal_section_approval() returns trigger
language plpgsql security definer set search_path = '' as $$
declare target uuid := coalesce(new.document_id,old.document_id);
begin
  update public.legal_documents set legally_reviewed_at=null,reviewer_id=null,approved_at=null,approved_by=null,
    status=case when status in ('under_review','legally_reviewed','approved') then 'draft' else status end,
    updated_by=auth.uid() where id=target;
  return coalesce(new,old);
end;
$$;
create trigger invalidate_legal_section_approval after insert or update or delete on public.legal_document_sections
  for each row execute function private.invalidate_legal_section_approval();
create trigger invalidate_legal_reference_link_approval after insert or update or delete on public.legal_document_reference_links
  for each row execute function private.invalidate_legal_section_approval();

create function public.import_legal_policy(p_slug text,p_title text,p_sections jsonb,p_expected_updated_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d public.legal_documents; s jsonb; kind text; current_sections jsonb; result_hash text;
begin
  perform private.require_permission('legal_content.edit');
  if not (private.user_has_role('admin') or private.user_has_role('manager')) then raise exception 'legal permission denied' using errcode='42501'; end if;
  kind := private.legal_canonical_type(p_slug);
  if kind is null then raise exception 'invalid legal destination'; end if;
  if char_length(trim(p_title)) not between 3 and 180 or jsonb_typeof(p_sections) is distinct from 'array'
    or jsonb_array_length(p_sections) not between 1 and 80 or octet_length(p_sections::text)>262144 then raise exception 'invalid legal content'; end if;
  for s in select * from jsonb_array_elements(p_sections) loop
    if coalesce(s->>'section_number','') !~ '^[0-9]+(?:\.[0-9]+)*$'
      or char_length(trim(coalesce(s->>'title',''))) not between 2 and 180
      or char_length(coalesce(s->>'content','')) not between 1 and 30000
      or coalesce(s->>'content_format','') not in ('plain','markdown')
      or coalesce((s->>'sort_order')::integer,-1) not between 0 and 1000 then raise exception 'invalid legal sections'; end if;
  end loop;
  if (select count(distinct entry.value->>'section_number') from jsonb_array_elements(p_sections) as entry(value)) <> jsonb_array_length(p_sections) then raise exception 'duplicate legal sections'; end if;
  perform pg_advisory_xact_lock(hashtextextended('legal-policy:'||p_slug,0));
  select * into d from public.legal_documents where slug=p_slug for update;
  if d.id is not null then
    if d.document_type<>kind then raise exception 'invalid legal destination'; end if;
    current_sections := private.legal_draft_snapshot(d.id)->'sections';
    if d.public_title=p_title and current_sections=p_sections then
      return jsonb_build_object('document',to_jsonb(d),'unchanged',true);
    end if;
    if p_expected_updated_at is null or d.updated_at<>p_expected_updated_at then raise exception 'legal concurrent change' using errcode='40001'; end if;
  else
    if p_expected_updated_at is not null then raise exception 'legal concurrent change' using errcode='40001'; end if;
    insert into public.legal_documents(internal_name,public_title,slug,document_type,responsible_id,created_by,updated_by,
      requires_acceptance,display_locations)
      values(p_title,p_title,p_slug,kind,auth.uid(),auth.uid(),auth.uid(),kind in ('terms','representative_terms'),
        case when kind='representative_terms' then array['representative'] else array['footer'] end) returning * into d;
  end if;
  update public.legal_documents set public_title=trim(p_title),status='draft',
    legally_reviewed_at=null,reviewer_id=null,approved_at=null,approved_by=null,
    responsible_id=coalesce(responsible_id,auth.uid()),updated_by=auth.uid(),change_summary='Importação ou edição de política'
    where id=d.id;
  -- public_visible permanece: a minuta nunca retira a versão pública anterior.
  delete from public.legal_document_sections where document_id=d.id;
  for s in select * from jsonb_array_elements(p_sections) loop
    insert into public.legal_document_sections(document_id,section_number,title,content,content_format,sort_order)
      values(d.id,s->>'section_number',s->>'title',s->>'content',s->>'content_format',(s->>'sort_order')::integer);
  end loop;
  result_hash := encode(extensions.digest(convert_to(private.legal_draft_snapshot(d.id)::text,'UTF8'),'sha256'),'hex');
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized,reason)
    values(auth.uid(),private.current_app_role(),'legal_document.imported','legal_document',d.id,
      jsonb_build_object('slug',p_slug,'content_hash',result_hash),'Importação sem publicação ou aceite');
  select * into d from public.legal_documents where id=d.id;
  return jsonb_build_object('document',to_jsonb(d),'unchanged',false);
end;
$$;

create function private.legal_publication_problems(p_id uuid,p_canonical boolean default true) returns text[]
language plpgsql set search_path = '' as $$
declare d public.legal_documents; c public.company_legal_information; problems text[] := '{}'; marker text;
begin
  select * into d from public.legal_documents where id=p_id;
  if d.id is null then return array['Documento não encontrado']; end if;
  if p_canonical and private.legal_canonical_type(d.slug) is distinct from d.document_type then problems:=array_append(problems,'Destino não reconhecido'); end if;
  if d.status in ('archived','superseded','scheduled') then problems:=array_append(problems,'Documento arquivado ou agendado'); end if;
  if not exists(select 1 from public.legal_document_sections where document_id=d.id and length(trim(content))>0) then problems:=array_append(problems,'Conteúdo vazio'); end if;
  select * into c from public.company_legal_information where id for share;
  if c.completeness_status is distinct from 'complete' then problems:=array_append(problems,'Dados empresariais precisam ser conferidos'); end if;
  if length(trim(coalesce(c.legal_name,'')))<3 then problems:=array_append(problems,'Razão social'); end if;
  if regexp_replace(coalesce(c.tax_id,''),'[^0-9]','','g') !~ '^[0-9]{14}$'
    or regexp_replace(coalesce(c.tax_id,''),'[^0-9]','','g') ~ '^([0-9])\1{13}$' then problems:=array_append(problems,'CNPJ'); end if;
  if length(trim(coalesce(c.address,'')))<10 then problems:=array_append(problems,'Endereço empresarial'); end if;
  if coalesce(c.email,'') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then problems:=array_append(problems,'E-mail de atendimento'); end if;
  if length(trim(coalesce(c.privacy_channel,'')))<3 then problems:=array_append(problems,'Canal de privacidade'); end if;
  for marker in select distinct m[1] from regexp_matches(
    coalesce((select string_agg(title||E'\n'||content,E'\n') from public.legal_document_sections where document_id=d.id),'')||E'\n'||d.public_title||E'\n'||d.summary||E'\n'||coalesce(to_jsonb(c)::text,''),
    '(\[[A-ZÀ-Ý][A-ZÀ-Ý0-9_ /-]{1,120}\])','g') m loop
    problems:=array_append(problems,marker);
  end loop;
  return problems;
end;
$$;

create function public.validate_legal_policy_publication(p_documents jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare item jsonb; d public.legal_documents; results jsonb := '[]'; problems text[];
begin
  perform private.require_permission('legal_content.publish');
  if not (private.user_has_role('admin') or private.user_has_role('manager')) then raise exception 'legal permission denied' using errcode='42501'; end if;
  if jsonb_typeof(p_documents) is distinct from 'array' or jsonb_array_length(p_documents) not between 1 and 8 then raise exception 'invalid legal batch'; end if;
  for item in select * from jsonb_array_elements(p_documents) loop
    select * into d from public.legal_documents where id=(item->>'id')::uuid;
    problems := private.legal_publication_problems((item->>'id')::uuid);
    if d.updated_at is distinct from (item->>'updated_at')::timestamptz then problems:=array_append(problems,'Documento alterado por outra pessoa. Atualize a tela.'); end if;
    results:=results||jsonb_build_array(jsonb_build_object('id',item->>'id','problems',to_jsonb(problems)));
  end loop;
  return results;
end;
$$;

create function public.publish_legal_policy(p_id uuid,p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d public.legal_documents; snapshot jsonb; hash text; previous public.legal_document_versions; version_id uuid; problems text[];
begin
  perform private.require_permission('legal_content.publish');
  if not (private.user_has_role('admin') or private.user_has_role('manager')) then raise exception 'legal permission denied' using errcode='42501'; end if;
  perform 1 from public.company_legal_information where id for share;
  select * into d from public.legal_documents where id=p_id for update;
  if d.id is null then raise exception 'legal document not found'; end if;
  snapshot:=private.legal_draft_snapshot(d.id);
  hash:=encode(extensions.digest(convert_to(snapshot::text,'UTF8'),'sha256'),'hex');
  select * into previous from public.legal_document_versions where document_id=d.id order by version desc limit 1;
  -- Hash estável exclui timestamps e atores. Repetir publicação é idempotente.
  if d.status='published' and d.public_visible and previous.content_hash=hash then
    return jsonb_build_object('id',d.id,'versionId',previous.id,'unchanged',true);
  end if;
  if p_expected_updated_at is null or d.updated_at<>p_expected_updated_at then raise exception 'legal concurrent change' using errcode='40001'; end if;
  problems:=private.legal_publication_problems(d.id);
  if cardinality(problems)>0 then return jsonb_build_object('id',d.id,'problems',to_jsonb(problems)); end if;
  -- A consulta de dados empresariais mantém lock até o fim da transação.
  snapshot:=private.legal_draft_snapshot(d.id);
  hash:=encode(extensions.digest(convert_to(snapshot::text,'UTF8'),'sha256'),'hex');
  insert into public.legal_document_versions(document_id,version,snapshot,content_hash,effective_from,published_by)
    values(d.id,d.next_version,snapshot,hash,now(),auth.uid()) returning id into version_id;
  update public.legal_documents set status='published',public_visible=true,effective_from=now(),effective_until=null,
    last_published_at=now(),next_version=next_version+1,approved_by=auth.uid(),approved_at=now(),updated_by=auth.uid() where id=d.id;
  insert into public.legal_document_reviews(document_id,reviewer_id,decision,reason,content_hash) values
    (d.id,auth.uid(),'approved','Aprovação do conteúdo pelo responsável autorizado na publicação direta',hash),
    (d.id,auth.uid(),'published','Publicação da versão aprovada pelo responsável',hash);
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized,reason)
    values(auth.uid(),private.current_app_role(),'legal_document.published','legal_document',d.id,
      jsonb_build_object('version_id',version_id,'content_hash',hash),'Publicação direta pelo responsável autorizado');
  return jsonb_build_object('id',d.id,'versionId',version_id,'unchanged',false);
end;
$$;

revoke all on function private.legal_canonical_type(text),private.legal_draft_snapshot(uuid),
  private.invalidate_legal_content_approval(),private.invalidate_legal_section_approval(),private.legal_publication_problems(uuid,boolean) from public,anon,authenticated;
revoke all on function public.import_legal_policy(text,text,jsonb,timestamptz),public.validate_legal_policy_publication(jsonb),public.publish_legal_policy(uuid,timestamptz) from public,anon;
grant execute on function public.import_legal_policy(text,text,jsonb,timestamptz),public.validate_legal_policy_publication(jsonb),public.publish_legal_policy(uuid,timestamptz) to authenticated;

create function public.save_legal_document(p_document_id uuid,p_document jsonb,p_sections jsonb,p_expected_updated_at timestamptz)
returns public.legal_documents language plpgsql security definer set search_path = '' as $$
declare d public.legal_documents;
begin
  perform private.require_permission('legal_content.edit');
  select * into d from public.legal_documents where id=p_document_id for update;
  if d.id is null then raise exception 'legal document not found'; end if;
  if p_expected_updated_at is null or d.updated_at<>p_expected_updated_at then raise exception 'legal concurrent change' using errcode='40001'; end if;
  return public.save_legal_document(p_document_id,p_document,p_sections);
end;
$$;
revoke all on function public.save_legal_document(uuid,jsonb,jsonb) from authenticated;
revoke all on function public.save_legal_document(uuid,jsonb,jsonb,timestamptz) from public,anon;
grant execute on function public.save_legal_document(uuid,jsonb,jsonb,timestamptz) to authenticated;

create function private.invalidate_legal_reference_approval() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new is distinct from old then
    update public.legal_documents set legally_reviewed_at=null,reviewer_id=null,approved_at=null,approved_by=null,
      status=case when status in ('under_review','legally_reviewed','approved') then 'draft' else status end
      where id in (select document_id from public.legal_document_reference_links where reference_id=new.id);
  end if;
  return new;
end;
$$;
create trigger invalidate_legal_reference_approval after update on public.legal_references
  for each row execute function private.invalidate_legal_reference_approval();
create function private.invalidate_legal_company_approval() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (to_jsonb(new)-'updated_at'-'updated_by') is distinct from (to_jsonb(old)-'updated_at'-'updated_by') then
    update public.legal_documents set legally_reviewed_at=null,reviewer_id=null,approved_at=null,approved_by=null,
      status=case when status in ('under_review','legally_reviewed','approved') then 'draft' else status end
      where approved_at is not null or legally_reviewed_at is not null;
  end if;
  return new;
end;
$$;
create trigger invalidate_legal_company_approval after update on public.company_legal_information
  for each row execute function private.invalidate_legal_company_approval();
create function private.bind_legal_review_content() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.content_hash is null then
    new.content_hash:=encode(extensions.digest(convert_to(private.legal_draft_snapshot(new.document_id)::text,'UTF8'),'sha256'),'hex');
  end if;
  return new;
end;
$$;
create trigger bind_legal_review_content before insert on public.legal_document_reviews
  for each row execute function private.bind_legal_review_content();
revoke all on function private.invalidate_legal_reference_approval(),private.invalidate_legal_company_approval(),private.bind_legal_review_content() from public,anon,authenticated;

create function private.track_legal_publication_time() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.legal_documents set last_published_at=new.published_at where id=new.document_id;
  return new;
end;
$$;
create trigger track_legal_publication_time after insert on public.legal_document_versions
  for each row execute function private.track_legal_publication_time();
revoke all on function private.track_legal_publication_time() from public,anon,authenticated;

-- Compatibilidade do editor avançado e restauração com a formatação importada.
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
    insert into public.legal_document_sections(document_id,section_number,title,content,sort_order,content_format)
    values(document.id,section ->> 'section_number',trim(section ->> 'title'),coalesce(section ->> 'content',''),
      coalesce((section ->> 'sort_order')::integer,0),coalesce(section ->> 'content_format','plain'));
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

-- Compatibilidade do editor avançado e restauração com a formatação importada.
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
    insert into public.legal_document_sections(document_id,section_number,title,content,sort_order,content_format)
    values(document.id,section ->> 'section_number',trim(section ->> 'title'),coalesce(section ->> 'content',''),
      coalesce((section ->> 'sort_order')::integer,0),coalesce(section ->> 'content_format','plain'));
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

-- Compatibilidade do editor avançado e restauração com a formatação importada.
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
    status = 'draft',
    change_summary = 'Restauração da versão ' || version_row.version::text || ': ' || trim(p_reason),
    legally_reviewed_at = null, reviewer_id = null, approved_at = null, approved_by = null,
    updated_by = auth.uid(), updated_at = now()
  where id = document.id returning * into document;

  delete from public.legal_document_sections where document_id = document.id;
  for section in select * from jsonb_array_elements(version_row.snapshot -> 'sections') loop
    insert into public.legal_document_sections(document_id,section_number,title,content,sort_order,content_format)
    values(document.id,section ->> 'section_number',section ->> 'title',section ->> 'content',
      coalesce((section ->> 'sort_order')::integer,0),coalesce(section ->> 'content_format','plain'));
  end loop;

  insert into public.legal_document_reviews(document_id,reviewer_id,decision,reason)
  values(document.id,auth.uid(),'restored',trim(p_reason));
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized,reason)
  values(auth.uid(),private.current_app_role(),'legal_document.version_restored','legal_document',document.id,
    jsonb_build_object('source_version',version_row.version,'status','draft'),trim(p_reason));
  return document;
end;
$$;

-- O fluxo avançado preserva revisão real e passa pelas mesmas validações.
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
    if cardinality(private.legal_publication_problems(document.id,false))>0 then raise exception 'legal publication has unresolved fields'; end if;
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
    when p_action = 'submit_review' then 'submitted'
    when p_action = 'request_changes' then 'changes_requested'
    when p_action = 'reject' then 'rejected'
    when p_action = 'begin_revision' then 'revision_started'
    else p_action end,trim(p_reason));
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized,reason)
  values(auth.uid(),private.current_app_role(),'legal_document.' || p_action,'legal_document',document.id,
    jsonb_build_object('status',document.status,'next_version',document.next_version),trim(p_reason));
  return document;
end;
$$;

notify pgrst, 'reload schema';

-- Políticas podem ser publicadas incompletas. Só impedem a publicação: documento inexistente, destino
-- não reconhecido, documento arquivado/agendado e conteúdo vazio. Dados empresariais incompletos e campos
-- [MARCADOR] continuam sendo calculados e devolvidos como "pending" para o painel exibir onde corrigir.

create function private.legal_publication_blockers(p_id uuid,p_canonical boolean default true) returns text[]
language plpgsql set search_path = '' as $$
declare d public.legal_documents; problems text[] := '{}';
begin
  select * into d from public.legal_documents where id=p_id;
  if d.id is null then return array['Documento não encontrado']; end if;
  if p_canonical and private.legal_canonical_type(d.slug) is distinct from d.document_type then problems:=array_append(problems,'Destino não reconhecido'); end if;
  if d.status in ('archived','superseded','scheduled') then problems:=array_append(problems,'Documento arquivado ou agendado'); end if;
  if not exists(select 1 from public.legal_document_sections where document_id=d.id and length(trim(content))>0) then problems:=array_append(problems,'Conteúdo vazio'); end if;
  return problems;
end;
$$;

create function private.legal_publication_pending(p_id uuid,p_canonical boolean default true) returns text[]
language sql set search_path = '' as $$
  select coalesce(array_agg(p),'{}') from unnest(private.legal_publication_problems(p_id,p_canonical)) p
  where not (p = any(private.legal_publication_blockers(p_id,p_canonical)));
$$;

create or replace function public.validate_legal_policy_publication(p_documents jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare item jsonb; d public.legal_documents; results jsonb := '[]'; problems text[];
begin
  perform private.require_permission('legal_content.publish');
  if not (private.user_has_role('admin') or private.user_has_role('manager')) then raise exception 'legal permission denied' using errcode='42501'; end if;
  if jsonb_typeof(p_documents) is distinct from 'array' or jsonb_array_length(p_documents) not between 1 and 8 then raise exception 'invalid legal batch'; end if;
  for item in select * from jsonb_array_elements(p_documents) loop
    select * into d from public.legal_documents where id=(item->>'id')::uuid;
    problems := private.legal_publication_blockers((item->>'id')::uuid);
    if d.updated_at is distinct from (item->>'updated_at')::timestamptz then problems:=array_append(problems,'Documento alterado por outra pessoa. Atualize a tela.'); end if;
    results:=results||jsonb_build_array(jsonb_build_object('id',item->>'id','problems',to_jsonb(problems),
      'pending',to_jsonb(private.legal_publication_pending((item->>'id')::uuid))));
  end loop;
  return results;
end;
$$;

create or replace function public.publish_legal_policy(p_id uuid,p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d public.legal_documents; snapshot jsonb; hash text; previous public.legal_document_versions; version_id uuid;
  problems text[]; pending text[];
begin
  perform private.require_permission('legal_content.publish');
  if not (private.user_has_role('admin') or private.user_has_role('manager')) then raise exception 'legal permission denied' using errcode='42501'; end if;
  perform 1 from public.company_legal_information where id for share;
  select * into d from public.legal_documents where id=p_id for update;
  if d.id is null then raise exception 'legal document not found'; end if;
  snapshot:=private.legal_draft_snapshot(d.id);
  hash:=encode(extensions.digest(convert_to(snapshot::text,'UTF8'),'sha256'),'hex');
  select * into previous from public.legal_document_versions where document_id=d.id order by version desc limit 1;
  pending:=private.legal_publication_pending(d.id);
  -- Hash estável exclui timestamps e atores. Repetir publicação é idempotente.
  if d.status='published' and d.public_visible and previous.content_hash=hash then
    return jsonb_build_object('id',d.id,'versionId',previous.id,'unchanged',true,'pending',to_jsonb(pending));
  end if;
  if p_expected_updated_at is null or d.updated_at<>p_expected_updated_at then raise exception 'legal concurrent change' using errcode='40001'; end if;
  problems:=private.legal_publication_blockers(d.id);
  if cardinality(problems)>0 then return jsonb_build_object('id',d.id,'problems',to_jsonb(problems)); end if;
  -- A consulta de dados empresariais mantém lock até o fim da transação.
  snapshot:=private.legal_draft_snapshot(d.id);
  hash:=encode(extensions.digest(convert_to(snapshot::text,'UTF8'),'sha256'),'hex');
  pending:=private.legal_publication_pending(d.id);
  insert into public.legal_document_versions(document_id,version,snapshot,content_hash,effective_from,published_by)
    values(d.id,d.next_version,snapshot,hash,now(),auth.uid()) returning id into version_id;
  update public.legal_documents set status='published',public_visible=true,effective_from=now(),effective_until=null,
    last_published_at=now(),next_version=next_version+1,approved_by=auth.uid(),approved_at=now(),updated_by=auth.uid() where id=d.id;
  insert into public.legal_document_reviews(document_id,reviewer_id,decision,reason,content_hash) values
    (d.id,auth.uid(),'approved','Aprovação do conteúdo pelo responsável autorizado na publicação direta',hash),
    (d.id,auth.uid(),'published','Publicação da versão aprovada pelo responsável',hash);
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized,reason)
    values(auth.uid(),private.current_app_role(),'legal_document.published','legal_document',d.id,
      jsonb_build_object('version_id',version_id,'content_hash',hash,'pending',to_jsonb(pending)),
      case when cardinality(pending)>0 then 'Publicação direta com pendências pelo responsável autorizado'
        else 'Publicação direta pelo responsável autorizado' end);
  return jsonb_build_object('id',d.id,'versionId',version_id,'unchanged',false,'pending',to_jsonb(pending));
end;
$$;

-- O fluxo avançado preserva revisão real; pendências de conteúdo deixam de bloquear a publicação.
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
    -- Dados empresariais e campos pendentes não bloqueiam; o painel continua listando o que falta.
    select * into company from public.company_legal_information where id = true;
    if cardinality(private.legal_publication_blockers(document.id,false))>0 then raise exception 'legal publication blocked'; end if;
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

revoke all on function private.legal_publication_blockers(uuid,boolean),private.legal_publication_pending(uuid,boolean) from public,anon,authenticated;

notify pgrst, 'reload schema';

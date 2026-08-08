-- Construtor profissional e versionado da página inicial Curtiz.

insert into public.permissions(code, description) values
  ('homepage.view', 'Visualizar o construtor da página inicial'),
  ('homepage.create', 'Criar seções da página inicial'),
  ('homepage.edit', 'Editar, duplicar e ordenar rascunhos da página inicial'),
  ('homepage.review', 'Revisar e aprovar seções da página inicial'),
  ('homepage.publish', 'Publicar, agendar e restaurar a página inicial'),
  ('homepage.lock', 'Bloquear seções da página inicial'),
  ('homepage.permissions.manage', 'Configurar permissões do construtor'),
  ('homepage.media.manage', 'Enviar e organizar mídias da página inicial'),
  ('homepage.metrics.read', 'Consultar métricas da página inicial'),
  ('homepage.audit.read', 'Consultar auditoria da página inicial'),
  ('homepage.technical.observe', 'Consultar diagnósticos técnicos da página inicial')
on conflict (code) do update set description=excluded.description;

insert into public.role_permissions(role, permission_id)
select mapping.role::public.app_role, permission.id
from (values
  ('manager','homepage.view'),('manager','homepage.create'),('manager','homepage.edit'),
  ('manager','homepage.review'),('manager','homepage.publish'),('manager','homepage.lock'),
  ('manager','homepage.permissions.manage'),('manager','homepage.media.manage'),
  ('manager','homepage.metrics.read'),('manager','homepage.audit.read'),
  ('admin','homepage.view'),('admin','homepage.create'),('admin','homepage.edit'),
  ('admin','homepage.media.manage'),
  ('operational','homepage.view'),('operational','homepage.media.manage'),
  ('technical','homepage.technical.observe')
) as mapping(role, code)
join public.permissions permission on permission.code=mapping.code
on conflict do nothing;

insert into public.system_settings(key,value,is_public) values
  ('homepage_limits','{"max_sections":40,"max_items_per_section":24,"max_images_per_section":12,"max_video_bytes":52428800}'::jsonb,false),
  ('homepage_external_hosts','[]'::jsonb,false)
on conflict (key) do nothing;

create table public.home_pages (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null check (char_length(name) between 3 and 120),
  published_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.home_pages(slug,name) values ('principal','Página inicial') on conflict (slug) do nothing;

drop trigger if exists version_homepage_section on public.homepage_sections;
drop policy if exists "public reads active homepage sections" on public.homepage_sections;
drop policy if exists "admin and manager manage homepage sections" on public.homepage_sections;

alter table public.homepage_sections drop constraint if exists homepage_sections_section_type_check;
update public.homepage_sections set section_type='image_links' where section_type in ('banner_promo','custom_banner');
alter table public.homepage_sections
  add column if not exists home_page_id uuid references public.home_pages(id),
  add column if not exists internal_name text,
  add column if not exists description text,
  add column if not exists layout text not null default 'content_centered',
  add column if not exists status text not null default 'draft',
  add column if not exists visibility text not null default 'all',
  add column if not exists style_config jsonb not null default '{}'::jsonb,
  add column if not exists content_config jsonb not null default '{}'::jsonb,
  add column if not exists locked boolean not null default false,
  add column if not exists revision integer not null default 1,
  add column if not exists current_version_id uuid,
  add column if not exists submitted_at timestamptz,
  add column if not exists reviewed_by uuid references public.profiles(id),
  add column if not exists reviewed_at timestamptz,
  add column if not exists status_reason text;

update public.homepage_sections
set home_page_id=(select id from public.home_pages where slug='principal'),
    internal_name=coalesce(nullif(trim(title),''),'Seção ' || left(id::text,8)),
    status=case when active then 'published' else 'hidden' end,
    content_config=coalesce(settings,'{}'::jsonb)
where home_page_id is null or internal_name is null;

alter table public.homepage_sections
  alter column home_page_id set not null,
  alter column internal_name set not null,
  add constraint homepage_sections_type_check check (section_type in (
    'banner_hero','product_carousel','product_grid','product_horizontal','categories_grid',
    'models_grid','brands_strip','collections_grid','image_links','image_mosaic',
    'promotions','flash_offers','best_sellers','launches','featured_products',
    'recommended_products','manual_products','campaigns','benefits','reviews_carousel',
    'editorial','video','image_text','countdown','newsletter','institutional',
    'quick_links','safe_component'
  )),
  add constraint homepage_sections_status_check check (status in (
    'draft','pending_review','approved','scheduled','published','hidden','expired','archived','rejected'
  )),
  add constraint homepage_sections_layout_check check (layout in (
    'one_column','two_equal','two_featured','three_equal','three_centered','four_columns',
    'editorial_mosaic','carousel','grid','horizontal_strip','full_width','content_centered'
  )),
  add constraint homepage_sections_visibility_check check (visibility in ('all','desktop','tablet','mobile')),
  add constraint homepage_sections_name_check check (char_length(internal_name) between 3 and 120),
  add constraint homepage_sections_revision_check check (revision > 0),
  add constraint homepage_sections_dates_check check (ends_at is null or starts_at is null or ends_at > starts_at);

alter table public.homepage_section_versions
  add column if not exists status text not null default 'draft',
  add column if not exists change_summary text,
  add column if not exists approved_by uuid references public.profiles(id),
  add column if not exists approved_at timestamptz,
  add column if not exists published_at timestamptz,
  add column if not exists snapshot_hash text;

create table public.home_section_items (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.homepage_sections(id) on delete cascade,
  item_type text not null default 'content',
  internal_name text not null,
  title text,
  subtitle text,
  description text,
  alt_text text,
  decorative boolean not null default false,
  target_type text not null default 'none',
  target_id uuid,
  target_route text,
  sort_order integer not null default 0,
  active boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(internal_name) between 1 and 120),
  check (target_type in ('none','product','category','subcategory','model','brand','collection','campaign','page','guide','search','offer','external_url')),
  check (target_route is null or (target_route like '/%' and target_route not like '//%') or target_route like 'https://%')
);

create table public.home_section_item_media (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.homepage_sections(id) on delete cascade,
  item_id uuid references public.home_section_items(id) on delete cascade,
  media_role text not null check (media_role in ('desktop','tablet','mobile','video','background','thumbnail')),
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp','video/mp4','video/webm')),
  alt_text text,
  decorative boolean not null default false,
  size_bytes bigint not null check (size_bytes between 1 and 52428800),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (decorative or nullif(trim(alt_text),'') is not null)
);

create table public.home_section_schedules (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.homepage_sections(id) on delete cascade,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text not null default 'America/Sao_Paulo' check (timezone='America/Sao_Paulo'),
  recurrence text not null default 'none' check (recurrence in ('none','daily','weekly','monthly')),
  restore_previous boolean not null default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create table public.home_section_approvals (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.homepage_sections(id) on delete cascade,
  version_id uuid not null references public.homepage_section_versions(id) on delete cascade,
  reviewer_id uuid not null references public.profiles(id),
  decision text not null check (decision in ('approved','rejected','changes_requested')),
  reason text not null check (char_length(reason) between 3 and 1000),
  created_at timestamptz not null default now()
);

create table public.home_page_versions (
  id uuid primary key default gen_random_uuid(),
  home_page_id uuid not null references public.home_pages(id) on delete cascade,
  version integer not null,
  status text not null check (status in ('scheduled','published','cancelled','superseded')),
  manifest jsonb not null,
  reason text not null,
  scheduled_at timestamptz,
  published_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(home_page_id,version),
  check ((status='scheduled' and scheduled_at is not null) or status<>'scheduled')
);

alter table public.home_pages drop constraint if exists home_pages_published_version_id_fkey;
alter table public.home_pages add constraint home_pages_published_version_id_fkey
  foreign key(published_version_id) references public.home_page_versions(id);

create table public.home_section_metrics (
  section_version_id uuid not null references public.homepage_section_versions(id) on delete cascade,
  item_key text not null default '',
  metric_date date not null default current_date,
  device text not null check (device in ('desktop','tablet','mobile')),
  views bigint not null default 0 check (views >= 0),
  clicks bigint not null default 0 check (clicks >= 0),
  primary key(section_version_id,item_key,metric_date,device)
);

create table public.home_section_audit_logs (
  id uuid primary key default gen_random_uuid(),
  section_id uuid references public.homepage_sections(id) on delete set null,
  actor_id uuid references public.profiles(id),
  actor_role public.app_role,
  action text not null,
  previous_data jsonb,
  new_data jsonb,
  reason text,
  created_at timestamptz not null default now()
);

create index homepage_sections_builder_idx on public.homepage_sections(home_page_id,status,sort_order);
create index homepage_versions_section_idx on public.homepage_section_versions(section_id,version desc);
create index home_items_section_idx on public.home_section_items(section_id,sort_order) where active;
create index home_page_versions_schedule_idx on public.home_page_versions(home_page_id,status,scheduled_at desc);
create index home_metrics_period_idx on public.home_section_metrics(metric_date desc,section_version_id);

create or replace function public.has_homepage_permission(p_permission text)
returns boolean language sql stable security definer set search_path=''
as $$ select private.has_permission(p_permission); $$;

create or replace function private.validate_homepage_json(p_value jsonb)
returns void language plpgsql immutable set search_path=''
as $$
declare source text:=lower(coalesce(p_value::text,''));
begin
  if char_length(source)>50000 then raise exception 'homepage configuration is too large'; end if;
  if source ~ '<[[:space:]]*script|javascript:|data:text/html|onerror[[:space:]]*=|onload[[:space:]]*=' then
    raise exception 'unsafe homepage configuration';
  end if;
end $$;

create or replace function private.homepage_section_snapshot(p_section_id uuid)
returns jsonb language sql stable security definer set search_path=''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id',section.id,'internalName',section.internal_name,'sectionType',section.section_type,
    'title',section.title,'subtitle',section.subtitle,'description',section.description,
    'layout',section.layout,'visibility',section.visibility,'style',section.style_config,
    'content',section.content_config,'startsAt',section.starts_at,'endsAt',section.ends_at,
    'sortOrder',section.sort_order,
    'items',coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id',item.id,'itemType',item.item_type,'internalName',item.internal_name,
      'title',item.title,'subtitle',item.subtitle,'description',item.description,
      'altText',item.alt_text,'decorative',item.decorative,'targetType',item.target_type,
      'targetId',item.target_id,'targetRoute',item.target_route,'sortOrder',item.sort_order,
      'config',item.config,
      'media',coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id',media.id,'role',media.media_role,'path',media.storage_path,'mimeType',media.mime_type,
        'altText',media.alt_text,'decorative',media.decorative,'sizeBytes',media.size_bytes,'width',media.width,'height',media.height
      )) order by media.media_role) from public.home_section_item_media media where media.item_id=item.id),'[]'::jsonb)
    )) order by item.sort_order,item.id) from public.home_section_items item where item.section_id=section.id and item.active),'[]'::jsonb)
  )) from public.homepage_sections section where section.id=p_section_id;
$$;

create or replace function private.protect_homepage_version()
returns trigger language plpgsql set search_path=''
as $$
begin
  if tg_op='DELETE' then raise exception 'homepage version snapshots are immutable'; end if;
  if new.id<>old.id or new.section_id<>old.section_id or new.version<>old.version or new.snapshot<>old.snapshot or new.changed_by is distinct from old.changed_by or new.created_at<>old.created_at then
    raise exception 'homepage version snapshots are immutable';
  end if;
  return new;
end $$;

drop trigger if exists protect_homepage_version on public.homepage_section_versions;
create trigger protect_homepage_version before update or delete on public.homepage_section_versions
for each row execute function private.protect_homepage_version();

create or replace function public.save_homepage_section(p_payload jsonb,p_expected_revision integer default null)
returns uuid language plpgsql security definer set search_path=''
as $$
declare v_section_id uuid; section_row public.homepage_sections; next_version integer; version_id uuid; item jsonb; media_item jsonb; item_id uuid; external_host text; media_count integer;
declare allowed_types constant text[]:=array['banner_hero','product_carousel','product_grid','product_horizontal','categories_grid','models_grid','brands_strip','collections_grid','image_links','image_mosaic','promotions','flash_offers','best_sellers','launches','featured_products','recommended_products','manual_products','campaigns','benefits','reviews_carousel','editorial','video','image_text','countdown','newsletter','institutional','quick_links','safe_component'];
begin
  v_section_id:=nullif(p_payload->>'id','')::uuid;
  if v_section_id is null then perform private.require_permission('homepage.create'); else perform private.require_permission('homepage.edit'); end if;
  perform private.validate_homepage_json(p_payload);
  if not (p_payload->>'sectionType'=any(allowed_types)) then raise exception 'unsupported homepage section type'; end if;
  if char_length(trim(coalesce(p_payload->>'internalName','')))<3 then raise exception 'internal name is required'; end if;
  if coalesce(p_payload->>'layout','content_centered') not in ('one_column','two_equal','two_featured','three_equal','three_centered','four_columns','editorial_mosaic','carousel','grid','horizontal_strip','full_width','content_centered') then raise exception 'invalid homepage layout'; end if;
  if jsonb_array_length(coalesce(p_payload->'items','[]'::jsonb))>24 then raise exception 'homepage item limit exceeded'; end if;
  select coalesce(sum(jsonb_array_length(coalesce(value->'media','[]'::jsonb))),0)::integer into media_count from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb));
  if media_count>12 then raise exception 'homepage media limit exceeded'; end if;
  if v_section_id is null then
    if (select count(*) from public.homepage_sections where home_page_id=(select id from public.home_pages where slug='principal') and status<>'archived')>=40 then raise exception 'homepage section limit exceeded'; end if;
    insert into public.homepage_sections(home_page_id,internal_name,section_type,title,subtitle,description,layout,visibility,style_config,content_config,active,starts_at,ends_at,sort_order,status,created_by,updated_by)
    values((select id from public.home_pages where slug='principal'),trim(p_payload->>'internalName'),p_payload->>'sectionType',nullif(trim(p_payload->>'title'),''),nullif(trim(p_payload->>'subtitle'),''),nullif(trim(p_payload->>'description'),''),coalesce(p_payload->>'layout','content_centered'),coalesce(p_payload->>'visibility','all'),coalesce(p_payload->'style','{}'::jsonb),coalesce(p_payload->'content','{}'::jsonb),false,nullif(p_payload->>'startsAt','')::timestamptz,nullif(p_payload->>'endsAt','')::timestamptz,coalesce((p_payload->>'sortOrder')::integer,0),'draft',auth.uid(),auth.uid()) returning * into section_row;
    v_section_id:=section_row.id;
  else
    select * into section_row from public.homepage_sections where id=v_section_id for update;
    if section_row.id is null then raise exception 'homepage section not found'; end if;
    if section_row.locked and not private.has_permission('homepage.lock') then raise exception 'homepage section is locked' using errcode='42501'; end if;
    if p_expected_revision is not null and section_row.revision<>p_expected_revision then raise exception 'homepage revision conflict' using errcode='40001'; end if;
    if private.current_app_role()='operational' and section_row.created_by<>auth.uid() then raise exception 'operational can only edit own drafts' using errcode='42501'; end if;
    update public.homepage_sections set internal_name=trim(p_payload->>'internalName'),section_type=p_payload->>'sectionType',title=nullif(trim(p_payload->>'title'),''),subtitle=nullif(trim(p_payload->>'subtitle'),''),description=nullif(trim(p_payload->>'description'),''),layout=coalesce(p_payload->>'layout','content_centered'),visibility=coalesce(p_payload->>'visibility','all'),style_config=coalesce(p_payload->'style','{}'::jsonb),content_config=coalesce(p_payload->'content','{}'::jsonb),starts_at=nullif(p_payload->>'startsAt','')::timestamptz,ends_at=nullif(p_payload->>'endsAt','')::timestamptz,sort_order=coalesce((p_payload->>'sortOrder')::integer,sort_order),status='draft',status_reason=null,revision=revision+1,updated_by=auth.uid(),updated_at=now() where id=v_section_id returning * into section_row;
    delete from public.home_section_items existing_item where existing_item.section_id=v_section_id;
  end if;
  for item in select value from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb)) loop
    perform private.validate_homepage_json(item);
    if coalesce(item->>'targetRoute','')<>'' and not ((item->>'targetRoute' like '/%' and item->>'targetRoute' not like '//%') or item->>'targetRoute' like 'https://%') then raise exception 'invalid homepage target'; end if;
    if coalesce(item->>'targetType','none')='external_url' then
      external_host:=lower(substring(item->>'targetRoute' from '^https://([^/:?#]+)'));
      if external_host is null or not exists(select 1 from public.system_settings setting,jsonb_array_elements_text(setting.value) host where setting.key='homepage_external_hosts' and lower(host)=external_host) then raise exception 'external homepage host is not authorized'; end if;
    elsif coalesce(item->>'targetRoute','') like 'https://%' then raise exception 'external homepage target type is required';
    end if;
    if item->>'targetType'='product' and not exists(select 1 from public.products product where product.id=nullif(item->>'targetId','')::uuid and product.status='active') then raise exception 'homepage product target is unavailable'; end if;
    if item->>'targetType' in ('category','subcategory') and not exists(select 1 from public.categories category where category.id=nullif(item->>'targetId','')::uuid and category.active) then raise exception 'homepage category target is unavailable'; end if;
    if item->>'targetType'='model' and not exists(select 1 from public.product_models model where model.id=nullif(item->>'targetId','')::uuid and model.active) then raise exception 'homepage model target is unavailable'; end if;
    if item->>'targetType'='collection' and not exists(select 1 from public.collections collection where collection.id=nullif(item->>'targetId','')::uuid and collection.active) then raise exception 'homepage collection target is unavailable'; end if;
    if coalesce((item->>'decorative')::boolean,false)=false and jsonb_array_length(coalesce(item->'media','[]'::jsonb))>0 and nullif(trim(item->>'altText'),'') is null then raise exception 'alternative text is required'; end if;
    insert into public.home_section_items(section_id,item_type,internal_name,title,subtitle,description,alt_text,decorative,target_type,target_id,target_route,sort_order,active,config,created_by,updated_by)
    values(v_section_id,coalesce(item->>'itemType','content'),coalesce(nullif(trim(item->>'internalName'),''),'Item'),nullif(trim(item->>'title'),''),nullif(trim(item->>'subtitle'),''),nullif(trim(item->>'description'),''),nullif(trim(item->>'altText'),''),coalesce((item->>'decorative')::boolean,false),coalesce(item->>'targetType','none'),nullif(item->>'targetId','')::uuid,nullif(item->>'targetRoute',''),coalesce((item->>'sortOrder')::integer,0),true,coalesce(item->'config','{}'::jsonb),auth.uid(),auth.uid()) returning id into item_id;
    for media_item in select value from jsonb_array_elements(coalesce(item->'media','[]'::jsonb)) loop
      if media_item->>'path' like '%..%' or not (media_item->>'path' like 'home-sections/%' or media_item->>'path' like 'home-section-images/%' or media_item->>'path' like 'home-section-mobile-images/%' or media_item->>'path' like 'home-section-videos/%' or media_item->>'path' like 'home-section-thumbnails/%') or not exists(select 1 from storage.objects stored where stored.bucket_id='homepage-public' and stored.name=media_item->>'path') then raise exception 'homepage media is unavailable'; end if;
      insert into public.home_section_item_media(section_id,item_id,media_role,storage_path,mime_type,alt_text,decorative,size_bytes,created_by)
      values(v_section_id,item_id,coalesce(media_item->>'role','desktop'),media_item->>'path',coalesce(media_item->>'mimeType','image/webp'),nullif(trim(item->>'altText'),''),coalesce((item->>'decorative')::boolean,false),greatest(coalesce((media_item->>'sizeBytes')::bigint,1),1),auth.uid());
    end loop;
  end loop;
  select coalesce(max(existing_version.version),0)+1 into next_version from public.homepage_section_versions existing_version where existing_version.section_id=v_section_id;
  insert into public.homepage_section_versions(section_id,version,snapshot,changed_by,status,change_summary,snapshot_hash)
  values(v_section_id,next_version,private.homepage_section_snapshot(v_section_id),auth.uid(),'draft',nullif(trim(p_payload->>'changeSummary'),''),pg_catalog.encode(extensions.digest(pg_catalog.convert_to(private.homepage_section_snapshot(v_section_id)::text,'UTF8'),'sha256'),'hex')) returning id into version_id;
  update public.homepage_sections set current_version_id=version_id where id=v_section_id;
  insert into public.home_section_audit_logs(section_id,actor_id,actor_role,action,new_data,reason) values(v_section_id,auth.uid(),private.current_app_role(),'homepage.section.saved',jsonb_build_object('version',next_version,'revision',section_row.revision),nullif(trim(p_payload->>'changeSummary'),''));
  return v_section_id;
end $$;

create or replace function public.transition_homepage_section(p_section_id uuid,p_action text,p_reason text)
returns void language plpgsql security definer set search_path=''
as $$
declare section_row public.homepage_sections; version_author uuid;
begin
  select * into section_row from public.homepage_sections where id=p_section_id for update;
  if section_row.id is null then raise exception 'homepage section not found'; end if;
  if p_action='submit_review' then
    perform private.require_permission('homepage.edit');
    if section_row.status not in ('draft','rejected') then raise exception 'invalid homepage transition'; end if;
    update public.homepage_sections set status='pending_review',submitted_at=now(),status_reason=null where id=p_section_id;
    update public.homepage_section_versions set status='pending_review' where id=section_row.current_version_id;
  elsif p_action in ('approve','reject') then
    perform private.require_permission('homepage.review');
    if section_row.status<>'pending_review' then raise exception 'invalid homepage transition'; end if;
    select changed_by into version_author from public.homepage_section_versions where id=section_row.current_version_id;
    if version_author=auth.uid() then raise exception 'author cannot review own homepage section'; end if;
    if char_length(trim(coalesce(p_reason,'')))<3 then raise exception 'review reason is required'; end if;
    update public.homepage_sections set status=case when p_action='approve' then 'approved' else 'rejected' end,reviewed_by=auth.uid(),reviewed_at=now(),status_reason=trim(p_reason) where id=p_section_id;
    update public.homepage_section_versions set status=case when p_action='approve' then 'approved' else 'rejected' end,approved_by=case when p_action='approve' then auth.uid() else null end,approved_at=case when p_action='approve' then now() else null end where id=section_row.current_version_id;
    insert into public.home_section_approvals(section_id,version_id,reviewer_id,decision,reason) values(p_section_id,section_row.current_version_id,auth.uid(),case when p_action='approve' then 'approved' else 'rejected' end,trim(p_reason));
  elsif p_action in ('hide','archive','restore','lock','unlock') then
    perform private.require_permission(case when p_action in ('lock','unlock') then 'homepage.lock' else 'homepage.publish' end);
    if char_length(trim(coalesce(p_reason,'')))<3 then raise exception 'reason is required'; end if;
    update public.homepage_sections set status=case p_action when 'hide' then 'hidden' when 'archive' then 'archived' when 'restore' then 'draft' else status end,locked=case when p_action='lock' then true when p_action='unlock' then false else locked end,status_reason=trim(p_reason),updated_by=auth.uid(),updated_at=now() where id=p_section_id;
  else raise exception 'unsupported homepage transition'; end if;
  insert into public.home_section_audit_logs(section_id,actor_id,actor_role,action,previous_data,new_data,reason) values(p_section_id,auth.uid(),private.current_app_role(),'homepage.section.'||p_action,jsonb_build_object('status',section_row.status),jsonb_build_object('action',p_action),trim(p_reason));
end $$;

create or replace function public.reorder_homepage_sections(p_section_ids uuid[],p_expected_revisions integer[])
returns void language plpgsql security definer set search_path=''
as $$
declare index integer; section_row public.homepage_sections;
begin
  perform private.require_permission('homepage.edit');
  if coalesce(array_length(p_section_ids,1),0)=0 or array_length(p_section_ids,1)<>array_length(p_expected_revisions,1) or array_length(p_section_ids,1)>40 then raise exception 'invalid homepage order'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('curtiz:homepage-order'));
  for index in 1..array_length(p_section_ids,1) loop
    select * into section_row from public.homepage_sections where id=p_section_ids[index] for update;
    if section_row.id is null or section_row.revision<>p_expected_revisions[index] then raise exception 'homepage revision conflict' using errcode='40001'; end if;
    update public.homepage_sections set sort_order=index,revision=revision+1,updated_by=auth.uid(),updated_at=now() where id=section_row.id;
  end loop;
  insert into public.home_section_audit_logs(actor_id,actor_role,action,new_data) values(auth.uid(),private.current_app_role(),'homepage.sections.reordered',jsonb_build_object('sectionIds',p_section_ids));
end $$;

create or replace function public.publish_homepage(p_reason text,p_scheduled_at timestamptz default null)
returns uuid language plpgsql security definer set search_path=''
as $$
declare page_row public.home_pages; next_version integer; page_version_id uuid; manifest jsonb;
begin
  perform private.require_permission('homepage.publish');
  if char_length(trim(coalesce(p_reason,'')))<3 then raise exception 'publication reason is required'; end if;
  select * into page_row from public.home_pages where slug='principal' for update;
  select jsonb_build_object('sections',jsonb_agg(jsonb_build_object('sectionId',candidate.section_id,'versionId',candidate.id,'position',candidate.position) order by candidate.position)) into manifest
  from (
    select distinct on (version.section_id) version.id,version.section_id,section.sort_order as position
    from public.homepage_section_versions version
    join public.homepage_sections section on section.id=version.section_id
    where section.home_page_id=page_row.id and section.status not in ('hidden','expired','archived') and version.status in ('approved','published','scheduled')
    order by version.section_id,case version.status when 'approved' then 0 when 'published' then 1 else 2 end,version.version desc
  ) candidate;
  if manifest is null or jsonb_array_length(manifest->'sections')=0 then raise exception 'no approved homepage sections'; end if;
  if exists(
    select 1 from public.homepage_section_versions version,jsonb_array_elements(coalesce(version.snapshot->'items','[]'::jsonb)) item
    where version.id in (select (entry->>'versionId')::uuid from jsonb_array_elements(manifest->'sections') entry)
      and item->>'targetType'='product'
      and not exists(select 1 from public.products product where product.id=(item->>'targetId')::uuid and product.status='active')
  ) then raise exception 'homepage product target is unavailable'; end if;
  if exists(
    select 1 from public.homepage_section_versions version,jsonb_array_elements(coalesce(version.snapshot->'items','[]'::jsonb)) item,jsonb_array_elements(coalesce(item->'media','[]'::jsonb)) media
    where version.id in (select (entry->>'versionId')::uuid from jsonb_array_elements(manifest->'sections') entry)
      and not exists(select 1 from storage.objects stored where stored.bucket_id='homepage-public' and stored.name=media->>'path')
  ) then raise exception 'homepage media is unavailable'; end if;
  select coalesce(max(version),0)+1 into next_version from public.home_page_versions where home_page_id=page_row.id;
  insert into public.home_page_versions(home_page_id,version,status,manifest,reason,scheduled_at,published_at,created_by)
  values(page_row.id,next_version,case when p_scheduled_at is not null and p_scheduled_at>now() then 'scheduled' else 'published' end,manifest,trim(p_reason),case when p_scheduled_at>now() then p_scheduled_at end,case when p_scheduled_at is null or p_scheduled_at<=now() then now() end,auth.uid()) returning id into page_version_id;
  if p_scheduled_at is null or p_scheduled_at<=now() then
    update public.home_page_versions set status='superseded' where home_page_id=page_row.id and status='scheduled' and scheduled_at<=now();
    update public.home_page_versions set status='superseded' where home_page_id=page_row.id and status='published' and id<>page_version_id;
    update public.home_pages set published_version_id=page_version_id,updated_at=now() where id=page_row.id;
  end if;
  update public.homepage_section_versions set status=case when p_scheduled_at>now() then 'scheduled' else 'published' end,published_at=case when p_scheduled_at is null or p_scheduled_at<=now() then now() else published_at end where id in (select (entry->>'versionId')::uuid from jsonb_array_elements(manifest->'sections') entry);
  update public.homepage_sections set status=case when p_scheduled_at>now() then 'scheduled' else 'published' end,active=true where current_version_id in (select (entry->>'versionId')::uuid from jsonb_array_elements(manifest->'sections') entry);
  insert into public.home_section_audit_logs(actor_id,actor_role,action,new_data,reason) values(auth.uid(),private.current_app_role(),'homepage.published',jsonb_build_object('pageVersionId',page_version_id,'version',next_version,'scheduledAt',p_scheduled_at),trim(p_reason));
  return page_version_id;
end $$;

create or replace view public.published_homepage_sections
with (security_invoker=false) as
with selected_page_version as (
  select coalesce((select scheduled.id from public.home_page_versions scheduled join public.home_pages p on p.id=scheduled.home_page_id where p.slug='principal' and scheduled.status='scheduled' and scheduled.scheduled_at<=now() order by scheduled.scheduled_at desc limit 1),(select published_version_id from public.home_pages where slug='principal')) id
), entries as (
  select entry from public.home_page_versions page_version,selected_page_version selected,jsonb_array_elements(page_version.manifest->'sections') entry where page_version.id=selected.id
)
select version.id as section_version_id,version.section_id,(entries.entry->>'position')::integer position,
  jsonb_set(version.snapshot-'internalName','{items}',coalesce((select jsonb_agg(item-'internalName' order by (item->>'sortOrder')::integer) from jsonb_array_elements(coalesce(version.snapshot->'items','[]'::jsonb)) item),'[]'::jsonb)) snapshot
from entries join public.homepage_section_versions version on version.id=(entries.entry->>'versionId')::uuid
where (version.snapshot->>'startsAt' is null or (version.snapshot->>'startsAt')::timestamptz<=now())
  and (version.snapshot->>'endsAt' is null or (version.snapshot->>'endsAt')::timestamptz>now())
order by (entries.entry->>'position')::integer;

create or replace function public.record_homepage_metric(p_section_version_id uuid,p_item_key text,p_metric text,p_device text)
returns void language plpgsql security definer set search_path=''
as $$
begin
  if p_metric not in ('view','click') or p_device not in ('desktop','tablet','mobile') or char_length(coalesce(p_item_key,''))>100 then raise exception 'invalid homepage metric'; end if;
  if not exists(select 1 from public.published_homepage_sections where section_version_id=p_section_version_id) then raise exception 'homepage version is not public'; end if;
  insert into public.home_section_metrics(section_version_id,item_key,metric_date,device,views,clicks)
  values(p_section_version_id,coalesce(p_item_key,''),current_date,p_device,case when p_metric='view' then 1 else 0 end,case when p_metric='click' then 1 else 0 end)
  on conflict(section_version_id,item_key,metric_date,device) do update set views=public.home_section_metrics.views+excluded.views,clicks=public.home_section_metrics.clicks+excluded.clicks;
end $$;

create or replace function public.cancel_homepage_publication(p_page_version_id uuid,p_reason text)
returns void language plpgsql security definer set search_path=''
as $$
begin
  perform private.require_permission('homepage.publish');
  if char_length(trim(coalesce(p_reason,'')))<3 then raise exception 'cancellation reason is required'; end if;
  update public.home_page_versions set status='cancelled'
  where id=p_page_version_id and status='scheduled' and scheduled_at>now();
  if not found then raise exception 'scheduled homepage publication not found'; end if;
  insert into public.home_section_audit_logs(actor_id,actor_role,action,new_data,reason)
  values(auth.uid(),private.current_app_role(),'homepage.publication.cancelled',jsonb_build_object('pageVersionId',p_page_version_id),trim(p_reason));
end $$;

-- Migra o estado publicado atual para snapshots imutáveis, sem inventar conteúdo.
do $$
declare section_row public.homepage_sections; version_id uuid; next_version integer; page_id uuid; manifest jsonb; page_version_id uuid;
begin
  for section_row in select * from public.homepage_sections order by sort_order loop
    select coalesce(max(version),0)+1 into next_version from public.homepage_section_versions where section_id=section_row.id;
    insert into public.homepage_section_versions(section_id,version,snapshot,changed_by,status,snapshot_hash)
    values(section_row.id,next_version,private.homepage_section_snapshot(section_row.id),section_row.updated_by,case when section_row.status='published' then 'published' else 'draft' end,pg_catalog.encode(extensions.digest(pg_catalog.convert_to(private.homepage_section_snapshot(section_row.id)::text,'UTF8'),'sha256'),'hex')) returning id into version_id;
    update public.homepage_sections set current_version_id=version_id where id=section_row.id;
  end loop;
  select id into page_id from public.home_pages where slug='principal';
  select jsonb_build_object('sections',coalesce(jsonb_agg(jsonb_build_object('sectionId',section.id,'versionId',section.current_version_id,'position',section.sort_order) order by section.sort_order),'[]'::jsonb)) into manifest from public.homepage_sections section where section.home_page_id=page_id and section.status='published';
  if manifest is not null and jsonb_array_length(manifest->'sections')>0 then
    insert into public.home_page_versions(home_page_id,version,status,manifest,reason,published_at,created_by)
    select page_id,1,'published',manifest,'Migração do estado publicado existente',now(),coalesce((select updated_by from public.homepage_sections where home_page_id=page_id and updated_by is not null limit 1),(select id from public.profiles order by created_at limit 1)) returning id into page_version_id;
    update public.home_pages set published_version_id=page_version_id where id=page_id;
  end if;
end $$;

alter table public.homepage_sections add constraint homepage_sections_current_version_fkey foreign key(current_version_id) references public.homepage_section_versions(id);

do $$ declare table_name text; begin
  foreach table_name in array array['home_pages','home_section_items','home_section_item_media','home_section_schedules','home_section_approvals','home_page_versions','home_section_metrics','home_section_audit_logs'] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('alter table public.%I force row level security',table_name);
  end loop;
end $$;

create policy "homepage authorized read pages" on public.home_pages for select to authenticated using(private.has_permission('homepage.view') or private.has_permission('homepage.technical.observe'));
create policy "homepage authorized read sections" on public.homepage_sections for select to authenticated using(private.has_permission('homepage.view'));
create policy "homepage authorized read versions" on public.homepage_section_versions for select to authenticated using(private.has_permission('homepage.view'));
create policy "homepage authorized read items" on public.home_section_items for select to authenticated using(private.has_permission('homepage.view'));
create policy "homepage authorized read media" on public.home_section_item_media for select to authenticated using(private.has_permission('homepage.view'));
create policy "homepage authorized read schedules" on public.home_section_schedules for select to authenticated using(private.has_permission('homepage.view'));
create policy "homepage reviewers read approvals" on public.home_section_approvals for select to authenticated using(private.has_permission('homepage.review'));
create policy "homepage authorized read page versions" on public.home_page_versions for select to authenticated using(private.has_permission('homepage.view'));
create policy "homepage metrics readers" on public.home_section_metrics for select to authenticated using(private.has_permission('homepage.metrics.read') or private.has_permission('homepage.technical.observe'));
create policy "homepage audit readers" on public.home_section_audit_logs for select to authenticated using(private.has_permission('homepage.audit.read') or private.has_permission('homepage.technical.observe'));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('homepage-public','homepage-public',true,52428800,array['image/jpeg','image/png','image/webp','video/mp4','video/webm']) on conflict(id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy "public reads homepage media" on storage.objects for select to anon,authenticated using(bucket_id='homepage-public');
create policy "homepage media managers upload" on storage.objects for insert to authenticated with check(bucket_id='homepage-public' and (storage.foldername(name))[1] in ('home-sections','home-section-images','home-section-mobile-images','home-section-videos','home-section-thumbnails') and lower(storage.extension(name)) in ('jpg','jpeg','png','webp','mp4','webm') and private.has_permission('homepage.media.manage'));
create policy "homepage media managers update own" on storage.objects for update to authenticated using(bucket_id='homepage-public' and owner_id=auth.uid() and private.has_permission('homepage.media.manage')) with check(bucket_id='homepage-public' and owner_id=auth.uid() and private.has_permission('homepage.media.manage'));
create policy "homepage media managers remove own orphan" on storage.objects for delete to authenticated using(bucket_id='homepage-public' and owner_id=auth.uid() and private.has_permission('homepage.media.manage') and not exists(select 1 from public.home_section_item_media media where media.storage_path=name));

revoke all on public.home_pages,public.homepage_sections,public.homepage_section_versions,public.home_section_items,public.home_section_item_media,public.home_section_schedules,public.home_section_approvals,public.home_page_versions,public.home_section_metrics,public.home_section_audit_logs from anon;
revoke insert,update,delete,truncate on public.home_pages,public.homepage_sections,public.homepage_section_versions,public.home_section_items,public.home_section_item_media,public.home_section_schedules,public.home_section_approvals,public.home_page_versions,public.home_section_metrics,public.home_section_audit_logs from authenticated;
revoke all on function private.validate_homepage_json(jsonb),private.homepage_section_snapshot(uuid),private.protect_homepage_version() from public,anon,authenticated;
revoke all on function public.has_homepage_permission(text) from public,anon;
grant execute on function public.has_homepage_permission(text) to authenticated;
revoke all on function public.save_homepage_section(jsonb,integer),public.transition_homepage_section(uuid,text,text),public.reorder_homepage_sections(uuid[],integer[]),public.publish_homepage(text,timestamptz) from public,anon;
grant execute on function public.save_homepage_section(jsonb,integer),public.transition_homepage_section(uuid,text,text),public.reorder_homepage_sections(uuid[],integer[]),public.publish_homepage(text,timestamptz) to authenticated;
revoke all on function public.record_homepage_metric(uuid,text,text,text) from public;
grant execute on function public.record_homepage_metric(uuid,text,text,text) to anon,authenticated;
revoke all on function public.cancel_homepage_publication(uuid,text),public.manager_restore_homepage_section(uuid,text) from public,anon,authenticated;
grant execute on function public.cancel_homepage_publication(uuid,text) to authenticated;
grant select on public.published_homepage_sections to anon,authenticated;

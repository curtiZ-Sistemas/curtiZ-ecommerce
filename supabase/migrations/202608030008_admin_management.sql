-- Administração Curtiz: catálogo ampliado, conteúdo versionado e políticas de gestão.

insert into public.permissions(code, description) values
  ('orders.read_all', 'Ler pedidos no painel administrativo'),
  ('products.create', 'Criar produtos'),
  ('products.update', 'Atualizar produtos'),
  ('inventory.read', 'Ler estoque'),
  ('promotions.advanced_manage', 'Gerenciar promoções e cupons'),
  ('banners.update', 'Gerenciar banners'),
  ('users.read', 'Ler usuários internos'),
  ('audit.read', 'Ler trilha de auditoria'),
  ('representatives.read_all', 'Ler representantes conforme escopo interno'),
  ('representatives.manage', 'Gerenciar representantes'),
  ('representatives.rules.manage', 'Gerenciar níveis, metas, kits e regras'),
  ('creatives.manage', 'Gerenciar criativos e campanhas'),
  ('content.manage', 'Gerenciar conteúdo institucional e página inicial'),
  ('reviews.manage', 'Moderar avaliações e responder em nome da Curtiz'),
  ('users.manage', 'Ativar, bloquear e administrar acessos internos'),
  ('users.roles.manage', 'Alterar papéis internos sem conceder administração'),
  ('catalog.taxonomy.manage', 'Gerenciar categorias, modelos e coleções'),
  ('training.manage', 'Gerenciar treinamentos da rede')
on conflict (code) do update set description = excluded.description;

insert into public.role_permissions(role, permission_id)
select 'admin', id
from public.permissions
where code in (
  'orders.read_all',
  'products.create',
  'products.update',
  'inventory.read',
  'promotions.advanced_manage',
  'banners.update',
  'users.read',
  'audit.read',
  'representatives.read_all',
  'representatives.manage',
  'representatives.rules.manage',
  'creatives.manage',
  'content.manage',
  'reviews.manage',
  'users.manage',
  'users.roles.manage',
  'catalog.taxonomy.manage',
  'training.manage'
)
on conflict do nothing;

create table public.product_models (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.products
  add column model_id uuid references public.product_models(id);

create table public.product_relations (
  product_id uuid not null references public.products(id) on delete cascade,
  related_product_id uuid not null references public.products(id) on delete cascade,
  sort_order integer not null default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key(product_id, related_product_id),
  check (product_id <> related_product_id)
);

create table public.product_media (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  variant_id uuid references public.product_variants(id) on delete cascade,
  media_type text not null check (media_type in ('image', 'video')),
  storage_path text not null unique,
  thumbnail_path text,
  alt_text text not null,
  mime_type text not null check (
    mime_type in ('image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm')
  ),
  size_bytes bigint not null check (size_bytes between 1 and 104857600),
  sort_order integer not null default 0,
  is_primary boolean not null default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.homepage_section_versions (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.homepage_sections(id) on delete cascade,
  version integer not null,
  snapshot jsonb not null,
  changed_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(section_id, version)
);

create table public.training_contents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null,
  content_type text not null check (content_type in ('video', 'document', 'link')),
  storage_path text not null,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  sort_order integer not null default 0,
  created_by uuid not null references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.product_models enable row level security;
alter table public.product_models force row level security;
alter table public.product_relations enable row level security;
alter table public.product_relations force row level security;
alter table public.product_media enable row level security;
alter table public.product_media force row level security;
alter table public.homepage_section_versions enable row level security;
alter table public.homepage_section_versions force row level security;
alter table public.training_contents enable row level security;
alter table public.training_contents force row level security;

create policy "public reads active product models" on public.product_models
  for select to anon, authenticated using (active);
create policy "catalog managers manage product models" on public.product_models
  for all to authenticated
  using (private.has_permission('catalog.taxonomy.manage'))
  with check (private.has_permission('catalog.taxonomy.manage'));

create policy "public reads active product relations" on public.product_relations
  for select to anon, authenticated using (
    exists (
      select 1 from public.products source
      join public.products related on related.id = related_product_id
      where source.id = product_id
        and source.status = 'active'
        and related.status = 'active'
    )
  );
create policy "catalog managers manage product relations" on public.product_relations
  for all to authenticated
  using (private.has_permission('products.update'))
  with check (private.has_permission('products.update'));

create policy "public reads published product media" on public.product_media
  for select to anon, authenticated using (
    exists (
      select 1 from public.products
      where products.id = product_id and products.status = 'active'
    )
  );
create policy "catalog managers manage product media" on public.product_media
  for all to authenticated
  using (private.has_permission('products.update'))
  with check (private.has_permission('products.update'));

create policy "content managers read homepage history" on public.homepage_section_versions
  for select to authenticated using (private.has_permission('content.manage'));

create policy "representatives read published training" on public.training_contents
  for select to authenticated using (
    status = 'published'
    or private.has_permission('training.manage')
  );
create policy "training managers maintain content" on public.training_contents
  for all to authenticated
  using (private.has_permission('training.manage'))
  with check (private.has_permission('training.manage'));

create policy "catalog taxonomy managers categories" on public.categories
  for all to authenticated
  using (private.has_permission('catalog.taxonomy.manage'))
  with check (private.has_permission('catalog.taxonomy.manage'));
create policy "catalog taxonomy managers collections" on public.collections
  for all to authenticated
  using (private.has_permission('catalog.taxonomy.manage'))
  with check (private.has_permission('catalog.taxonomy.manage'));
create policy "catalog managers product images" on public.product_images
  for all to authenticated
  using (private.has_permission('products.update'))
  with check (private.has_permission('products.update'));
create policy "promotion managers coupons" on public.coupons
  for all to authenticated
  using (private.has_permission('promotions.advanced_manage'))
  with check (private.has_permission('promotions.advanced_manage'));
create policy "content managers cms" on public.cms_pages
  for all to authenticated
  using (private.has_permission('content.manage'))
  with check (private.has_permission('content.manage'));
create policy "content managers marketing segments" on public.marketing_segments
  for all to authenticated
  using (private.has_permission('content.manage'))
  with check (private.has_permission('content.manage'));
create policy "review managers moderate" on public.reviews
  for update to authenticated
  using (private.has_permission('reviews.manage'))
  with check (private.has_permission('reviews.manage'));
create policy "review managers read all" on public.reviews
  for select to authenticated using (private.has_permission('reviews.manage'));
create policy "admin reads permissions" on public.permissions
  for select to authenticated using (private.has_permission('users.read'));
create policy "admin reads role permissions" on public.role_permissions
  for select to authenticated using (private.has_permission('users.read'));
create policy "admin reads permission overrides" on public.user_permission_overrides
  for select to authenticated using (private.has_permission('users.read'));
create policy "admin reads settings" on public.system_settings
  for select to authenticated using (private.has_permission('content.manage'));
create policy "admin reads user roles" on public.user_roles
  for select to authenticated using (private.has_permission('users.read'));

create or replace function public.admin_update_user_access(
  p_user_id uuid,
  p_status public.user_status,
  p_role public.app_role,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_profile jsonb;
  previous_roles jsonb;
begin
  perform private.require_permission('users.manage');
  perform private.require_permission('users.roles.manage');

  if p_user_id = auth.uid() then
    raise exception 'self access changes are not allowed' using errcode = '42501';
  end if;
  if p_role = 'admin' then
    raise exception 'admin role requires the invitation and approval flow' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.user_roles
    where user_id = p_user_id and role = 'admin'
  ) then
    raise exception 'admin accounts require a separate approval flow' using errcode = '42501';
  end if;
  if char_length(trim(p_reason)) < 10 then
    raise exception 'a reason with at least ten characters is required';
  end if;

  select to_jsonb(p) - 'email_snapshot' - 'phone' - 'avatar_path'
  into previous_profile
  from public.profiles p
  where p.id = p_user_id
  for update;
  if previous_profile is null then
    raise exception 'user not found';
  end if;

  select coalesce(jsonb_agg(role), '[]'::jsonb)
  into previous_roles
  from public.user_roles
  where user_id = p_user_id;

  update public.profiles
  set status = p_status, updated_at = now()
  where id = p_user_id;

  delete from public.user_roles
  where user_id = p_user_id
    and role in ('operational', 'manager', 'technical');

  if p_role in ('operational', 'manager', 'technical') then
    insert into public.user_roles(user_id, role, created_by)
    values (p_user_id, p_role, auth.uid())
    on conflict do nothing;
  end if;

  insert into public.audit_logs(
    actor_id,
    actor_role,
    action,
    entity_type,
    entity_id,
    previous_data_sanitized,
    new_data_sanitized,
    reason
  ) values (
    auth.uid(),
    private.current_app_role(),
    'update_access',
    'profiles',
    p_user_id,
    jsonb_build_object('profile', previous_profile, 'roles', previous_roles),
    jsonb_build_object('status', p_status, 'role', p_role),
    trim(p_reason)
  );
end;
$$;

revoke all on function public.admin_update_user_access(uuid, public.user_status, public.app_role, text)
  from public, anon;
grant execute on function public.admin_update_user_access(uuid, public.user_status, public.app_role, text)
  to authenticated;

create or replace function public.admin_set_permission_override(
  p_user_id uuid,
  p_permission_code text,
  p_allowed boolean,
  p_expires_at timestamptz,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  permission_record public.permissions%rowtype;
begin
  perform private.require_permission('users.manage');
  perform private.require_permission('users.roles.manage');

  if p_user_id = auth.uid() then
    raise exception 'self permission changes are not allowed' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.user_roles
    where user_id = p_user_id and role = 'admin'
  ) then
    raise exception 'admin permissions require a separate approval flow' using errcode = '42501';
  end if;
  if p_permission_code like 'users.%' or p_permission_code = 'audit.read' then
    raise exception 'privilege escalation is not allowed' using errcode = '42501';
  end if;
  if char_length(trim(p_reason)) < 10 then
    raise exception 'a reason with at least ten characters is required';
  end if;
  if p_expires_at is null or p_expires_at <= now() or p_expires_at > now() + interval '90 days' then
    raise exception 'override expiration must be within ninety days';
  end if;

  select *
  into permission_record
  from public.permissions
  where code = p_permission_code;
  if permission_record.id is null then
    raise exception 'permission not found';
  end if;

  insert into public.user_permission_overrides(
    user_id,
    permission_id,
    allowed,
    reason,
    expires_at,
    created_by
  ) values (
    p_user_id,
    permission_record.id,
    p_allowed,
    trim(p_reason),
    p_expires_at,
    auth.uid()
  )
  on conflict(user_id, permission_id) do update
  set allowed = excluded.allowed,
      reason = excluded.reason,
      expires_at = excluded.expires_at,
      created_by = excluded.created_by,
      created_at = now();

  insert into public.audit_logs(
    actor_id,
    actor_role,
    action,
    entity_type,
    entity_id,
    new_data_sanitized,
    reason
  ) values (
    auth.uid(),
    private.current_app_role(),
    'permission_override',
    'profiles',
    p_user_id,
    jsonb_build_object(
      'permission', p_permission_code,
      'allowed', p_allowed,
      'expires_at', p_expires_at
    ),
    trim(p_reason)
  );
end;
$$;

revoke all on function public.admin_set_permission_override(uuid, text, boolean, timestamptz, text)
  from public, anon;
grant execute on function public.admin_set_permission_override(uuid, text, boolean, timestamptz, text)
  to authenticated;

create or replace function public.duplicate_product(
  p_product_id uuid,
  p_name text,
  p_slug text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  source public.products%rowtype;
  new_product_id uuid;
  source_variant record;
  new_variant_id uuid;
  sku_suffix text := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
begin
  perform private.require_permission('products.create');
  perform private.require_permission('products.update');
  if char_length(trim(p_name)) < 3 or p_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise exception 'invalid product identity';
  end if;

  select *
  into source
  from public.products
  where id = p_product_id
  for share;
  if source.id is null then
    raise exception 'product not found';
  end if;

  insert into public.products(
    name,
    slug,
    short_description,
    description,
    category_id,
    model_id,
    collection_id,
    status,
    featured,
    base_price,
    cost_price,
    weight_grams,
    height_cm,
    width_cm,
    length_cm,
    seo_title,
    seo_description,
    created_by,
    updated_by
  ) values (
    trim(p_name),
    p_slug,
    source.short_description,
    source.description,
    source.category_id,
    source.model_id,
    source.collection_id,
    'draft',
    false,
    source.base_price,
    source.cost_price,
    source.weight_grams,
    source.height_cm,
    source.width_cm,
    source.length_cm,
    source.seo_title,
    source.seo_description,
    auth.uid(),
    auth.uid()
  )
  returning id into new_product_id;

  for source_variant in
    select variant.*, inventory.available_quantity, inventory.minimum_quantity, inventory.ideal_quantity
    from public.product_variants variant
    left join public.inventory on inventory.variant_id = variant.id
    where variant.product_id = source.id
  loop
    insert into public.product_variants(
      product_id,
      sku,
      color_name,
      color_hex,
      size,
      price_override,
      cost_override,
      active,
      barcode
    ) values (
      new_product_id,
      left(source_variant.sku::text, 105) || '-COPY-' || sku_suffix,
      source_variant.color_name,
      source_variant.color_hex,
      source_variant.size,
      source_variant.price_override,
      source_variant.cost_override,
      source_variant.active,
      null
    )
    returning id into new_variant_id;

    insert into public.inventory(
      variant_id,
      available_quantity,
      reserved_quantity,
      damaged_quantity,
      minimum_quantity,
      ideal_quantity
    ) values (
      new_variant_id,
      0,
      0,
      0,
      coalesce(source_variant.minimum_quantity, 5),
      coalesce(source_variant.ideal_quantity, 20)
    );
  end loop;

  insert into public.product_relations(product_id, related_product_id, sort_order, created_by)
  select new_product_id, related_product_id, sort_order, auth.uid()
  from public.product_relations
  where product_id = source.id
  on conflict do nothing;

  return new_product_id;
end;
$$;

revoke all on function public.duplicate_product(uuid, text, text) from public, anon;
grant execute on function public.duplicate_product(uuid, text, text) to authenticated;

create or replace function private.version_homepage_section()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_version integer;
begin
  select coalesce(max(version), 0) + 1
  into next_version
  from public.homepage_section_versions
  where section_id = old.id;

  insert into public.homepage_section_versions(section_id, version, snapshot, changed_by)
  values (old.id, next_version, to_jsonb(old), auth.uid());
  return new;
end;
$$;

create trigger version_homepage_section
before update or delete on public.homepage_sections
for each row execute function private.version_homepage_section();

create or replace function private.enforce_homepage_banner_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  active_count integer;
begin
  if new.position = 'hero' and new.status = 'published' then
    select count(*)
    into active_count
    from public.banners
    where position = 'hero'
      and status = 'published'
      and id <> new.id
      and (starts_at is null or starts_at <= now())
      and (ends_at is null or ends_at > now());
    if active_count >= 4 then
      raise exception 'homepage hero accepts at most four published banners';
    end if;
  end if;
  return new;
end;
$$;

create trigger enforce_homepage_banner_limit
before insert or update on public.banners
for each row execute function private.enforce_homepage_banner_limit();

create or replace function private.audit_admin_resource()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  entity uuid;
begin
  if tg_op = 'DELETE' then
    entity := (to_jsonb(old) ->> 'id')::uuid;
  else
    entity := (to_jsonb(new) ->> 'id')::uuid;
  end if;
  insert into public.audit_logs(
    actor_id,
    actor_role,
    action,
    entity_type,
    entity_id,
    previous_data_sanitized,
    new_data_sanitized
  ) values (
    auth.uid(),
    private.current_app_role(),
    lower(tg_op),
    tg_table_name,
    entity,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
  );
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

do $$
declare
  managed_table text;
begin
  foreach managed_table in array array[
    'categories',
    'collections',
    'product_models',
    'products',
    'product_variants',
    'product_images',
    'product_media',
    'banners',
    'homepage_sections',
    'cms_pages',
    'coupons',
    'promotion_campaigns',
    'training_contents',
    'creative_assets',
    'creative_campaigns'
  ]
  loop
    execute format(
      'create trigger audit_admin_%I after insert or update or delete on public.%I for each row execute function private.audit_admin_resource()',
      managed_table,
      managed_table
    );
  end loop;
end;
$$;

create or replace function private.audit_review_moderation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status is distinct from new.status
    or old.brand_response is distinct from new.brand_response then
    insert into public.audit_logs(
      actor_id,
      actor_role,
      action,
      entity_type,
      entity_id,
      previous_data_sanitized,
      new_data_sanitized
    ) values (
      auth.uid(),
      private.current_app_role(),
      'moderate',
      'reviews',
      new.id,
      jsonb_build_object('status', old.status, 'brand_response', old.brand_response),
      jsonb_build_object('status', new.status, 'brand_response', new.brand_response)
    );
  end if;
  return new;
end;
$$;

create trigger audit_review_moderation
after update on public.reviews
for each row execute function private.audit_review_moderation();

create trigger touch_product_models
before update on public.product_models
for each row execute function private.touch_updated_at();
create trigger touch_training_contents
before update on public.training_contents
for each row execute function private.touch_updated_at();

revoke all on function private.version_homepage_section() from public, anon, authenticated;
revoke all on function private.enforce_homepage_banner_limit() from public, anon, authenticated;
revoke all on function private.audit_admin_resource() from public, anon, authenticated;
revoke all on function private.audit_review_moderation() from public, anon, authenticated;

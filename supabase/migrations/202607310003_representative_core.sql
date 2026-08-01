create table public.representative_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  public_code text not null unique default ('SOL-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  status public.representative_application_status not null default 'draft',
  current_step smallint not null default 1 check (current_step between 1 and 6),
  answers jsonb not null default '{}'::jsonb,
  personal_data jsonb not null default '{}'::jsonb,
  cpf_ciphertext text,
  cpf_last_four char(4),
  commercial_data jsonb not null default '{}'::jsonb,
  referral_code text,
  terms_version text,
  terms_accepted_at timestamptz,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  decision_reason text,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.representative_application_documents (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.representative_applications(id) on delete cascade,
  document_type text not null,
  storage_path text not null unique,
  original_name text not null,
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp','application/pdf')),
  size_bytes integer not null check (size_bytes between 1 and 10485760),
  checksum_sha256 char(64) not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','replaced')),
  rejection_reason text,
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  unique(application_id, document_type, checksum_sha256)
);

create table public.representative_application_reviews (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.representative_applications(id) on delete cascade,
  reviewer_id uuid not null references public.profiles(id),
  decision text not null check (decision in ('start_review','request_documents','approve','reject','suspend','cancel')),
  reason text not null check (char_length(reason) between 3 and 2000),
  metadata_sanitized jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.representative_levels (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  rank smallint not null unique check (rank > 0),
  description text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.representative_level_rules (
  id uuid primary key default gen_random_uuid(),
  level_id uuid not null references public.representative_levels(id),
  version integer not null check (version > 0),
  effective_from timestamptz not null,
  effective_until timestamptz,
  criteria jsonb not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(level_id, version),
  check (effective_until is null or effective_until > effective_from)
);

create table public.representatives (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete restrict,
  application_id uuid not null unique references public.representative_applications(id),
  public_code text not null unique default ('REP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  referral_code text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
  status public.representative_status not null default 'approved_waiting_kit',
  current_level_id uuid references public.representative_levels(id),
  region_code text,
  approved_at timestamptz not null default now(),
  activated_at timestamptz,
  suspended_at timestamptz,
  cancelled_at timestamptz,
  status_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.representative_status_history (
  id uuid primary key default gen_random_uuid(),
  representative_id uuid not null references public.representatives(id),
  previous_status public.representative_status,
  new_status public.representative_status not null,
  reason text not null,
  changed_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.representative_level_history (
  id uuid primary key default gen_random_uuid(),
  representative_id uuid not null references public.representatives(id),
  previous_level_id uuid references public.representative_levels(id),
  new_level_id uuid not null references public.representative_levels(id),
  rule_snapshot jsonb not null,
  reason text not null,
  changed_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.referral_relationships (
  representative_id uuid primary key references public.representatives(id) on delete restrict,
  sponsor_id uuid not null references public.representatives(id) on delete restrict,
  source text not null default 'application',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (representative_id <> sponsor_id)
);

create table public.representative_network_closure (
  ancestor_id uuid not null references public.representatives(id) on delete cascade,
  descendant_id uuid not null references public.representatives(id) on delete cascade,
  depth integer not null check (depth >= 0),
  created_at timestamptz not null default now(),
  primary key (ancestor_id, descendant_id),
  check ((depth = 0) = (ancestor_id = descendant_id))
);

create table public.qualification_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  version integer not null check (version > 0),
  period_type text not null default 'monthly' check (period_type in ('monthly','quarterly','custom')),
  criteria jsonb not null,
  effective_from date not null,
  effective_until date,
  active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(name, version),
  check (effective_until is null or effective_until >= effective_from)
);

create table public.representative_qualifications (
  id uuid primary key default gen_random_uuid(),
  representative_id uuid not null references public.representatives(id),
  rule_id uuid not null references public.qualification_rules(id),
  period_start date not null,
  period_end date not null,
  qualified boolean not null,
  metrics_snapshot jsonb not null,
  evaluated_at timestamptz not null default now(),
  unique(representative_id, rule_id, period_start, period_end),
  check (period_end >= period_start)
);

create table public.representative_goals (
  id uuid primary key default gen_random_uuid(),
  representative_id uuid references public.representatives(id),
  level_id uuid references public.representative_levels(id),
  title text not null,
  period_start date not null,
  period_end date not null,
  target jsonb not null,
  active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (representative_id is not null or level_id is not null),
  check (period_end >= period_start)
);

create table public.kits (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text not null,
  price_in_cents bigint not null check (price_in_cents >= 0),
  active boolean not null default true,
  required_for_activation boolean not null default false,
  version integer not null default 1 check (version > 0),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.kit_items (
  kit_id uuid not null references public.kits(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id),
  quantity integer not null check (quantity > 0),
  primary key (kit_id, variant_id)
);

create table public.kit_level_rules (
  kit_id uuid not null references public.kits(id) on delete cascade,
  level_id uuid not null references public.representative_levels(id) on delete cascade,
  available boolean not null default true,
  required boolean not null default false,
  primary key (kit_id, level_id)
);

create table public.kit_orders (
  id uuid primary key default gen_random_uuid(),
  public_code text not null unique default ('KIT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  representative_id uuid not null references public.representatives(id),
  kit_id uuid not null references public.kits(id),
  status public.kit_order_status not null default 'pending_payment',
  total_in_cents bigint not null check (total_in_cents >= 0),
  kit_snapshot jsonb not null,
  payment_reference text,
  shipping_snapshot jsonb not null default '{}'::jsonb,
  paid_at timestamptz,
  shipped_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.kit_order_items (
  id uuid primary key default gen_random_uuid(),
  kit_order_id uuid not null references public.kit_orders(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id),
  quantity integer not null check (quantity > 0),
  unit_price_in_cents bigint not null check (unit_price_in_cents >= 0),
  item_snapshot jsonb not null
);

create table public.representative_inventory (
  representative_id uuid not null references public.representatives(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id),
  quantity integer not null default 0 check (quantity >= 0),
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  primary key (representative_id, variant_id)
);

create table public.representative_inventory_movements (
  id uuid primary key default gen_random_uuid(),
  representative_id uuid not null references public.representatives(id),
  variant_id uuid not null references public.product_variants(id),
  quantity_delta integer not null check (quantity_delta <> 0),
  reason text not null,
  source_type text not null,
  source_id uuid,
  idempotency_key text not null unique,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.representative_sales (
  id uuid primary key default gen_random_uuid(),
  public_code text not null unique default ('VD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  representative_id uuid not null references public.representatives(id),
  order_id uuid references public.orders(id),
  status public.representative_sale_status not null default 'draft',
  channel text not null check (channel in ('manual','referral_link','ecommerce')),
  customer_snapshot jsonb not null default '{}'::jsonb,
  subtotal_in_cents bigint not null check (subtotal_in_cents >= 0),
  discount_in_cents bigint not null default 0 check (discount_in_cents >= 0),
  total_in_cents bigint not null check (total_in_cents >= 0),
  idempotency_key text not null unique,
  sold_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.representative_sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.representative_sales(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id),
  quantity integer not null check (quantity > 0),
  unit_price_in_cents bigint not null check (unit_price_in_cents >= 0),
  discount_in_cents bigint not null default 0 check (discount_in_cents >= 0),
  item_snapshot jsonb not null
);

create table public.commission_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  version integer not null check (version > 0),
  basis_points integer not null check (basis_points between 0 and 10000),
  maximum_in_cents bigint check (maximum_in_cents >= 0),
  scope jsonb not null default '{}'::jsonb,
  conditions jsonb not null default '{}'::jsonb,
  effective_from timestamptz not null,
  effective_until timestamptz,
  active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(name, version),
  check (effective_until is null or effective_until > effective_from)
);

create table public.commission_entries (
  id uuid primary key default gen_random_uuid(),
  representative_id uuid not null references public.representatives(id),
  sale_id uuid not null references public.representative_sales(id),
  rule_id uuid not null references public.commission_rules(id),
  source_event text not null,
  source_event_id text not null,
  status public.commission_status not null default 'pending',
  eligible_amount_in_cents bigint not null check (eligible_amount_in_cents >= 0),
  commission_in_cents bigint not null check (commission_in_cents >= 0),
  rule_snapshot jsonb not null,
  reversal_of uuid references public.commission_entries(id),
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  paid_at timestamptz,
  unique(source_event, source_event_id, representative_id, rule_id)
);

create table public.commission_adjustments (
  id uuid primary key default gen_random_uuid(),
  commission_entry_id uuid not null references public.commission_entries(id),
  amount_in_cents bigint not null check (amount_in_cents <> 0),
  reason text not null check (char_length(reason) between 3 and 1000),
  approved_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.commission_closings (
  id uuid primary key default gen_random_uuid(),
  public_code text not null unique default ('FEC-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  period_start date not null,
  period_end date not null,
  status public.commission_closing_status not null default 'simulating',
  totals_snapshot jsonb not null default '{}'::jsonb,
  simulated_by uuid not null references public.profiles(id),
  approved_by uuid references public.profiles(id),
  locked_at timestamptz,
  reopen_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end >= period_start)
);

create table public.commission_closing_entries (
  closing_id uuid not null references public.commission_closings(id) on delete restrict,
  commission_entry_id uuid not null unique references public.commission_entries(id) on delete restrict,
  amount_in_cents bigint not null,
  primary key (closing_id, commission_entry_id)
);

create table public.commission_payments (
  id uuid primary key default gen_random_uuid(),
  closing_id uuid not null references public.commission_closings(id),
  representative_id uuid not null references public.representatives(id),
  amount_in_cents bigint not null check (amount_in_cents >= 0),
  provider_reference text,
  status text not null check (status in ('pending','processing','paid','failed','cancelled')),
  idempotency_key text not null unique,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.representative_documents (
  id uuid primary key default gen_random_uuid(),
  representative_id uuid not null references public.representatives(id),
  document_type text not null,
  storage_path text not null unique,
  valid_until date,
  created_at timestamptz not null default now()
);

create table public.representative_contracts (
  id uuid primary key default gen_random_uuid(),
  representative_id uuid not null references public.representatives(id),
  version text not null,
  storage_path text not null,
  accepted_at timestamptz not null,
  acceptance_snapshot jsonb not null,
  unique(representative_id, version)
);

create table public.representative_trainings (
  id uuid primary key default gen_random_uuid(),
  representative_id uuid not null references public.representatives(id),
  training_code text not null,
  status text not null check (status in ('available','started','completed','expired')),
  progress smallint not null default 0 check (progress between 0 and 100),
  completed_at timestamptz,
  unique(representative_id, training_code)
);

create table public.representative_notifications (
  id uuid primary key default gen_random_uuid(),
  representative_id uuid not null references public.representatives(id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  action_path text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index representative_applications_status_idx on public.representative_applications(status, submitted_at);
create index representative_status_idx on public.representatives(status, current_level_id);
create index referral_sponsor_idx on public.referral_relationships(sponsor_id);
create index representative_sales_period_idx on public.representative_sales(representative_id, sold_at desc);
create index commission_entries_owner_status_idx on public.commission_entries(representative_id, status, created_at desc);
create index kit_orders_status_idx on public.kit_orders(status, created_at);

create or replace function private.current_app_role()
returns public.app_role
language plpgsql stable security definer set search_path = ''
as $$
declare claim_role text; db_role public.app_role;
begin
  claim_role := auth.jwt() -> 'app_metadata' ->> 'role';
  if claim_role in ('customer','representative','operational','admin','manager','technical') then
    return claim_role::public.app_role;
  end if;
  select ur.role into db_role from public.user_roles ur where ur.user_id = auth.uid()
  order by case ur.role when 'technical' then 1 when 'manager' then 2 when 'admin' then 3
    when 'operational' then 4 when 'representative' then 5 else 6 end limit 1;
  return coalesce(db_role, 'customer'::public.app_role);
end;
$$;

create or replace function private.user_has_role(requested_role public.app_role)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles ur
    join public.profiles p on p.id = ur.user_id
    where ur.user_id = auth.uid() and ur.role = requested_role and p.status = 'active'
  );
$$;

create or replace function private.has_permission(permission_code text)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare override_allowed boolean;
begin
  if not private.is_active_user() then return false; end if;
  select upo.allowed into override_allowed
  from public.user_permission_overrides upo
  join public.permissions p on p.id = upo.permission_id
  where upo.user_id = auth.uid() and p.code = permission_code
    and (upo.expires_at is null or upo.expires_at > now()) limit 1;
  if override_allowed is not null then return override_allowed; end if;
  return exists (
    select 1 from public.user_roles ur
    join public.role_permissions rp on rp.role = ur.role
    join public.permissions p on p.id = rp.permission_id
    where ur.user_id = auth.uid() and p.code = permission_code
  );
end;
$$;

create or replace function private.owns_representative(requested_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.representatives r
    where r.id = requested_id and r.user_id = auth.uid()
  );
$$;

create or replace function private.prevent_referral_cycle()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.representative_id = new.sponsor_id then raise exception 'self referral is forbidden'; end if;
  if exists (
    with recursive ancestors(id) as (
      select new.sponsor_id
      union all
      select rr.sponsor_id from public.referral_relationships rr join ancestors a on rr.representative_id = a.id
    ) select 1 from ancestors where id = new.representative_id
  ) then raise exception 'referral cycle is forbidden'; end if;
  return new;
end;
$$;

create trigger prevent_referral_cycle before insert or update on public.referral_relationships
for each row execute function private.prevent_referral_cycle();

create or replace function private.rebuild_representative_network_closure()
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_permission('representatives.network.manage');
  delete from public.representative_network_closure;
  insert into public.representative_network_closure(ancestor_id, descendant_id, depth)
  select id, id, 0 from public.representatives;
  insert into public.representative_network_closure(ancestor_id, descendant_id, depth)
  with recursive tree(ancestor_id, descendant_id, depth) as (
    select sponsor_id, representative_id, 1 from public.referral_relationships
    union all
    select tree.ancestor_id, rr.representative_id, tree.depth + 1
    from tree join public.referral_relationships rr on rr.sponsor_id = tree.descendant_id
    where tree.depth < 100
  ) select ancestor_id, descendant_id, min(depth) from tree group by ancestor_id, descendant_id;
end;
$$;

create or replace function private.activate_representative_after_kit()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.status = 'delivered' and old.status is distinct from new.status and exists (
    select 1 from public.kits k where k.id = new.kit_id and k.required_for_activation
  ) then
    update public.representatives set status = 'active', activated_at = coalesce(activated_at, now()), updated_at = now()
    where id = new.representative_id and status = 'approved_waiting_kit';
  end if;
  return new;
end;
$$;

create trigger activate_representative_after_kit after update on public.kit_orders
for each row execute function private.activate_representative_after_kit();

create or replace function private.protect_locked_closing()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if old.status in ('locked','paid') and new.status not in ('reopened','paid') then
    raise exception 'locked commission closing is immutable';
  end if;
  if old.status in ('locked','paid') and new.status = 'reopened' and nullif(trim(new.reopen_reason), '') is null then
    raise exception 'reopen reason is required';
  end if;
  return new;
end;
$$;

create trigger protect_locked_closing before update on public.commission_closings
for each row execute function private.protect_locked_closing();

create or replace function public.submit_representative_application(p_application_id uuid)
returns public.representative_applications
language plpgsql security definer set search_path = ''
as $$
declare application public.representative_applications;
begin
  select * into application from public.representative_applications
  where id = p_application_id and user_id = auth.uid() for update;
  if application.id is null then raise exception 'application not found' using errcode = 'P0002'; end if;
  if application.status not in ('draft','documents_pending') then raise exception 'invalid application state'; end if;
  if application.terms_accepted_at is null or nullif(application.terms_version, '') is null then
    raise exception 'terms acceptance required';
  end if;
  update public.representative_applications set status = 'submitted', current_step = 6,
    submitted_at = now(), version = version + 1, updated_at = now()
  where id = p_application_id returning * into application;
  insert into public.notifications(user_id,type,title,body)
  values(application.user_id,'representative_application','Solicitação recebida','A solicitação foi enviada para análise.');
  return application;
end;
$$;

create or replace function public.review_representative_application(
  p_application_id uuid, p_decision text, p_reason text
)
returns public.representative_applications
language plpgsql security definer set search_path = ''
as $$
declare application public.representative_applications;
declare next_status public.representative_application_status;
declare new_representative_id uuid;
begin
  perform private.require_permission('representatives.application.review');
  if nullif(trim(p_reason), '') is null or char_length(trim(p_reason)) < 3 then
    raise exception 'decision reason required';
  end if;
  select * into application from public.representative_applications where id = p_application_id for update;
  if application.id is null then raise exception 'application not found' using errcode = 'P0002'; end if;
  next_status := case p_decision
    when 'start_review' then 'under_review'::public.representative_application_status
    when 'request_documents' then 'documents_pending'::public.representative_application_status
    when 'approve' then 'approved'::public.representative_application_status
    when 'reject' then 'rejected'::public.representative_application_status
    when 'suspend' then 'suspended'::public.representative_application_status
    else null end;
  if next_status is null then raise exception 'invalid decision'; end if;
  if application.status = 'submitted' and next_status not in ('under_review','documents_pending','rejected') then
    raise exception 'review must be started before approval';
  end if;
  if application.status = 'under_review' and next_status not in ('documents_pending','approved','rejected') then
    raise exception 'invalid application transition';
  end if;
  update public.representative_applications set status = next_status, decision_reason = trim(p_reason),
    reviewed_at = case when next_status in ('approved','rejected') then now() else reviewed_at end,
    version = version + 1, updated_at = now()
  where id = p_application_id returning * into application;
  insert into public.representative_application_reviews(application_id,reviewer_id,decision,reason)
  values(application.id,auth.uid(),p_decision,trim(p_reason));
  if next_status = 'approved' then
    insert into public.user_roles(user_id,role,created_by) values(application.user_id,'representative',auth.uid())
    on conflict do nothing;
    insert into public.representatives(user_id,application_id,status)
    values(application.user_id,application.id,'approved_waiting_kit')
    on conflict(user_id) do update set status = 'approved_waiting_kit', updated_at = now()
    returning id into new_representative_id;
  end if;
  insert into public.notifications(user_id,type,title,body)
  values(application.user_id,'representative_application','Solicitação atualizada',
    case next_status when 'approved' then 'Sua solicitação foi aprovada.'
      when 'documents_pending' then 'Existem documentos ou dados para corrigir.'
      when 'rejected' then 'A solicitação foi encerrada após análise.'
      else 'A solicitação avançou na análise.' end);
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized,reason)
  values(auth.uid(),private.current_app_role(),'representative.application.' || p_decision,
    'representative_application',application.id,jsonb_build_object('status',next_status),trim(p_reason));
  return application;
end;
$$;

insert into public.permissions(code, description) values
  ('representatives.application.create','Criar e atualizar solicitação própria'),
  ('representatives.application.review','Analisar solicitações de representantes'),
  ('representatives.read_own','Ler cadastro próprio de representante'),
  ('representatives.read_all','Ler representantes e rede conforme escopo interno'),
  ('representatives.manage','Alterar status e cadastro de representantes'),
  ('representatives.network.manage','Gerenciar vínculo e reconstruir rede'),
  ('representatives.rules.manage','Gerenciar níveis, metas, kits e qualificação'),
  ('representatives.kits.fulfill','Separar e expedir pedidos de kits'),
  ('representatives.sales.create_own','Registrar venda manual própria'),
  ('representatives.commissions.read_own','Consultar comissão própria'),
  ('representatives.commissions.read_all','Consultar comissões de representantes'),
  ('representatives.commissions.close','Simular, aprovar e fechar comissões'),
  ('creatives.read_published','Acessar criativos publicados permitidos'),
  ('creatives.manage','Criar e editar criativos'),
  ('creatives.approve','Revisar e aprovar criativos'),
  ('creatives.publish','Publicar e arquivar criativos'),
  ('creatives.metrics.read','Consultar métricas internas de criativos')
on conflict(code) do update set description = excluded.description;

insert into public.role_permissions(role, permission_id)
select 'representative', id from public.permissions where code in (
  'products.read','representatives.read_own','representatives.sales.create_own',
  'representatives.commissions.read_own','creatives.read_published',
  'support.quick_answers.read','support.conversations.read','support.conversations.reply'
)
on conflict do nothing;
insert into public.role_permissions(role, permission_id)
select 'operational', id from public.permissions where code in ('representatives.read_all','representatives.kits.fulfill')
on conflict do nothing;
insert into public.role_permissions(role, permission_id)
select 'admin', id from public.permissions where code in (
  'representatives.application.review','representatives.read_all','representatives.manage',
  'representatives.rules.manage','creatives.manage','creatives.approve','creatives.publish','creatives.metrics.read'
)
on conflict do nothing;
insert into public.role_permissions(role, permission_id)
select 'manager', id from public.permissions where code like 'representatives.%' or code like 'creatives.%'
on conflict do nothing;
insert into public.role_permissions(role, permission_id)
select 'technical', id from public.permissions where code = 'representatives.read_all'
on conflict do nothing;

do $$ declare table_name text; begin
  foreach table_name in array array[
    'representative_applications','representative_application_documents','representative_application_reviews',
    'representative_levels','representative_level_rules','representatives','representative_status_history',
    'representative_level_history','referral_relationships','representative_network_closure',
    'qualification_rules','representative_qualifications','representative_goals','kits','kit_items',
    'kit_level_rules','kit_orders','kit_order_items','representative_inventory',
    'representative_inventory_movements','representative_sales','representative_sale_items',
    'commission_rules','commission_entries','commission_adjustments','commission_closings',
    'commission_closing_entries','commission_payments','representative_documents',
    'representative_contracts','representative_trainings','representative_notifications'
  ] loop execute format('alter table public.%I enable row level security', table_name); end loop;
end $$;

create policy "applicant reads application" on public.representative_applications for select to authenticated
using (user_id = auth.uid() or private.has_permission('representatives.application.review'));
create policy "applicant creates draft" on public.representative_applications for insert to authenticated
with check (user_id = auth.uid() and status = 'draft');
create policy "applicant updates editable application" on public.representative_applications for update to authenticated
using (user_id = auth.uid() and status in ('draft','documents_pending'))
with check (user_id = auth.uid() and status in ('draft','documents_pending'));
create policy "reviewer updates application" on public.representative_applications for update to authenticated
using (private.has_permission('representatives.application.review'))
with check (private.has_permission('representatives.application.review'));
create policy "application documents scoped" on public.representative_application_documents for all to authenticated
using (exists(select 1 from public.representative_applications a where a.id = application_id and (a.user_id = auth.uid() or private.has_permission('representatives.application.review'))))
with check (uploaded_by = auth.uid() and exists(select 1 from public.representative_applications a where a.id = application_id and a.user_id = auth.uid()) or private.has_permission('representatives.application.review'));
create policy "application reviews internal read" on public.representative_application_reviews for select to authenticated
using (private.has_permission('representatives.application.review') or exists(select 1 from public.representative_applications a where a.id = application_id and a.user_id = auth.uid()));
create policy "application reviews internal write" on public.representative_application_reviews for insert to authenticated
with check (reviewer_id = auth.uid() and private.has_permission('representatives.application.review'));
create policy "representative reads own profile" on public.representatives for select to authenticated
using (user_id = auth.uid() or private.has_permission('representatives.read_all'));
create policy "representative managers update profiles" on public.representatives for update to authenticated
using (private.has_permission('representatives.manage')) with check (private.has_permission('representatives.manage'));
create policy "representative reads own statuses" on public.representative_status_history for select to authenticated
using (private.owns_representative(representative_id) or private.has_permission('representatives.read_all'));
create policy "representative reads own level history" on public.representative_level_history for select to authenticated
using (private.owns_representative(representative_id) or private.has_permission('representatives.read_all'));
create policy "published representative configuration" on public.representative_levels for select to authenticated using (active or private.has_permission('representatives.rules.manage'));
create policy "manager level configuration" on public.representative_levels for all to authenticated using (private.has_permission('representatives.rules.manage')) with check (private.has_permission('representatives.rules.manage'));
create policy "manager level rules" on public.representative_level_rules for all to authenticated using (private.has_permission('representatives.rules.manage')) with check (private.has_permission('representatives.rules.manage'));
create policy "network scoped read" on public.representative_network_closure for select to authenticated
using (private.owns_representative(ancestor_id) or private.owns_representative(descendant_id) or private.has_permission('representatives.read_all'));
create policy "network manager relationships" on public.referral_relationships for all to authenticated using (private.has_permission('representatives.network.manage')) with check (private.has_permission('representatives.network.manage'));
create policy "representative reads direct relationship" on public.referral_relationships for select to authenticated using (private.owns_representative(representative_id) or private.owns_representative(sponsor_id));
create policy "qualification owner read" on public.representative_qualifications for select to authenticated using (private.owns_representative(representative_id) or private.has_permission('representatives.read_all'));
create policy "qualification rules authenticated read" on public.qualification_rules for select to authenticated using (active or private.has_permission('representatives.rules.manage'));
create policy "qualification rules managers" on public.qualification_rules for all to authenticated using (private.has_permission('representatives.rules.manage')) with check (private.has_permission('representatives.rules.manage'));
create policy "goals scoped read" on public.representative_goals for select to authenticated using (representative_id is null or private.owns_representative(representative_id) or private.has_permission('representatives.read_all'));
create policy "goals manager write" on public.representative_goals for all to authenticated using (private.has_permission('representatives.rules.manage')) with check (private.has_permission('representatives.rules.manage'));
create policy "active kits read" on public.kits for select to authenticated using (active or private.has_permission('representatives.rules.manage'));
create policy "kit managers" on public.kits for all to authenticated using (private.has_permission('representatives.rules.manage')) with check (private.has_permission('representatives.rules.manage'));
create policy "kit configuration scoped" on public.kit_items for select to authenticated using (exists(select 1 from public.kits k where k.id = kit_id and k.active) or private.has_permission('representatives.rules.manage'));
create policy "kit configuration managers" on public.kit_items for all to authenticated using (private.has_permission('representatives.rules.manage')) with check (private.has_permission('representatives.rules.manage'));
create policy "kit level configuration read" on public.kit_level_rules for select to authenticated using (true);
create policy "kit level configuration managers" on public.kit_level_rules for all to authenticated using (private.has_permission('representatives.rules.manage')) with check (private.has_permission('representatives.rules.manage'));
create policy "kit orders scoped read" on public.kit_orders for select to authenticated using (private.owns_representative(representative_id) or private.has_permission('representatives.kits.fulfill') or private.has_permission('representatives.read_all'));
create policy "representative creates kit order" on public.kit_orders for insert to authenticated with check (private.owns_representative(representative_id));
create policy "kit fulfillment updates" on public.kit_orders for update to authenticated using (private.has_permission('representatives.kits.fulfill')) with check (private.has_permission('representatives.kits.fulfill'));
create policy "kit items follow order" on public.kit_order_items for select to authenticated using (exists(select 1 from public.kit_orders ko where ko.id = kit_order_id and (private.owns_representative(ko.representative_id) or private.has_permission('representatives.kits.fulfill') or private.has_permission('representatives.read_all'))));
create policy "inventory owner read" on public.representative_inventory for select to authenticated using (private.owns_representative(representative_id) or private.has_permission('representatives.read_all'));
create policy "inventory movements owner read" on public.representative_inventory_movements for select to authenticated using (private.owns_representative(representative_id) or private.has_permission('representatives.read_all'));
create policy "sales owner read" on public.representative_sales for select to authenticated using (private.owns_representative(representative_id) or private.has_permission('representatives.read_all'));
create policy "sales owner create" on public.representative_sales for insert to authenticated with check (private.owns_representative(representative_id) and private.has_permission('representatives.sales.create_own'));
create policy "sale items follow sale" on public.representative_sale_items for select to authenticated using (exists(select 1 from public.representative_sales s where s.id = sale_id and (private.owns_representative(s.representative_id) or private.has_permission('representatives.read_all'))));
create policy "commission owner read" on public.commission_entries for select to authenticated using (private.owns_representative(representative_id) or private.has_permission('representatives.commissions.read_all'));
create policy "commission rules manager" on public.commission_rules for all to authenticated using (private.has_permission('representatives.rules.manage')) with check (private.has_permission('representatives.rules.manage'));
create policy "commission adjustments manager" on public.commission_adjustments for all to authenticated using (private.has_permission('representatives.commissions.close')) with check (private.has_permission('representatives.commissions.close'));
create policy "commission closings finance" on public.commission_closings for all to authenticated using (private.has_permission('representatives.commissions.close')) with check (private.has_permission('representatives.commissions.close'));
create policy "closing entries finance" on public.commission_closing_entries for select to authenticated using (private.has_permission('representatives.commissions.read_all'));
create policy "commission payments scoped" on public.commission_payments for select to authenticated using (private.owns_representative(representative_id) or private.has_permission('representatives.commissions.read_all'));
create policy "representative documents scoped" on public.representative_documents for select to authenticated using (private.owns_representative(representative_id) or private.has_permission('representatives.read_all'));
create policy "representative contracts scoped" on public.representative_contracts for select to authenticated using (private.owns_representative(representative_id) or private.has_permission('representatives.read_all'));
create policy "representative trainings scoped" on public.representative_trainings for select to authenticated using (private.owns_representative(representative_id) or private.has_permission('representatives.read_all'));
create policy "representative notifications scoped" on public.representative_notifications for select to authenticated using (private.owns_representative(representative_id));

revoke insert, update, delete, truncate on public.commission_entries, public.commission_closing_entries,
  public.representative_inventory_movements, public.representative_status_history from anon, authenticated;
revoke update on public.representative_applications from authenticated;
grant update(current_step,answers,personal_data,commercial_data,referral_code,terms_version,
  terms_accepted_at,version,updated_at,cpf_ciphertext,cpf_last_four)
on public.representative_applications to authenticated;
grant usage on schema private to authenticated;
grant execute on function private.user_has_role(public.app_role) to authenticated;
grant execute on function private.owns_representative(uuid) to authenticated;
revoke all on function public.submit_representative_application(uuid) from public, anon;
grant execute on function public.submit_representative_application(uuid) to authenticated;
revoke all on function public.review_representative_application(uuid,text,text) from public, anon;
grant execute on function public.review_representative_application(uuid,text,text) to authenticated;
revoke all on function private.rebuild_representative_network_closure() from public, anon;
grant execute on function private.rebuild_representative_network_closure() to authenticated;

create trigger touch_representative_applications before update on public.representative_applications for each row execute function private.touch_updated_at();
create trigger touch_representatives before update on public.representatives for each row execute function private.touch_updated_at();
create trigger touch_levels before update on public.representative_levels for each row execute function private.touch_updated_at();
create trigger touch_kits before update on public.kits for each row execute function private.touch_updated_at();
create trigger touch_kit_orders before update on public.kit_orders for each row execute function private.touch_updated_at();
create trigger touch_representative_sales before update on public.representative_sales for each row execute function private.touch_updated_at();
create trigger touch_commission_closings before update on public.commission_closings for each row execute function private.touch_updated_at();

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('representative-documents','representative-documents',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict(id) do nothing;
create policy "representative document owner upload" on storage.objects for insert to authenticated with check (
  bucket_id = 'representative-documents' and (storage.foldername(name))[1] = auth.uid()::text
  and lower(storage.extension(name)) in ('jpg','jpeg','png','webp','pdf')
);
create policy "representative document scoped read" on storage.objects for select to authenticated using (
  bucket_id = 'representative-documents' and ((storage.foldername(name))[1] = auth.uid()::text or private.has_permission('representatives.application.review'))
);

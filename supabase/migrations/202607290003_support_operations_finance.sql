create table public.support_sla_policies (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  priority public.support_priority not null,
  category_slug text,
  first_response_minutes integer not null check (first_response_minutes > 0),
  update_minutes integer not null check (update_minutes > 0),
  resolution_minutes integer not null check (resolution_minutes > 0),
  business_hours_only boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.support_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  active boolean not null default true,
  default_priority public.support_priority not null default 'normal',
  default_sla_policy_id uuid references public.support_sla_policies(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.support_quick_answers (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.support_categories(id),
  question text not null,
  slug text not null unique,
  answer text not null,
  keywords text[] not null default '{}',
  action_buttons jsonb not null default '[]'::jsonb,
  target_audience text not null default 'all',
  active boolean not null default false,
  sort_order integer not null default 0,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.support_quick_answer_feedback (
  id uuid primary key default gen_random_uuid(),
  quick_answer_id uuid not null references public.support_quick_answers(id) on delete cascade,
  customer_id uuid references public.profiles(id),
  session_id uuid not null,
  resolved boolean not null,
  feedback text,
  created_at timestamptz not null default now()
);

create table public.support_business_hours (
  id uuid primary key default gen_random_uuid(),
  weekday smallint not null check (weekday between 0 and 6),
  starts_at time not null,
  ends_at time not null,
  active boolean not null default true,
  check (ends_at > starts_at)
);

create table public.support_holidays (
  id uuid primary key default gen_random_uuid(),
  date date not null unique,
  description text not null
);

create table public.support_conversations (
  id uuid primary key default gen_random_uuid(),
  public_code text not null unique default ('ATD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  customer_id uuid not null references public.profiles(id),
  related_order_id uuid references public.orders(id),
  category_id uuid not null references public.support_categories(id),
  priority public.support_priority not null default 'normal',
  status public.support_status not null default 'queued',
  assigned_user_id uuid references public.profiles(id),
  assigned_role public.app_role not null default 'admin',
  origin text not null,
  subject text not null check (char_length(subject) between 5 and 120),
  first_response_due_at timestamptz,
  resolution_due_at timestamptz,
  first_response_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  reopened_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (assigned_role <> 'customer'),
  check (assigned_role <> 'operational' or assigned_user_id is not null)
);

create index support_queue_idx on public.support_conversations(priority desc, created_at)
  where status in ('open', 'queued', 'assigned', 'in_progress', 'reopened');

create table public.support_participants (
  conversation_id uuid not null references public.support_conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  participant_role public.app_role not null,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key(conversation_id, user_id)
);

create table public.support_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.support_conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  sender_role public.app_role not null,
  message_type text not null default 'text',
  content_sanitized text not null check (char_length(content_sanitized) between 1 and 4000),
  is_internal_note boolean not null default false,
  reply_to_message_id uuid references public.support_messages(id),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  check (not (sender_role = 'customer' and is_internal_note))
);

alter publication supabase_realtime add table public.support_messages;

create table public.support_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.support_messages(id) on delete cascade,
  storage_path text not null unique,
  original_name_sanitized text not null,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  size_bytes integer not null check (size_bytes between 1 and 10485760),
  scan_status text not null default 'pending',
  created_at timestamptz not null default now()
);

create table public.support_assignments (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.support_conversations(id) on delete cascade,
  assigned_from uuid references public.profiles(id),
  assigned_to uuid references public.profiles(id),
  assigned_role public.app_role not null check (assigned_role <> 'customer'),
  reason text not null check (char_length(reason) >= 10),
  assigned_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.support_status_history (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.support_conversations(id) on delete cascade,
  previous_status public.support_status,
  new_status public.support_status not null,
  reason text not null,
  changed_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.support_tags (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  color_token text not null,
  active boolean not null default true
);

create table public.support_conversation_tags (
  conversation_id uuid not null references public.support_conversations(id) on delete cascade,
  tag_id uuid not null references public.support_tags(id) on delete cascade,
  created_by uuid not null references public.profiles(id),
  primary key(conversation_id, tag_id)
);

create table public.support_saved_replies (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  shortcut text not null unique,
  content text not null,
  category_id uuid references public.support_categories(id),
  allowed_roles public.app_role[] not null default array['admin']::public.app_role[],
  active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.support_satisfaction (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null unique references public.support_conversations(id),
  customer_id uuid not null references public.profiles(id),
  rating smallint not null check (rating between 1 and 5),
  resolved boolean not null,
  dissatisfaction_reason text,
  comment text,
  manager_response text,
  created_at timestamptz not null default now()
);

create table public.support_blocklist (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.profiles(id),
  email_hash text,
  ip_hash text,
  reason text not null,
  expires_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (num_nonnulls(customer_id, email_hash, ip_hash) >= 1)
);

create table public.returns (
  id uuid primary key default gen_random_uuid(),
  public_code text not null unique default ('DEV-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  order_id uuid not null references public.orders(id),
  customer_id uuid not null references public.profiles(id),
  reason text not null,
  description text not null,
  requested_resolution text not null,
  status public.return_status not null default 'requested',
  eligibility_snapshot jsonb not null,
  reverse_logistics_code text,
  requested_at timestamptz not null default now(),
  approved_by uuid references public.profiles(id),
  resolved_at timestamptz
);

create table public.return_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.returns(id) on delete cascade,
  order_item_id uuid not null references public.order_items(id),
  quantity integer not null check (quantity > 0),
  inspection_result text,
  condition text,
  restock_destination text check (restock_destination in ('sellable', 'damaged', 'discard', 'supplier')),
  resolution text,
  unique(return_id, order_item_id)
);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  cnpj_ciphertext text,
  contact_name text,
  phone text,
  email extensions.citext,
  lead_time_days integer check (lead_time_days >= 0),
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  public_code text not null unique,
  supplier_id uuid not null references public.suppliers(id),
  status text not null,
  expected_at date,
  total_cost numeric(12,2) not null default 0,
  created_by uuid not null references public.profiles(id),
  approved_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id),
  ordered_quantity integer not null check (ordered_quantity > 0),
  received_quantity integer not null default 0 check (received_quantity >= 0),
  unit_cost numeric(12,2) not null check (unit_cost >= 0),
  check (received_quantity <= ordered_quantity)
);

create table public.inventory_counts (
  id uuid primary key default gen_random_uuid(),
  public_code text not null unique,
  status text not null,
  snapshot_at timestamptz not null,
  created_by uuid not null references public.profiles(id),
  approved_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.inventory_count_items (
  id uuid primary key default gen_random_uuid(),
  count_id uuid not null references public.inventory_counts(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id),
  expected_quantity integer not null check (expected_quantity >= 0),
  counted_quantity integer check (counted_quantity >= 0),
  reason text,
  unique(count_id, variant_id)
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  description text not null,
  amount numeric(12,2) not null check (amount > 0),
  occurred_at date not null,
  created_by uuid not null references public.profiles(id),
  approved_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.financial_entries (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id),
  type text not null,
  amount numeric(12,2) not null,
  source text not null,
  occurred_at timestamptz not null,
  reconciliation_status text not null default 'pending',
  immutable_after_close boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.payment_reconciliations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  payment_id uuid not null references public.payments(id),
  gross_amount numeric(12,2) not null,
  provider_fee numeric(12,2) not null,
  net_amount numeric(12,2) not null,
  release_date date,
  status text not null,
  divergence_amount numeric(12,2) not null default 0,
  reconciled_by uuid references public.profiles(id),
  reconciled_at timestamptz,
  unique(payment_id)
);

create table public.financial_closures (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  status text not null default 'draft',
  totals jsonb not null default '{}'::jsonb,
  notes text,
  closed_by uuid references public.profiles(id),
  closed_at timestamptz,
  reopened_by uuid references public.profiles(id),
  reopened_at timestamptz,
  reopen_reason text,
  created_at timestamptz not null default now(),
  unique(period_start, period_end),
  check (period_end >= period_start)
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id),
  product_id uuid not null references public.products(id),
  order_item_id uuid references public.order_items(id),
  variant_id uuid references public.product_variants(id),
  rating smallint not null check (rating between 1 and 5),
  title text,
  content text not null,
  status text not null default 'pending',
  verified_purchase boolean not null default false,
  brand_response text,
  helpful_votes integer not null default 0,
  moderated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  edited_at timestamptz
);

create table public.product_questions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id),
  product_id uuid not null references public.products(id),
  question_sanitized text not null,
  answer_sanitized text,
  status text not null default 'pending',
  answered_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  answered_at timestamptz
);

create table public.cms_pages (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null unique,
  summary text,
  content_sanitized jsonb not null default '{}'::jsonb,
  image_path text,
  seo_title text,
  seo_description text,
  canonical_url text,
  status text not null default 'draft',
  published_at timestamptz,
  author_id uuid references public.profiles(id),
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.redirects (
  id uuid primary key default gen_random_uuid(),
  source_path text not null unique check (source_path like '/%'),
  destination_path text not null check (destination_path like '/%'),
  permanent boolean not null default true,
  active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.marketing_segments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  definition jsonb not null,
  active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.marketing_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id),
  anonymous_session_id uuid,
  event_type text not null,
  product_id uuid references public.products(id),
  order_id uuid references public.orders(id),
  utm_source text,
  utm_medium text,
  utm_campaign text,
  device_category text,
  context_sanitized jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  check (user_id is not null or anonymous_session_id is not null)
);

create index marketing_funnel_idx on public.marketing_events(event_type, occurred_at desc);

create table public.risk_assessments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  score integer not null check (score between 0 and 100),
  level public.risk_level not null,
  reasons text[] not null default '{}',
  signals_sanitized jsonb not null default '{}'::jsonb,
  decision text,
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.system_settings (
  key text primary key,
  value jsonb not null,
  is_public boolean not null default false,
  version integer not null default 1,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

create table public.commercial_policies (
  id uuid primary key default gen_random_uuid(),
  version integer not null unique,
  rules jsonb not null,
  active_from timestamptz not null,
  active_until timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (active_until is null or active_until > active_from)
);

create table public.feature_flags (
  key text primary key,
  enabled boolean not null default false,
  target_roles public.app_role[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

create table public.integration_health (
  provider text primary key,
  state public.integration_state not null,
  checked_at timestamptz,
  latency_ms integer,
  error_summary text,
  metadata_sanitized jsonb not null default '{}'::jsonb
);

create table public.background_jobs (
  id uuid primary key default gen_random_uuid(),
  queue text not null,
  job_type text not null,
  payload_sanitized jsonb not null,
  status public.job_status not null default 'pending',
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  completed_at timestamptz,
  error_summary text,
  idempotency_key text unique,
  created_at timestamptz not null default now()
);

create index pending_jobs_idx on public.background_jobs(queue, available_at)
  where status = 'pending';

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  type text not null,
  title text not null,
  body text not null,
  channels text[] not null default array['internal'],
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.data_requests (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id),
  request_type text not null,
  status text not null default 'requested',
  requested_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id),
  actor_role public.app_role,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  previous_data_sanitized jsonb,
  new_data_sanitized jsonb,
  reason text,
  request_id uuid,
  ip_hash text,
  user_agent_summary text,
  created_at timestamptz not null default now()
);

create index audit_entity_idx on public.audit_logs(entity_type, entity_id, created_at desc);

create table public.technical_events (
  id uuid primary key default gen_random_uuid(),
  severity text not null,
  source text not null,
  event_type text not null,
  message text not null,
  context_sanitized jsonb not null default '{}'::jsonb,
  request_id uuid,
  created_at timestamptz not null default now()
);

create index technical_events_idx on public.technical_events(severity, created_at desc);

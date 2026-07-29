create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (char_length(full_name) between 3 and 120),
  email_snapshot extensions.citext not null,
  phone text,
  avatar_path text,
  status public.user_status not null default 'active',
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_roles (
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.app_role not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table public.permissions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  description text not null
);

create table public.role_permissions (
  role public.app_role not null,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  primary key (role, permission_id)
);

create table public.user_permission_overrides (
  user_id uuid not null references public.profiles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  allowed boolean not null,
  reason text not null,
  expires_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (user_id, permission_id)
);

create table public.internal_invites (
  id uuid primary key default gen_random_uuid(),
  email extensions.citext not null,
  full_name text not null,
  target_role public.app_role not null check (target_role <> 'customer'),
  status text not null default 'pending',
  expires_at timestamptz not null,
  created_by uuid not null references public.profiles(id),
  accepted_by uuid references public.profiles(id),
  reason text not null,
  created_at timestamptz not null default now()
);

create table public.customer_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  consent_type text not null,
  accepted boolean not null,
  version text not null,
  ip_hash text,
  user_agent_summary text,
  created_at timestamptz not null default now()
);

create table public.addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  label text not null,
  recipient_name text not null,
  postal_code text not null,
  street text not null,
  number text not null,
  complement text,
  district text not null,
  city text not null,
  state char(2) not null,
  country char(2) not null default 'BR',
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index one_default_address_per_user
  on public.addresses(user_id) where is_default;

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  parent_id uuid references public.categories(id),
  active boolean not null default true,
  sort_order integer not null default 0,
  seo_title text,
  seo_description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.collections (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  starts_at timestamptz,
  ends_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  short_description text not null,
  description text not null,
  category_id uuid not null references public.categories(id),
  collection_id uuid references public.collections(id),
  status public.product_status not null default 'draft',
  featured boolean not null default false,
  base_price numeric(12,2) not null check (base_price >= 0),
  cost_price numeric(12,2) not null default 0 check (cost_price >= 0),
  weight_grams integer not null check (weight_grams > 0),
  height_cm numeric(8,2) not null check (height_cm > 0),
  width_cm numeric(8,2) not null check (width_cm > 0),
  length_cm numeric(8,2) not null check (length_cm > 0),
  seo_title text,
  seo_description text,
  search_document tsvector generated always as (
    setweight(to_tsvector('simple', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(short_description, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(description, '')), 'C')
  ) stored,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index products_search_idx on public.products using gin(search_document);
create index products_name_trgm_idx on public.products using gin(name gin_trgm_ops);
create index products_active_idx on public.products(created_at desc) where status = 'active';

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  sku extensions.citext not null unique,
  color_name text not null,
  color_hex char(7),
  size text not null,
  price_override numeric(12,2) check (price_override >= 0),
  cost_override numeric(12,2) check (cost_override >= 0),
  active boolean not null default true,
  barcode text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(product_id, color_name, size)
);

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  variant_id uuid references public.product_variants(id) on delete cascade,
  storage_path text not null unique,
  alt_text text not null,
  sort_order integer not null default 0,
  is_primary boolean not null default false,
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  blur_data text,
  created_at timestamptz not null default now()
);

create table public.inventory (
  variant_id uuid primary key references public.product_variants(id),
  available_quantity integer not null default 0 check (available_quantity >= 0),
  reserved_quantity integer not null default 0 check (reserved_quantity >= 0),
  damaged_quantity integer not null default 0 check (damaged_quantity >= 0),
  minimum_quantity integer not null default 5 check (minimum_quantity >= 0),
  ideal_quantity integer not null default 20 check (ideal_quantity >= 0),
  version integer not null default 1,
  updated_at timestamptz not null default now()
);

create table public.carts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.profiles(id),
  anonymous_token_hash text unique,
  status text not null default 'active',
  currency char(3) not null default 'BRL',
  expires_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (customer_id is not null or anonymous_token_hash is not null)
);

create table public.cart_items (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.carts(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id),
  quantity integer not null check (quantity between 1 and 99),
  unit_price_snapshot numeric(12,2) not null check (unit_price_snapshot >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(cart_id, variant_id)
);

create table public.inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.carts(id),
  order_id uuid,
  variant_id uuid not null references public.product_variants(id),
  quantity integer not null check (quantity > 0),
  expires_at timestamptz not null,
  converted_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  check (not (converted_at is not null and released_at is not null))
);

create index active_reservations_idx on public.inventory_reservations(expires_at)
  where converted_at is null and released_at is null;

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.product_variants(id),
  movement_type text not null,
  quantity integer not null check (quantity <> 0),
  previous_quantity integer not null check (previous_quantity >= 0),
  new_quantity integer not null check (new_quantity >= 0),
  reason text not null,
  reference_type text,
  reference_id uuid,
  performed_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.coupons (
  id uuid primary key default gen_random_uuid(),
  code extensions.citext not null unique,
  name text not null,
  discount_type text not null,
  discount_value numeric(12,4) not null check (discount_value >= 0),
  minimum_order_value numeric(12,2) not null default 0,
  maximum_discount numeric(12,2),
  usage_limit integer,
  usage_limit_per_customer integer,
  combinable boolean not null default false,
  priority integer not null default 0,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  active boolean not null default false,
  requires_manager_approval boolean not null default false,
  rules jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table public.coupon_scopes (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references public.coupons(id) on delete cascade,
  category_id uuid references public.categories(id),
  product_id uuid references public.products(id),
  collection_id uuid references public.collections(id),
  variant_id uuid references public.product_variants(id),
  region_prefix text,
  check (num_nonnulls(category_id, product_id, collection_id, variant_id, region_prefix) = 1)
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  public_code text not null unique default ('CZT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))),
  customer_id uuid references public.profiles(id),
  customer_email_snapshot extensions.citext not null,
  customer_name_snapshot text not null,
  customer_phone_snapshot text,
  cpf_ciphertext text,
  cpf_last_four char(4),
  status public.order_status not null default 'draft',
  payment_status public.payment_status not null default 'pending',
  currency char(3) not null default 'BRL',
  subtotal numeric(12,2) not null check (subtotal >= 0),
  discount_total numeric(12,2) not null default 0 check (discount_total >= 0),
  shipping_total numeric(12,2) not null default 0 check (shipping_total >= 0),
  shipping_cost numeric(12,2) not null default 0 check (shipping_cost >= 0),
  fee_total numeric(12,2) not null default 0 check (fee_total >= 0),
  grand_total numeric(12,2) not null check (grand_total >= 0),
  cost_total numeric(12,2) not null default 0 check (cost_total >= 0),
  estimated_profit numeric(12,2) not null default 0,
  coupon_id uuid references public.coupons(id),
  shipping_address_snapshot jsonb not null,
  commercial_rules_snapshot jsonb not null default '{}'::jsonb,
  risk_level public.risk_level not null default 'low',
  placed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.inventory_reservations
  add constraint reservation_order_fk foreign key (order_id) references public.orders(id);

create index orders_customer_idx on public.orders(customer_id, created_at desc);
create index orders_status_idx on public.orders(status, created_at);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id),
  variant_id uuid not null references public.product_variants(id),
  product_name_snapshot text not null,
  sku_snapshot text not null,
  color_snapshot text not null,
  size_snapshot text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  discount_amount numeric(12,2) not null default 0 check (discount_amount >= 0),
  total numeric(12,2) not null check (total >= 0),
  unit_cost_snapshot numeric(12,2) not null default 0 check (unit_cost_snapshot >= 0)
);

create table public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  previous_status public.order_status,
  new_status public.order_status not null,
  reason text not null,
  changed_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  provider text not null,
  provider_payment_id text unique,
  provider_preference_id text,
  external_reference text not null unique,
  status public.payment_status not null default 'pending',
  amount numeric(12,2) not null check (amount >= 0),
  currency char(3) not null default 'BRL',
  payment_method_summary text,
  provider_fee numeric(12,2) not null default 0,
  paid_at timestamptz,
  raw_payload_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  event_type text not null,
  payload_hash text not null,
  signature_valid boolean not null,
  processing_status text not null,
  attempts integer not null default 0,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error_summary text,
  unique(provider, provider_event_id)
);

create table public.idempotency_keys (
  key text not null,
  scope text not null,
  resource_id uuid,
  response_hash text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key(scope, key)
);

create table public.shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  provider text not null,
  service text not null,
  tracking_code text unique,
  label_path text,
  status public.shipment_status not null default 'pending',
  package_snapshot jsonb not null default '{}'::jsonb,
  dispatched_at timestamptz,
  delivered_at timestamptz,
  metadata_sanitized jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.tracking_events (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  provider_event_id text,
  status public.shipment_status not null,
  description text not null,
  location_summary text,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique(shipment_id, provider_event_id)
);

create table public.favorites (
  customer_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(customer_id, product_id)
);

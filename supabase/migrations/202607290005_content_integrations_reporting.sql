create table public.banners (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  subtitle text,
  image_path_desktop text not null,
  image_path_mobile text not null,
  destination_url text not null check (destination_url like '/%'),
  position text not null,
  status text not null default 'draft',
  starts_at timestamptz,
  ends_at timestamptz,
  sort_order integer not null default 0,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create table public.coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references public.coupons(id),
  customer_id uuid references public.profiles(id),
  order_id uuid not null references public.orders(id),
  discount_amount numeric(12,2) not null check (discount_amount >= 0),
  redeemed_at timestamptz not null default now(),
  unique(coupon_id, order_id)
);

create table public.promotion_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  promotion_type text not null,
  rules jsonb not null,
  status text not null default 'draft',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  requires_manager_approval boolean not null default false,
  approved_by uuid references public.profiles(id),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table public.shipping_quotes (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.carts(id) on delete cascade,
  provider text not null,
  service text not null,
  amount numeric(12,2) not null check (amount >= 0),
  estimated_days integer not null check (estimated_days > 0),
  packages jsonb not null default '[]'::jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.order_notes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  content_sanitized text not null,
  created_at timestamptz not null default now()
);

create table public.order_shipments (
  order_id uuid not null references public.orders(id) on delete cascade,
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  primary key(order_id, shipment_id)
);

create table public.email_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id),
  template text not null,
  recipient_hash text not null,
  provider text not null,
  provider_message_id text,
  status text not null,
  attempts integer not null default 0,
  idempotency_key text not null unique,
  error_summary text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create table public.erp_documents (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  provider text not null,
  external_id text,
  document_type text not null,
  status text not null,
  reference text,
  error_summary text,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.saved_reports (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id),
  name text not null,
  report_type text not null,
  filters jsonb not null default '{}'::jsonb,
  schedule text,
  target_roles public.app_role[] not null default '{}',
  created_at timestamptz not null default now()
);

create table public.report_exports (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references public.profiles(id),
  report_type text not null,
  filters jsonb not null default '{}'::jsonb,
  format text not null check (format in ('csv','xlsx')),
  status public.job_status not null default 'pending',
  storage_path text,
  expires_at timestamptz,
  error_summary text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.security_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id),
  event_type text not null,
  severity text not null,
  request_id uuid,
  ip_hash text,
  context_sanitized jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.temporary_data_access (
  id uuid primary key default gen_random_uuid(),
  grantee_id uuid not null references public.profiles(id),
  customer_id uuid not null references public.profiles(id),
  reason text not null,
  approved_by uuid references public.profiles(id),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'banners','coupon_redemptions','promotion_campaigns','shipping_quotes','order_notes',
    'order_shipments','email_deliveries','erp_documents','saved_reports','report_exports',
    'security_events','temporary_data_access'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
  end loop;
end $$;

create policy "public reads current banners" on public.banners
  for select to anon, authenticated using (
    status = 'published'
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at > now())
  );
create policy "admin manages banners" on public.banners
  for all to authenticated using (private.has_permission('banners.update'))
  with check (private.has_permission('banners.update'));
create policy "customer reads own shipping quotes" on public.shipping_quotes
  for select to authenticated using (
    exists(select 1 from public.carts c where c.id = cart_id and c.customer_id = auth.uid())
  );
create policy "customer reads own coupon redemptions" on public.coupon_redemptions
  for select to authenticated using (customer_id = auth.uid());
create policy "promotion managers" on public.promotion_campaigns
  for all to authenticated using (private.has_permission('promotions.advanced_manage'))
  with check (private.has_permission('promotions.advanced_manage'));
create policy "internal order notes" on public.order_notes
  for select to authenticated using (
    private.has_permission('orders.read_all') or private.has_permission('orders.read_assigned')
  );
create policy "report owners read exports" on public.report_exports
  for select to authenticated using (
    requested_by = auth.uid() or private.has_permission('reports.export')
  );
create policy "technical reads email state" on public.email_deliveries
  for select to authenticated using (private.has_permission('technical.health.read'));
create policy "technical reads erp state" on public.erp_documents
  for select to authenticated using (
    private.has_permission('technical.health.read') or private.has_permission('erp.manage')
  );
create policy "security events technical" on public.security_events
  for select to authenticated using (private.has_permission('technical.logs.read'));
create policy "temporary access grantee" on public.temporary_data_access
  for select to authenticated using (
    grantee_id = auth.uid() or private.has_permission('audit.read')
  );

create trigger touch_banners before update on public.banners
  for each row execute function private.touch_updated_at();
create trigger touch_promotions before update on public.promotion_campaigns
  for each row execute function private.touch_updated_at();
create trigger touch_erp_documents before update on public.erp_documents
  for each row execute function private.touch_updated_at();

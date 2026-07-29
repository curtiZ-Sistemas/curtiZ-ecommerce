create or replace function private.current_app_role()
returns public.app_role
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  claim_role text;
  db_role public.app_role;
begin
  claim_role := auth.jwt() -> 'app_metadata' ->> 'role';
  if claim_role in ('customer', 'operational', 'admin', 'manager', 'technical') then
    return claim_role::public.app_role;
  end if;

  select ur.role into db_role
  from public.user_roles ur
  where ur.user_id = auth.uid()
  order by case ur.role
    when 'technical' then 1
    when 'manager' then 2
    when 'admin' then 3
    when 'operational' then 4
    else 5
  end
  limit 1;

  return coalesce(db_role, 'customer'::public.app_role);
end;
$$;

create or replace function private.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'active'
  );
$$;

create or replace function private.current_aal()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1');
$$;

create or replace function private.has_permission(permission_code text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  override_allowed boolean;
begin
  if not private.is_active_user() then return false; end if;

  select upo.allowed into override_allowed
  from public.user_permission_overrides upo
  join public.permissions p on p.id = upo.permission_id
  where upo.user_id = auth.uid()
    and p.code = permission_code
    and (upo.expires_at is null or upo.expires_at > now())
  limit 1;

  if override_allowed is not null then return override_allowed; end if;

  return exists (
    select 1
    from public.role_permissions rp
    join public.permissions p on p.id = rp.permission_id
    where rp.role = private.current_app_role()
      and p.code = permission_code
  );
end;
$$;

create or replace function private.require_permission(permission_code text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not private.has_permission(permission_code) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
end;
$$;

create or replace function private.can_access_support(conversation public.support_conversations)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    conversation.customer_id = auth.uid()
    or (
      private.current_app_role() = 'admin'
      and private.has_permission('support.conversations.read')
    )
    or (
      private.current_app_role() = 'operational'
      and conversation.assigned_role = 'operational'
      and conversation.assigned_user_id = auth.uid()
      and private.has_permission('support.conversations.read')
    )
    or (
      private.current_app_role() = 'manager'
      and conversation.assigned_role = 'manager'
      and conversation.status = 'escalated'
      and private.has_permission('support.conversations.read')
    )
    or (
      private.current_app_role() = 'technical'
      and conversation.assigned_role = 'technical'
      and conversation.status = 'escalated'
      and private.has_permission('support.conversations.read')
    );
$$;

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles(id, full_name, email_snapshot, status)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), 'Cliente Curtiz'),
    new.email,
    'active'
  );
  insert into public.user_roles(user_id, role) values (new.id, 'customer');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

create or replace function private.force_initial_admin_queue()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.status := 'queued';
  new.assigned_role := 'admin';
  new.assigned_user_id := null;
  return new;
end;
$$;

create trigger support_initial_admin_queue
  before insert on public.support_conversations
  for each row execute function private.force_initial_admin_queue();

create or replace function private.reserve_inventory(
  p_cart_id uuid,
  p_variant_id uuid,
  p_quantity integer,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  reservation_id uuid;
  available integer;
begin
  if p_quantity <= 0 then raise exception 'invalid quantity'; end if;

  select i.available_quantity into available
  from public.inventory i
  where i.variant_id = p_variant_id
  for update;

  if available is null or available < p_quantity then
    raise exception 'insufficient stock' using errcode = 'P0001';
  end if;

  update public.inventory
  set available_quantity = available_quantity - p_quantity,
      reserved_quantity = reserved_quantity + p_quantity,
      version = version + 1,
      updated_at = now()
  where variant_id = p_variant_id;

  insert into public.inventory_reservations(cart_id, variant_id, quantity, expires_at)
  values (p_cart_id, p_variant_id, p_quantity, p_expires_at)
  returning id into reservation_id;

  return reservation_id;
end;
$$;

create or replace function private.release_expired_reservations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  released_count integer := 0;
  reservation record;
begin
  for reservation in
    select * from public.inventory_reservations
    where expires_at <= now() and converted_at is null and released_at is null
    for update skip locked
  loop
    update public.inventory
    set available_quantity = available_quantity + reservation.quantity,
        reserved_quantity = reserved_quantity - reservation.quantity,
        version = version + 1,
        updated_at = now()
    where variant_id = reservation.variant_id
      and reserved_quantity >= reservation.quantity;

    update public.inventory_reservations set released_at = now() where id = reservation.id;
    released_count := released_count + 1;
  end loop;
  return released_count;
end;
$$;

create or replace function private.convert_order_reservations(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  reservation record;
begin
  for reservation in
    select * from public.inventory_reservations
    where order_id = p_order_id and converted_at is null and released_at is null
    for update
  loop
    update public.inventory
    set reserved_quantity = reserved_quantity - reservation.quantity,
        version = version + 1,
        updated_at = now()
    where variant_id = reservation.variant_id
      and reserved_quantity >= reservation.quantity;

    update public.inventory_reservations set converted_at = now() where id = reservation.id;
    insert into public.inventory_movements(
      variant_id, movement_type, quantity, previous_quantity, new_quantity,
      reason, reference_type, reference_id
    )
    select
      reservation.variant_id, 'sale', -reservation.quantity,
      i.available_quantity + reservation.quantity, i.available_quantity,
      'Pagamento aprovado', 'order', p_order_id
    from public.inventory i where i.variant_id = reservation.variant_id;
  end loop;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles','user_roles','permissions','role_permissions','user_permission_overrides',
    'internal_invites','customer_consents','addresses','categories','collections','products',
    'product_variants','product_images','inventory','carts','cart_items','inventory_reservations',
    'inventory_movements','coupons','coupon_scopes','orders','order_items','order_status_history',
    'payments','payment_events','idempotency_keys','shipments','tracking_events','favorites',
    'support_sla_policies','support_categories','support_quick_answers',
    'support_quick_answer_feedback','support_business_hours','support_holidays',
    'support_conversations','support_participants','support_messages','support_attachments',
    'support_assignments','support_status_history','support_tags','support_conversation_tags',
    'support_saved_replies','support_satisfaction','support_blocklist','returns','return_items',
    'suppliers','purchase_orders','purchase_order_items','inventory_counts','inventory_count_items',
    'expenses','financial_entries','payment_reconciliations','financial_closures','reviews',
    'product_questions','cms_pages','redirects','marketing_segments','marketing_events',
    'risk_assessments','system_settings','commercial_policies','feature_flags',
    'integration_health','background_jobs','notifications','data_requests','audit_logs',
    'technical_events'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
  end loop;
end $$;

create policy "public reads active categories" on public.categories
  for select to anon, authenticated using (active);
create policy "public reads active collections" on public.collections
  for select to anon, authenticated using (
    active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now())
  );
create policy "public reads active products" on public.products
  for select to anon, authenticated using (status = 'active');
create policy "public reads active variants" on public.product_variants
  for select to anon, authenticated using (
    active and exists(select 1 from public.products p where p.id = product_id and p.status = 'active')
  );
create policy "public reads product images" on public.product_images
  for select to anon, authenticated using (
    exists(select 1 from public.products p where p.id = product_id and p.status = 'active')
  );
create policy "public reads approved reviews" on public.reviews
  for select to anon, authenticated using (status = 'approved');
create policy "public reads answered questions" on public.product_questions
  for select to anon, authenticated using (status = 'published' and answer_sanitized is not null);
create policy "public reads published cms" on public.cms_pages
  for select to anon, authenticated using (status = 'published' and published_at <= now());
create policy "public reads active redirects" on public.redirects
  for select to anon, authenticated using (active);
create policy "public reads active quick answers" on public.support_quick_answers
  for select to anon, authenticated using (active);
create policy "public reads support categories" on public.support_categories
  for select to anon, authenticated using (active);
create policy "public reads settings allowlist" on public.system_settings
  for select to anon, authenticated using (is_public);

create policy "customer reads own profile" on public.profiles
  for select to authenticated using (id = auth.uid() or private.has_permission('users.read'));
create policy "customer updates own profile" on public.profiles
  for update to authenticated using (id = auth.uid() and private.is_active_user())
  with check (id = auth.uid() and status = 'active');

create policy "customer owns addresses" on public.addresses
  for all to authenticated using (user_id = auth.uid() and private.is_active_user())
  with check (user_id = auth.uid() and private.is_active_user());
create policy "customer owns consents" on public.customer_consents
  for select to authenticated using (user_id = auth.uid());
create policy "customer creates consents" on public.customer_consents
  for insert to authenticated with check (user_id = auth.uid());
create policy "customer owns favorites" on public.favorites
  for all to authenticated using (customer_id = auth.uid() and private.is_active_user())
  with check (customer_id = auth.uid() and private.is_active_user());
create policy "customer reads own carts" on public.carts
  for select to authenticated using (customer_id = auth.uid());
create policy "customer reads own cart items" on public.cart_items
  for select to authenticated using (
    exists(select 1 from public.carts c where c.id = cart_id and c.customer_id = auth.uid())
  );
create policy "customer reads own orders" on public.orders
  for select to authenticated using (customer_id = auth.uid());
create policy "customer reads own order items" on public.order_items
  for select to authenticated using (
    exists(select 1 from public.orders o where o.id = order_id and o.customer_id = auth.uid())
  );
create policy "customer reads own order history" on public.order_status_history
  for select to authenticated using (
    exists(select 1 from public.orders o where o.id = order_id and o.customer_id = auth.uid())
  );
create policy "customer reads own payments" on public.payments
  for select to authenticated using (
    exists(select 1 from public.orders o where o.id = order_id and o.customer_id = auth.uid())
  );
create policy "customer reads own shipments" on public.shipments
  for select to authenticated using (
    exists(select 1 from public.orders o where o.id = order_id and o.customer_id = auth.uid())
  );
create policy "customer reads own tracking" on public.tracking_events
  for select to authenticated using (
    exists(
      select 1 from public.shipments s
      join public.orders o on o.id = s.order_id
      where s.id = shipment_id and o.customer_id = auth.uid()
    )
  );
create policy "customer owns returns" on public.returns
  for select to authenticated using (customer_id = auth.uid() or private.has_permission('returns.read'));
create policy "customer requests returns" on public.returns
  for insert to authenticated with check (customer_id = auth.uid() and private.is_active_user());
create policy "customer creates reviews" on public.reviews
  for insert to authenticated with check (
    customer_id = auth.uid()
    and private.is_active_user()
    and (order_item_id is null or exists(
      select 1 from public.order_items oi
      join public.orders o on o.id = oi.order_id
      where oi.id = order_item_id and o.customer_id = auth.uid() and o.status = 'delivered'
    ))
  );
create policy "customer creates questions" on public.product_questions
  for insert to authenticated with check (customer_id = auth.uid() and private.is_active_user());
create policy "customer owns notifications" on public.notifications
  for select to authenticated using (user_id = auth.uid());
create policy "customer owns data requests" on public.data_requests
  for all to authenticated using (customer_id = auth.uid())
  with check (customer_id = auth.uid() and private.is_active_user());

create policy "support conversation authorized read" on public.support_conversations
  for select to authenticated using (private.can_access_support(support_conversations));
create policy "customer creates support to admin queue" on public.support_conversations
  for insert to authenticated with check (
    customer_id = auth.uid()
    and private.is_active_user()
    and assigned_role = 'admin'
    and assigned_user_id is null
  );
create policy "support authorized updates" on public.support_conversations
  for update to authenticated using (
    private.can_access_support(support_conversations)
    and (
      customer_id = auth.uid()
      or private.has_permission('support.conversations.assign')
      or private.has_permission('support.close')
    )
  )
  with check (
    private.can_access_support(support_conversations)
    and (
      private.has_permission('support.conversations.assign')
      or private.has_permission('support.close')
    )
  );
create policy "support participant reads own conversations" on public.support_participants
  for select to authenticated using (
    user_id = auth.uid()
    or exists(
      select 1 from public.support_conversations c
      where c.id = conversation_id and private.can_access_support(c)
    )
  );
create policy "support messages authorized read" on public.support_messages
  for select to authenticated using (
    exists(
      select 1 from public.support_conversations c
      where c.id = conversation_id
        and private.can_access_support(c)
        and (c.customer_id <> auth.uid() or is_internal_note = false)
    )
  );
create policy "support messages authorized insert" on public.support_messages
  for insert to authenticated with check (
    sender_id = auth.uid()
    and private.is_active_user()
    and exists(
      select 1 from public.support_conversations c
      where c.id = conversation_id
        and private.can_access_support(c)
        and (
          (c.customer_id = auth.uid() and sender_role = 'customer' and is_internal_note = false)
          or
          (c.customer_id <> auth.uid() and private.has_permission('support.conversations.reply'))
        )
    )
  );
create policy "support attachments follow messages" on public.support_attachments
  for select to authenticated using (
    exists(
      select 1 from public.support_messages m
      join public.support_conversations c on c.id = m.conversation_id
      where m.id = message_id
        and private.can_access_support(c)
        and (c.customer_id <> auth.uid() or m.is_internal_note = false)
    )
  );
create policy "customer owns satisfaction" on public.support_satisfaction
  for select to authenticated using (
    customer_id = auth.uid() or private.has_permission('support.reports.read')
  );
create policy "customer creates satisfaction" on public.support_satisfaction
  for insert to authenticated with check (
    customer_id = auth.uid()
    and exists(
      select 1 from public.support_conversations c
      where c.id = conversation_id and c.customer_id = auth.uid() and c.status in ('resolved','closed')
    )
  );

create policy "catalog managers products" on public.products
  for all to authenticated using (private.has_permission('products.update'))
  with check (private.has_permission('products.update'));
create policy "catalog managers variants" on public.product_variants
  for all to authenticated using (private.has_permission('products.update'))
  with check (private.has_permission('products.update'));
create policy "inventory readers" on public.inventory
  for select to authenticated using (private.has_permission('inventory.read'));
create policy "inventory adjusters" on public.inventory
  for update to authenticated using (private.has_permission('inventory.adjust'));
create policy "orders internal read" on public.orders
  for select to authenticated using (
    private.has_permission('orders.read_all') or private.has_permission('orders.read_assigned')
  );
create policy "returns internal read" on public.return_items
  for select to authenticated using (private.has_permission('returns.read'));
create policy "finance authorized" on public.financial_entries
  for select to authenticated using (
    private.has_permission('financial.read_full') or private.has_permission('finance.reconcile')
  );
create policy "expenses authorized" on public.expenses
  for select to authenticated using (private.has_permission('financial.read_full'));
create policy "reconciliation authorized" on public.payment_reconciliations
  for select to authenticated using (private.has_permission('finance.reconcile'));
create policy "technical events authorized" on public.technical_events
  for select to authenticated using (private.has_permission('technical.logs.read'));
create policy "integration health authorized" on public.integration_health
  for select to authenticated using (private.has_permission('technical.health.read'));
create policy "audit read only authorized" on public.audit_logs
  for select to authenticated using (private.has_permission('audit.read'));

revoke insert, update, delete, truncate on public.audit_logs from anon, authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values
  ('catalog-public', 'catalog-public', true, 10485760, array['image/jpeg','image/png','image/webp']),
  ('customer-private', 'customer-private', false, 10485760, array['image/jpeg','image/png','image/webp','application/pdf']),
  ('internal-private', 'internal-private', false, 20971520, array['image/jpeg','image/png','image/webp','application/pdf','text/csv'])
on conflict (id) do nothing;

create policy "public reads catalog media" on storage.objects
  for select to anon, authenticated using (bucket_id = 'catalog-public');
create policy "admin uploads catalog media" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'catalog-public' and private.has_permission('products.update')
  );
create policy "customer owns private objects" on storage.objects
  for select to authenticated using (
    bucket_id = 'customer-private' and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "customer uploads private objects" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'customer-private'
    and (storage.foldername(name))[1] = auth.uid()::text
    and lower(storage.extension(name)) in ('jpg','jpeg','png','webp','pdf')
  );
create policy "internal reads private objects" on storage.objects
  for select to authenticated using (
    bucket_id = 'internal-private'
    and (
      private.has_permission('reports.export')
      or private.has_permission('shipping.labels')
      or private.has_permission('technical.logs.read')
    )
  );

grant usage on schema private to authenticated;
grant execute on function private.current_app_role() to authenticated;
grant execute on function private.is_active_user() to authenticated;
grant execute on function private.current_aal() to authenticated;
grant execute on function private.has_permission(text) to authenticated;
revoke all on function private.reserve_inventory(uuid, uuid, integer, timestamptz) from public, anon, authenticated;
revoke all on function private.release_expired_reservations() from public, anon, authenticated;
revoke all on function private.convert_order_reservations(uuid) from public, anon, authenticated;

create trigger touch_profiles before update on public.profiles
  for each row execute function private.touch_updated_at();
create trigger touch_products before update on public.products
  for each row execute function private.touch_updated_at();
create trigger touch_variants before update on public.product_variants
  for each row execute function private.touch_updated_at();
create trigger touch_support_conversations before update on public.support_conversations
  for each row execute function private.touch_updated_at();
create trigger touch_quick_answers before update on public.support_quick_answers
  for each row execute function private.touch_updated_at();
create trigger touch_cms before update on public.cms_pages
  for each row execute function private.touch_updated_at();

create materialized view public.management_daily_metrics as
select
  date_trunc('day', created_at) as day,
  count(*) as order_count,
  sum(subtotal) as gross_revenue,
  sum(grand_total - fee_total - shipping_cost) as net_revenue,
  sum(estimated_profit) as estimated_profit,
  sum(case when payment_status = 'refunded' then grand_total else 0 end) as refunds
from public.orders
group by date_trunc('day', created_at)
with no data;

create unique index management_daily_metrics_day_idx
  on public.management_daily_metrics(day);

revoke all on public.management_daily_metrics from anon, authenticated;

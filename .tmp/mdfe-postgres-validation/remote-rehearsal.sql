begin;
set local lock_timeout='2s';
set local statement_timeout='25s';
do $stage_guard$ begin
  if (select max(version) from supabase_migrations.schema_migrations) is distinct from '20261030105219'
    or to_regclass('private.representative_kit_orders') is not null then
    raise exception 'unexpected staging baseline';
  end if;
end $stage_guard$;

-- 20261101121439_intelligence_retention_worker.sql
-- Definitions only: this migration does not delete any existing data.
-- The Worker must be explicitly enabled after approval of the retention cleanup.
create index if not exists session_interest_expiration_idx
  on public.session_interest_profiles(expires_at, session_id);
create index if not exists intelligence_rate_expiration_idx
  on private.intelligence_rate_buckets(window_start, session_id);

create function public.purge_expired_intelligence_data(p_batch_size integer default 500)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  batch_size integer := greatest(1, least(coalesce(p_batch_size, 500), 1000));
  retention_days integer;
  event_count integer;
  profile_count integer;
  rate_count integer;
begin
  select greatest(7, least(coalesce((
    select (value #>> '{}')::integer from public.system_settings
    where key = 'intelligence_event_retention_days'
  ), 30), 180)) into retention_days;

  with expired as (
    select id from public.marketing_events
    where occurred_at < now() - make_interval(days => retention_days)
      and order_id is null -- Preserve commercial attribution and financial evidence.
    order by occurred_at, id limit batch_size for update skip locked
  ), removed as (
    delete from public.marketing_events event using expired
    where event.id = expired.id returning 1
  ) select count(*) into event_count from removed;

  with expired as (
    select session_id from public.session_interest_profiles
    where expires_at < now()
    order by expires_at, session_id limit batch_size for update skip locked
  ), removed as (
    delete from public.session_interest_profiles profile using expired
    where profile.session_id = expired.session_id returning 1
  ) select count(*) into profile_count from removed;

  with expired as (
    select session_id, window_start from private.intelligence_rate_buckets
    where window_start < now() - interval '1 day'
    order by window_start, session_id limit batch_size for update skip locked
  ), removed as (
    delete from private.intelligence_rate_buckets bucket using expired
    where bucket.session_id = expired.session_id and bucket.window_start = expired.window_start
    returning 1
  ) select count(*) into rate_count from removed;

  return jsonb_build_object('events', event_count, 'profiles', profile_count, 'rateBuckets', rate_count);
end;
$$;

revoke all on function public.purge_expired_intelligence_data(integer) from public, anon, authenticated;
grant execute on function public.purge_expired_intelligence_data(integer) to service_role;
;

-- 20261101123450_reconcile_production_function_drift.sql
-- Reconcile verified live/main differences without editing applied migrations.
-- No rows, statuses, amounts, grants or RLS policies are changed by this migration.
-- Signup remains idempotent without reactivating an existing suspended profile.

create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, full_name, email_snapshot, status)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), 'Cliente Curtiz'), new.email, 'active')
  on conflict (id) do nothing;
  insert into public.user_roles(user_id, role) values (new.id, 'customer') on conflict do nothing;
  return new;
end;
$$;

create or replace function private.validate_banner_destination()
returns trigger language plpgsql security definer set search_path = '' as $$
declare destination record; destination_host text;
begin
  for destination in
    select new.destination_type as kind, new.destination_url as url
    union all select new.destination_type_mobile, new.destination_url_mobile
  loop
    -- Preserve optional destinations without removing URL safety checks.
    if destination.url is null then continue; end if;
    if destination.url ~ '[\\[:cntrl:]]' or destination.url ~* '%5c|%0[ad]' then
      raise exception 'invalid banner destination' using errcode = '23514';
    end if;
    if destination.kind = 'external_url' then
      destination_host := lower(substring(destination.url from '^https://([^/:?#@]+)(?:[/:?#]|$)'));
      if destination_host is null or not exists (
        select 1 from public.system_settings setting,
          jsonb_array_elements_text(setting.value) configured_host
        where setting.key = 'banner_external_hosts' and lower(configured_host) = destination_host
      ) then
        raise exception 'external banner host is not authorized' using errcode = '42501';
      end if;
    end if;
  end loop;
  return new;
end;
$$;

create or replace function public.admin_reorder_store_navigation(p_item_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
begin
  perform private.require_permission('catalog.taxonomy.manage');
  if coalesce(array_length(p_item_ids, 1), 0) > 100
    or coalesce(array_length(p_item_ids, 1), 0) <> (
      select count(distinct item_id)
      from unnest(coalesce(p_item_ids, array[]::uuid[])) as item(item_id)
    ) then
    raise exception 'invalid navigation order' using errcode = '22023';
  end if;
  with desired as (
    select item_id, (position - 1) * 10 as sort_order
    from unnest(coalesce(p_item_ids, array[]::uuid[])) with ordinality item(item_id, position)
  )
  update public.store_navigation_items navigation
  set sort_order = desired.sort_order, updated_by = auth.uid(), updated_at = now()
  from desired
  where navigation.id = desired.item_id;
  get diagnostics changed = row_count;
  if changed <> coalesce(array_length(p_item_ids, 1), 0) then
    raise exception 'navigation item not found' using errcode = 'P0002';
  end if;
  return changed;
end;
$$;

create or replace function public.manager_dashboard_metrics(
  p_date_from date,
  p_date_to date,
  p_region text default null,
  p_product_id uuid default null,
  p_category_id uuid default null,
  p_model_id uuid default null,
  p_representative_id uuid default null,
  p_level_id uuid default null,
  p_campaign_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
  period_days integer;
  previous_from date;
  previous_to date;
begin
  perform private.require_permission('financial.read_summary');

  if p_date_from is null or p_date_to is null or p_date_to < p_date_from then
    raise exception 'invalid management period';
  end if;
  if p_date_to - p_date_from > 366 then
    raise exception 'management period exceeds one year';
  end if;

  period_days := p_date_to - p_date_from + 1;
  previous_to := p_date_from - 1;
  previous_from := previous_to - period_days + 1;

  with scoped_orders as materialized (
    select sale.*
    from public.orders sale
    where (
        p_product_id is null and p_category_id is null and p_model_id is null
        or exists (
          select 1
          from public.order_items item
          join public.products product on product.id = item.product_id
          where item.order_id = sale.id
            and (p_product_id is null or product.id = p_product_id)
            and (p_category_id is null or product.category_id = p_category_id)
            and (p_model_id is null or product.model_id = p_model_id)
        )
      )
      and (
        p_region is null and p_representative_id is null and p_level_id is null
        or exists (
          select 1
          from public.representative_sales representative_sale
          join public.representatives representative
            on representative.id = representative_sale.representative_id
          where representative_sale.order_id = sale.id
            and (p_region is null or representative.region_code = p_region)
            and (p_representative_id is null or representative.id = p_representative_id)
            and (p_level_id is null or representative.current_level_id = p_level_id)
        )
      )
      and (
        p_campaign_id is null
        or exists (
          select 1
          from public.marketing_events event
          join public.creative_campaigns campaign
            on campaign.id = p_campaign_id and campaign.slug = event.utm_campaign
          where event.order_id = sale.id
        )
      )
  ), filtered_orders as materialized (
    select * from scoped_orders
    where payment_status = 'approved'
      and status not in ('draft','pending_payment','cancellation_requested','cancelled','refunded')
      and (coalesce(placed_at, created_at) at time zone 'America/Sao_Paulo')::date
        between p_date_from and p_date_to
  ), previous_orders as materialized (
    select * from scoped_orders
    where payment_status = 'approved'
      and status not in ('draft','pending_payment','cancellation_requested','cancelled','refunded')
      and (coalesce(placed_at, created_at) at time zone 'America/Sao_Paulo')::date
        between previous_from and previous_to
  ), completed_refunds as (
    select coalesce(sum(refund.amount), 0) as amount, count(*)::bigint as refund_count
    from public.payment_refunds refund
    join public.payments payment on payment.id = refund.payment_id
    join scoped_orders sale on sale.id = payment.order_id
    where refund.status = 'completed'
      and sale.payment_status = 'approved'
      and sale.status not in ('draft','pending_payment','cancellation_requested','cancelled','refunded')
      and (refund.completed_at at time zone 'America/Sao_Paulo')::date
        between p_date_from and p_date_to
  ), current_totals as (
    select
      count(*)::bigint as order_count,
      round(coalesce(sum(grand_total), 0) * 100)::bigint as gross_cents,
      round(coalesce(sum(grand_total - fee_total - shipping_cost), 0) * 100)::bigint as net_before_refunds_cents,
      round(coalesce(sum(estimated_profit), 0) * 100)::bigint as estimated_profit_cents,
      round(coalesce(avg(grand_total), 0) * 100)::bigint as average_ticket_cents
    from filtered_orders
  ), previous_totals as (
    select round(coalesce(sum(grand_total), 0) * 100)::bigint as gross_cents
    from previous_orders
  ), daily_sales as (
    select (coalesce(placed_at, created_at) at time zone 'America/Sao_Paulo')::date as day,
      round(sum(grand_total) * 100)::bigint as gross_cents,
      round(sum(grand_total - fee_total - shipping_cost) * 100)::bigint as net_cents,
      count(*)::bigint as order_count
    from filtered_orders group by 1
  ), daily_refunds as (
    select (refund.completed_at at time zone 'America/Sao_Paulo')::date as day,
      round(sum(refund.amount) * 100)::bigint as refund_cents
    from public.payment_refunds refund
    join public.payments payment on payment.id = refund.payment_id
    join scoped_orders sale on sale.id = payment.order_id
    where refund.status = 'completed' and sale.payment_status = 'approved'
      and sale.status not in ('draft','pending_payment','cancellation_requested','cancelled','refunded')
      and (refund.completed_at at time zone 'America/Sao_Paulo')::date between p_date_from and p_date_to
    group by 1
  ), daily as (
    select jsonb_agg(jsonb_build_object(
      'day', coalesce(sale.day, refund.day),
      'gross_cents', coalesce(sale.gross_cents, 0),
      'net_cents', coalesce(sale.net_cents, 0) - coalesce(refund.refund_cents, 0),
      'orders', coalesce(sale.order_count, 0)
    ) order by coalesce(sale.day, refund.day)) as series
    from daily_sales sale full join daily_refunds refund on refund.day = sale.day
  )
  select jsonb_build_object(
    'period', jsonb_build_object('from', p_date_from, 'to', p_date_to),
    'gross_cents', totals.gross_cents,
    'net_cents', totals.net_before_refunds_cents - round(refunds.amount * 100)::bigint,
    'estimated_profit_cents', totals.estimated_profit_cents,
    'refunds_cents', round(refunds.amount * 100)::bigint,
    'average_ticket_cents', totals.average_ticket_cents,
    'orders', totals.order_count,
    'gross_change_percent', case
      when previous.gross_cents = 0 then null
      else round(((totals.gross_cents - previous.gross_cents)::numeric / previous.gross_cents) * 100, 1)
    end,
    'series', coalesce(daily.series, '[]'::jsonb),
    'overview', jsonb_build_object(
      'customers', (
        select count(*) from public.profiles profile
        where (profile.created_at at time zone 'America/Sao_Paulo')::date between p_date_from and p_date_to
          and not exists (
            select 1 from public.user_roles role
            where role.user_id = profile.id
              and role.role in ('operational', 'admin', 'manager', 'technical', 'representative')
          )
      ),
      'active_representatives', (select count(*) from public.representatives where status = 'active'),
      'network_growth', (select count(*) from public.representatives where (created_at at time zone 'America/Sao_Paulo')::date between p_date_from and p_date_to),
      'kits', (select count(*) from public.kit_orders where (created_at at time zone 'America/Sao_Paulo')::date between p_date_from and p_date_to),
      'kits_cents', coalesce((select sum(total_in_cents) from public.kit_orders where status not in ('cancelled', 'refunded') and (created_at at time zone 'America/Sao_Paulo')::date between p_date_from and p_date_to), 0),
      'critical_stock', (select count(*) from public.inventory where available_quantity <= minimum_quantity),
      'commissions_cents', coalesce((select sum(commission_in_cents) from public.commission_entries where status not in ('reversed', 'cancelled') and (created_at at time zone 'America/Sao_Paulo')::date between p_date_from and p_date_to), 0),
      'qualified_representatives', (select count(*) from public.representative_qualifications where qualified and (evaluated_at at time zone 'America/Sao_Paulo')::date between p_date_from and p_date_to),
      'active_levels', (select count(*) from public.representative_levels where active),
      'active_campaigns', (select count(*) from public.creative_campaigns where status in ('scheduled', 'published') and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now())),
      'homepage_events', (select count(*) from public.marketing_events where (occurred_at at time zone 'America/Sao_Paulo')::date between p_date_from and p_date_to and (p_campaign_id is null or utm_campaign = (select slug from public.creative_campaigns where id = p_campaign_id)) and (p_product_id is null or product_id = p_product_id))
    ),
    'pending', jsonb_build_object(
      'applications', (select count(*) from public.representative_applications where status in ('submitted', 'under_review', 'documents_pending')),
      'creatives', (select count(*) from public.creative_assets where status = 'pending_review'),
      'campaigns', (select count(*) from public.promotion_campaigns where requires_manager_approval and approved_by is null),
      'closings', (select count(*) from public.commission_closings where status = 'pending_approval')
    ),
    'alerts', jsonb_build_object(
      'reconciliation_divergences', (select count(*) from public.payment_reconciliations where divergence_amount <> 0 and status <> 'resolved'),
      'failed_commission_payments', (select count(*) from public.commission_payments where status = 'failed'),
      'critical_stock', (select count(*) from public.inventory where available_quantity <= minimum_quantity),
      'refunds_in_period', refunds.refund_count
    )
  ) into result
  from current_totals totals
  cross join previous_totals previous
  cross join daily
  cross join completed_refunds refunds;

  return result;
end;
$$;

create or replace function public.manager_strategic_metrics(
  p_date_from date,
  p_date_to date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
  period_days integer;
  previous_from date;
  previous_to date;
begin
  perform private.require_permission('financial.read_summary');

  if p_date_from is null or p_date_to is null or p_date_to < p_date_from then
    raise exception 'invalid management period';
  end if;
  if p_date_to - p_date_from > 366 then
    raise exception 'management period exceeds one year';
  end if;

  period_days := p_date_to - p_date_from + 1;
  previous_to := p_date_from - 1;
  previous_from := previous_to - period_days + 1;

  with current_orders as materialized (
    select sale.*, (select coalesce(sum(refund.amount), 0) from public.payment_refunds refund
          join public.payments payment on payment.id = refund.payment_id
          where payment.order_id = sale.id and refund.status = 'completed') as completed_refund_amount
    from public.orders sale
    where sale.payment_status = 'approved'
      and sale.status not in ('draft','pending_payment','cancellation_requested','cancelled','refunded')
      and (coalesce(sale.placed_at, sale.created_at) at time zone 'America/Sao_Paulo')::date
        between p_date_from and p_date_to
  ), previous_orders as materialized (
    select sale.*, (select coalesce(sum(refund.amount), 0) from public.payment_refunds refund
          join public.payments payment on payment.id = refund.payment_id
          where payment.order_id = sale.id and refund.status = 'completed') as completed_refund_amount
    from public.orders sale
    where sale.payment_status = 'approved'
      and sale.status not in ('draft','pending_payment','cancellation_requested','cancelled','refunded')
      and (coalesce(sale.placed_at, sale.created_at) at time zone 'America/Sao_Paulo')::date
        between previous_from and previous_to
  ), current_totals as (
    select
      count(*)::bigint as orders,
      round(coalesce(sum(grand_total), 0) * 100)::bigint as gross_cents,
      round(coalesce(sum(grand_total - fee_total - shipping_cost - completed_refund_amount), 0) * 100)::bigint as net_cents,
      round(coalesce(sum(estimated_profit), 0) * 100)::bigint as profit_cents
    from current_orders
  ), previous_totals as (
    select
      count(*)::bigint as orders,
      round(coalesce(sum(grand_total), 0) * 100)::bigint as gross_cents,
      round(coalesce(sum(grand_total - fee_total - shipping_cost - completed_refund_amount), 0) * 100)::bigint as net_cents,
      round(coalesce(sum(estimated_profit), 0) * 100)::bigint as profit_cents
    from previous_orders
  )
  select jsonb_build_object(
    'period', jsonb_build_object(
      'from', p_date_from,
      'to', p_date_to,
      'previous_from', previous_from,
      'previous_to', previous_to
    ),
    'comparison', jsonb_build_object('current', to_jsonb(current_total), 'previous', to_jsonb(previous_total)),
    'series', coalesce((
      select jsonb_agg(to_jsonb(series_row) order by series_row.day)
      from (
        select
          (coalesce(placed_at, created_at) at time zone 'America/Sao_Paulo')::date as day,
          round(sum(grand_total) * 100)::bigint as gross_cents,
          round(sum(grand_total - fee_total - shipping_cost - completed_refund_amount) * 100)::bigint as net_cents,
          round(sum(estimated_profit) * 100)::bigint as profit_cents,
          count(*)::bigint as orders
        from current_orders
        group by 1
      ) series_row
    ), '[]'::jsonb),
    'products', coalesce((
      select jsonb_agg(to_jsonb(product_row) order by greatest(product_row.current_revenue_cents, product_row.previous_revenue_cents) desc)
      from (
        select
          item.product_id,
          max(item.product_name_snapshot) as name,
          round(coalesce(sum(item.total) filter (where (coalesce(sale.placed_at, sale.created_at) at time zone 'America/Sao_Paulo')::date between p_date_from and p_date_to), 0) * 100)::bigint as current_revenue_cents,
          round(coalesce(sum(item.total) filter (where (coalesce(sale.placed_at, sale.created_at) at time zone 'America/Sao_Paulo')::date between previous_from and previous_to), 0) * 100)::bigint as previous_revenue_cents,
          coalesce(sum(item.quantity) filter (where (coalesce(sale.placed_at, sale.created_at) at time zone 'America/Sao_Paulo')::date between p_date_from and p_date_to), 0)::bigint as current_units,
          coalesce(sum(item.quantity) filter (where (coalesce(sale.placed_at, sale.created_at) at time zone 'America/Sao_Paulo')::date between previous_from and previous_to), 0)::bigint as previous_units
        from public.order_items item
        join public.orders sale on sale.id = item.order_id
        where sale.payment_status = 'approved'
      and sale.status not in ('draft','pending_payment','cancellation_requested','cancelled','refunded')
          and (coalesce(sale.placed_at, sale.created_at) at time zone 'America/Sao_Paulo')::date
            between previous_from and p_date_to
        group by item.product_id
        order by greatest(
          coalesce(sum(item.total) filter (where (coalesce(sale.placed_at, sale.created_at) at time zone 'America/Sao_Paulo')::date between p_date_from and p_date_to), 0),
          coalesce(sum(item.total) filter (where (coalesce(sale.placed_at, sale.created_at) at time zone 'America/Sao_Paulo')::date between previous_from and previous_to), 0)
        ) desc
        limit 30
      ) product_row
    ), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(to_jsonb(category_row) order by category_row.current_revenue_cents desc)
      from (
        select
          category.id as category_id,
          category.name,
          round(coalesce(sum(item.total), 0) * 100)::bigint as current_revenue_cents,
          coalesce(sum(item.quantity), 0)::bigint as current_units
        from current_orders sale
        join public.order_items item on item.order_id = sale.id
        join public.products product on product.id = item.product_id
        join public.categories category on category.id = product.category_id
        group by category.id, category.name
        order by current_revenue_cents desc
        limit 12
      ) category_row
    ), '[]'::jsonb),
    'regions', coalesce((
      select jsonb_agg(to_jsonb(region_row) order by region_row.revenue_cents desc)
      from (
        select
          coalesce(nullif(trim(representative.region_code), ''), 'Não informada') as name,
          round(coalesce(sum(representative_sale.total_in_cents), 0))::bigint as revenue_cents,
          count(*)::bigint as sales
        from public.representative_sales representative_sale
        join public.representatives representative
          on representative.id = representative_sale.representative_id
        join public.orders sale on sale.id = representative_sale.order_id
        where representative_sale.status = 'confirmed'
          and sale.payment_status = 'approved'
          and sale.status not in ('draft','pending_payment','cancellation_requested','cancelled','refunded')
          and (coalesce(sale.placed_at, sale.created_at) at time zone 'America/Sao_Paulo')::date
            between p_date_from and p_date_to
        group by 1
        order by revenue_cents desc
        limit 12
      ) region_row
    ), '[]'::jsonb),
    'representatives', coalesce((
      select jsonb_agg(to_jsonb(representative_row) order by representative_row.revenue_cents desc)
      from (
        select
          representative.id as representative_id,
          profile.full_name as name,
          representative.public_code,
          round(coalesce(sum(representative_sale.total_in_cents), 0))::bigint as revenue_cents,
          count(*)::bigint as sales
        from public.representative_sales representative_sale
        join public.representatives representative
          on representative.id = representative_sale.representative_id
        join public.profiles profile on profile.id = representative.user_id
        join public.orders sale on sale.id = representative_sale.order_id
        where representative_sale.status = 'confirmed'
          and sale.payment_status = 'approved'
          and sale.status not in ('draft','pending_payment','cancellation_requested','cancelled','refunded')
          and (coalesce(sale.placed_at, sale.created_at) at time zone 'America/Sao_Paulo')::date
            between p_date_from and p_date_to
        group by representative.id, profile.full_name, representative.public_code
        order by revenue_cents desc
        limit 12
      ) representative_row
    ), '[]'::jsonb),
    'campaigns', coalesce((
      select jsonb_agg(to_jsonb(campaign_row) order by campaign_row.events desc)
      from (
        select
          campaign.id as campaign_id,
          campaign.name,
          campaign.status::text,
          count(event.id)::bigint as events
        from public.creative_campaigns campaign
        left join public.marketing_events event on event.utm_campaign = campaign.slug
          and (event.occurred_at at time zone 'America/Sao_Paulo')::date between p_date_from and p_date_to
        where campaign.status in ('scheduled', 'published') or event.id is not null
        group by campaign.id, campaign.name, campaign.status
        order by events desc
        limit 12
      ) campaign_row
    ), '[]'::jsonb),
    'goals', coalesce((
      select jsonb_agg(to_jsonb(goal_row) order by goal_row.period_end)
      from (
        select
          goal.id,
          goal.title,
          goal.period_start,
          goal.period_end,
          goal.target,
          coalesce(profile.full_name, level.name, 'Escopo gerencial') as scope
        from public.representative_goals goal
        left join public.representatives representative on representative.id = goal.representative_id
        left join public.profiles profile on profile.id = representative.user_id
        left join public.representative_levels level on level.id = goal.level_id
        where goal.active and goal.period_start <= p_date_to and goal.period_end >= p_date_from
        order by goal.period_end
        limit 12
      ) goal_row
    ), '[]'::jsonb)
  ) into result
  from current_totals current_total
  cross join previous_totals previous_total;

  return result;
end;
$$;
;

-- 20261030000426_fix_financial_payment_timezone.sql
-- Derive provider financial dates in the business time zone.
-- Automatic receivables reconcile from the order/payment, not manual edits.
create or replace function private.sync_mercadopago_financial_payment(
  p_payment_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment_row public.payments%rowtype;
  order_row public.orders%rowtype;
  settings public.financial_integration_settings%rowtype;
  receivable_row public.accounts_receivable%rowtype;
  fee_payable public.accounts_payable%rowtype;
  next_receivable_status text;
  settlement_date date;
  provider_method text;
begin
  select *
  into payment_row
  from public.payments
  where id = p_payment_id
    and provider = 'mercadopago'
  for update;

  if payment_row.id is null then
    return;
  end if;

  perform private.ensure_mercadopago_financial_settings(payment_row.id);

  select *
  into settings
  from public.financial_integration_settings
  where provider = 'mercadopago'
    and active;

  if settings.provider is null then
    return;
  end if;

  select *
  into order_row
  from public.orders
  where id = payment_row.order_id;

  if order_row.id is null then
    return;
  end if;

  provider_method :=
    nullif(
      regexp_replace(
        coalesce(payment_row.payment_method_summary,''),
        '^selected:',
        ''
      ),
      ''
    );

  settlement_date :=
    coalesce(
      (payment_row.paid_at at time zone 'America/Sao_Paulo')::date,
      (now() at time zone 'America/Sao_Paulo')::date
    );

  next_receivable_status :=
    case
      when payment_row.status in ('approved','refunded','charged_back')
        or payment_row.paid_at is not null
        then 'received'
      when payment_row.status in ('rejected','cancelled')
        then 'cancelled'
      else 'pending'
    end;

  insert into public.accounts_receivable(
    installment_batch_id,
    installment_number,
    installment_count,
    customer,
    description,
    category_id,
    issued_on,
    due_on,
    received_on,
    document_number,
    amount,
    destination_account_id,
    notes,
    status,
    created_by,
    updated_by,
    origin,
    order_id,
    payment_id,
    provider_payment_id,
    payment_method,
    gross_amount,
    provider_fee,
    net_amount,
    provider_installments,
    provider_status,
    received_at,
    refunded_amount
  )
  values (
    order_row.id,
    1,
    1,
    order_row.customer_name_snapshot,
    'Venda da loja online - Pedido ' || order_row.public_code,
    settings.revenue_category_id,
    (order_row.created_at at time zone 'America/Sao_Paulo')::date,
    coalesce(
      (payment_row.expires_at at time zone 'America/Sao_Paulo')::date,
      (order_row.created_at at time zone 'America/Sao_Paulo')::date
    ),
    case
      when next_receivable_status = 'received'
        then settlement_date
      else null
    end,
    order_row.public_code,
    payment_row.amount,
    settings.account_id,
    'Integração automática Mercado Pago',
    next_receivable_status,
    settings.updated_by,
    settings.updated_by,
    'online_store',
    order_row.id,
    payment_row.id,
    payment_row.provider_payment_id,
    provider_method,
    payment_row.amount,
    case
      when payment_row.provider_fee_confirmed
        then payment_row.provider_fee
      else null
    end,
    payment_row.net_received_amount,
    payment_row.installments,
    payment_row.status::text,
    case
      when next_receivable_status = 'received'
        then payment_row.paid_at
      else null
    end,
    coalesce(
      (
        select sum(r.amount)
        from public.payment_refunds r
        where r.payment_id = payment_row.id
          and r.status = 'completed'
      ),
      0
    )
  )
  on conflict (payment_id)
  where payment_id is not null
  do update set
    issued_on = excluded.issued_on,
    due_on = excluded.due_on,
    category_id = excluded.category_id,
    destination_account_id = excluded.destination_account_id,
    provider_payment_id = excluded.provider_payment_id,
    payment_method = excluded.payment_method,
    gross_amount = excluded.gross_amount,
    provider_fee = excluded.provider_fee,
    net_amount = excluded.net_amount,
    provider_installments = excluded.provider_installments,
    provider_status = excluded.provider_status,
    status = excluded.status,
    received_on = excluded.received_on,
    received_at = excluded.received_at,
    refunded_amount = excluded.refunded_amount,
    updated_by = settings.updated_by
  returning * into receivable_row;

  if next_receivable_status = 'received' then
    insert into public.financial_transactions(
      type,
      description,
      category_id,
      account_id,
      amount,
      occurred_on,
      origin,
      receivable_id,
      notes,
      created_by,
      updated_by
    )
    values (
      'income',
      receivable_row.description,
      settings.revenue_category_id,
      settings.account_id,
      payment_row.amount,
      settlement_date,
      'receivable',
      receivable_row.id,
      'Venda bruta Mercado Pago · Pedido ' || order_row.public_code,
      settings.updated_by,
      settings.updated_by
    )
    on conflict (receivable_id)
    where receivable_id is not null
    do update set
      category_id = excluded.category_id,
      account_id = excluded.account_id,
      amount = excluded.amount,
      occurred_on = excluded.occurred_on,
      description = excluded.description,
      notes = excluded.notes,
      updated_by = settings.updated_by,
      reversed_at = null,
      reversed_by = null;
  end if;

  if payment_row.provider_fee_confirmed
    and payment_row.provider_fee > 0
    and next_receivable_status = 'received'
  then
    insert into public.accounts_payable(
      installment_batch_id,
      installment_number,
      installment_count,
      supplier,
      description,
      category_id,
      issued_on,
      due_on,
      paid_on,
      document_number,
      amount,
      source_account_id,
      notes,
      status,
      created_by,
      updated_by,
      origin,
      payment_id,
      provider_reference
    )
    values (
      payment_row.id,
      1,
      1,
      'Mercado Pago',
      'Taxa Mercado Pago · Pedido ' || order_row.public_code,
      settings.fee_category_id,
      settlement_date,
      settlement_date,
      settlement_date,
      payment_row.provider_payment_id,
      payment_row.provider_fee,
      settings.account_id,
      'Taxa real informada pelo provedor',
      'paid',
      settings.updated_by,
      settings.updated_by,
      'mercadopago_fee',
      payment_row.id,
      payment_row.provider_payment_id
    )
    on conflict (payment_id)
    where origin = 'mercadopago_fee'
    do update set
      issued_on = excluded.issued_on,
      due_on = excluded.due_on,
      category_id = excluded.category_id,
      amount = excluded.amount,
      paid_on = excluded.paid_on,
      status = excluded.status,
      source_account_id = excluded.source_account_id,
      provider_reference = excluded.provider_reference,
      updated_by = settings.updated_by
    returning * into fee_payable;

    insert into public.financial_transactions(
      type,
      description,
      category_id,
      account_id,
      amount,
      occurred_on,
      origin,
      payable_id,
      notes,
      created_by,
      updated_by
    )
    values (
      'expense',
      fee_payable.description,
      settings.fee_category_id,
      settings.account_id,
      fee_payable.amount,
      settlement_date,
      'payable',
      fee_payable.id,
      'Taxa real Mercado Pago · Pagamento ' ||
        payment_row.provider_payment_id,
      settings.updated_by,
      settings.updated_by
    )
    on conflict (payable_id)
    where payable_id is not null
    do update set
      category_id = excluded.category_id,
      account_id = excluded.account_id,
      amount = excluded.amount,
      occurred_on = excluded.occurred_on,
      description = excluded.description,
      notes = excluded.notes,
      updated_by = settings.updated_by,
      reversed_at = null,
      reversed_by = null;

  elsif payment_row.provider_fee_confirmed
    and coalesce(payment_row.provider_fee,0) = 0
  then
    update public.accounts_payable
    set
      status = 'cancelled',
      paid_on = null,
      updated_by = settings.updated_by
    where payment_id = payment_row.id
      and origin = 'mercadopago_fee'
      and status = 'paid';

    update public.financial_transactions t
    set
      reversed_at = now(),
      reversed_by = settings.updated_by,
      updated_by = settings.updated_by,
      notes = concat_ws(
        E'\n',
        t.notes,
        'Taxa zerada pelo provedor'
      )
    from public.accounts_payable p
    where p.payment_id = payment_row.id
      and p.origin = 'mercadopago_fee'
      and t.payable_id = p.id
      and t.reversed_at is null;
  end if;
end;
$$;
;

-- 20261101190000_bling_invoice_order_resolution.sql
-- Resolve only existing, unambiguous links. No fiscal document is created.
create function public.read_bling_invoice_order(p_invoice_id bigint,p_order_code text default '')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; matches integer;
begin
  if p_invoice_id is null or p_invoice_id<=0 or length(coalesce(p_order_code,''))>120 then
    raise exception 'invalid_invoice_reference' using errcode='22023';
  end if;
  select count(*),jsonb_agg(jsonb_build_object('orderCode',o.public_code,
    'externalOrderId',l.external_order_id,'invoiceId',l.invoice_id))->0
  into matches,result
  from private.bling_order_links l join public.orders o on o.id=l.order_id
  where l.external_order_id is not null and
    (l.invoice_id=p_invoice_id or (nullif(p_order_code,'') is not null and o.public_code=p_order_code));
  if matches>1 then raise exception 'invoice_link_conflict' using errcode='23514'; end if;
  return result;
end;
$$;
revoke all on function public.read_bling_invoice_order(bigint,text) from public,anon,authenticated;
grant execute on function public.read_bling_invoice_order(bigint,text) to service_role;

-- Keep failed historical events for review. A retry must go through the same
-- signed-event reconciliation and exact mapping; no bulk retry is performed.
;

-- 20261101191000_bling_verified_documents_shipping.sql
-- Incremental: existing documents remain untouched and unverified until read.
alter table private.bling_invoice_archives
  add column verified_environment smallint check(verified_environment in(1,2)),
  add column verified_access_key text check(verified_access_key ~ '^[0-9]{44}$');

create function public.read_bling_invoice_archive_context(p_order_id uuid,p_invoice_id bigint)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('invoiceKey',l.invoice_access_key,'invoiceNumber',l.invoice_number,
    'series',r.series,'issuerDocument',regexp_replace(c.tax_id,'[^0-9]','','g'),
    'totalInCents',round(o.grand_total*100)::bigint)
  from private.bling_order_links l join public.orders o on o.id=l.order_id
  cross join private.bling_fiscal_rules r cross join public.company_legal_information c
  where l.order_id=p_order_id and l.invoice_id=p_invoice_id and l.invoice_status='authorized'
    and r.scenario='sale_in_state';
$$;
revoke all on function public.read_bling_invoice_archive_context(uuid,bigint) from public,anon,authenticated;
grant execute on function public.read_bling_invoice_archive_context(uuid,bigint) to service_role;

create function private.bling_invoice_documents_ready(p_order_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.bling_order_links l
    join private.bling_invoice_archives x on x.order_id=l.order_id and x.invoice_id=l.invoice_id and x.format='xml'
    join private.bling_invoice_archives p on p.order_id=l.order_id and p.invoice_id=l.invoice_id and p.format='pdf'
    where l.order_id=p_order_id and l.invoice_status='authorized' and l.erp_status='synced'
      and l.invoice_access_key ~ '^[0-9]{44}$' and x.verified_environment=1
      and x.verified_access_key=l.invoice_access_key);
$$;
revoke all on function private.bling_invoice_documents_ready(uuid) from public,anon,authenticated,service_role;

create function public.verify_bling_invoice_archive(p_order_id uuid,p_invoice_id bigint,p_access_key text,
  p_xml_sha256 text,p_environment integer)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if p_environment is null or p_environment not in(1,2) or p_access_key is null or p_access_key !~ '^[0-9]{44}$'
    or p_xml_sha256 is null or p_xml_sha256 !~ '^[a-f0-9]{64}$' then return false; end if;
  perform 1 from public.orders where id=p_order_id for update;
  perform 1 from private.bling_order_links where order_id=p_order_id and invoice_id=p_invoice_id
    and invoice_status='authorized' and invoice_access_key=p_access_key for update;
  if not found or not exists(select 1 from private.bling_invoice_archives
    where order_id=p_order_id and invoice_id=p_invoice_id and format='pdf') then return false; end if;
  update private.bling_invoice_archives set verified_environment=p_environment,verified_access_key=p_access_key
  where order_id=p_order_id and invoice_id=p_invoice_id and format='xml' and sha256=p_xml_sha256
    and (verified_environment is null or verified_environment=p_environment)
    and (verified_access_key is null or verified_access_key=p_access_key);
  if not found then return false; end if;
  if private.bling_invoice_documents_ready(p_order_id) then
    update public.shipments set operation_state='pending',last_error_code=null,updated_at=now()
      where order_id=p_order_id and operation_state='awaiting_invoice';
    update public.background_jobs j set status='pending',attempts=0,error_summary=null,available_at=now(),completed_at=null
      where j.queue='shipping' and j.status='failed' and j.error_summary='fiscal_shipping_blocked'
        and exists(select 1 from public.shipments s where s.id::text=j.payload_sanitized->>'shipmentId'
          and s.order_id=p_order_id and s.operation_state='pending');
  end if;
  return true;
end;
$$;
revoke all on function public.verify_bling_invoice_archive(uuid,bigint,text,text,integer) from public,anon,authenticated;
grant execute on function public.verify_bling_invoice_archive(uuid,bigint,text,text,integer) to service_role;

create or replace function public.read_bling_shipping_clearance(p_order_id uuid)
returns jsonb language sql security definer set search_path='' stable as $$
  select jsonb_build_object('required',policy.invoice_required,
    'allowed',not policy.invoice_required or private.bling_invoice_documents_ready(p_order_id),
    'accessKey',case when policy.invoice_required and private.bling_invoice_documents_ready(p_order_id)
      then link.invoice_access_key else null end)
  from private.bling_shipping_policy policy left join private.bling_order_links link on link.order_id=p_order_id
  where policy.singleton;
$$;

create or replace function private.guard_bling_shipment()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if (new.operation_state is distinct from old.operation_state and new.operation_state in('creating','purchasing','generating','generated'))
    or (new.status is distinct from old.status and new.status='dispatched') then
    if (select invoice_required from private.bling_shipping_policy where singleton) and
      (not private.bling_invoice_documents_ready(new.order_id) or not exists(select 1 from public.orders o
        where o.id=new.order_id and o.payment_status='approved'
          and o.status not in('cancelled','refunded','manual_review','cancellation_requested','refund_pending'))) then
      raise exception 'fiscal_shipping_blocked' using errcode='23514';
    end if;
  end if;
  return new;
end;
$$;

create or replace function private.guard_bling_order_dispatch()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status is distinct from old.status and (new.status='shipped' or new.status='delivered' and old.status<>'shipped')
    and (select invoice_required from private.bling_shipping_policy where singleton) then
    if not private.bling_invoice_documents_ready(new.id) or new.payment_status<>'approved'
      then raise exception 'fiscal_shipping_blocked' using errcode='23514'; end if;
  end if;
  return new;
end;
$$;

-- Never rewrite prior archives or infer production from APP_ENV/OAuth. tpAmb is
-- obtained by the server from the matching authorized XML, not from a browser.

-- Authorization queues archiving; only verified production archives release shipping.
create or replace function public.observe_bling_invoice_base(p_invoice_id bigint,p_order_code text,p_situation integer,
  p_invoice_number text,p_access_key text,p_observed_at timestamptz)
returns boolean language plpgsql security definer set search_path = '' as $$
declare mapped_status text; linked_order_id uuid; item record;
begin
  mapped_status := case p_situation when 1 then 'pending' when 2 then 'cancelled'
    when 3 then 'processing' when 4 then 'rejected' when 5 then 'authorized'
    when 6 then 'authorized' when 7 then 'processing' when 8 then 'processing'
    when 9 then 'rejected' when 10 then 'processing' when 11 then 'rejected' else 'error' end;
  update private.bling_order_links link set invoice_id=p_invoice_id,invoice_status=mapped_status,
    invoice_number=case when mapped_status='authorized' then nullif(p_invoice_number,'') else link.invoice_number end,
    invoice_access_key=case when mapped_status='authorized' then nullif(p_access_key,'') else link.invoice_access_key end,
    last_error_code=case when mapped_status='rejected' then 'fiscal_rejected_' || p_situation::text
      when mapped_status='cancelled' then 'fiscal_cancelled'
      when mapped_status='authorized' and link.last_error_code in('validation_error','invoice_processing','fiscal_not_ready','fiscal_automation_policy_required') then null
      else link.last_error_code end,
    external_observed_at=p_observed_at,updated_at=now()
  from public.orders o where o.id=link.order_id and o.public_code=p_order_code
    and link.external_order_id is not null
    and (link.invoice_id is null or link.invoice_id=p_invoice_id)
    and (link.external_observed_at is null or link.external_observed_at<=p_observed_at)
  returning link.order_id into linked_order_id;
  if linked_order_id is null then
    -- A later observation already won: acknowledge this event without overwriting it.
    return exists(select 1 from private.bling_order_links link join public.orders o on o.id=link.order_id
      where link.invoice_id=p_invoice_id and o.public_code=p_order_code and link.external_observed_at>p_observed_at);
  end if;
  if mapped_status='authorized' then
    insert into public.background_jobs(queue,job_type,payload_sanitized,idempotency_key)
    values('bling','bling.invoice.email',jsonb_build_object('orderId',linked_order_id),
      'bling:invoice-email:' || linked_order_id::text || ':' || p_invoice_id::text)
    on conflict(idempotency_key) do nothing;
    for item in select distinct variant_id from public.order_items where order_id=linked_order_id loop
      insert into public.background_jobs(queue,job_type,payload_sanitized,idempotency_key)
      values('bling','bling.stock.sync',jsonb_build_object('variantId',item.variant_id),
        'bling:stock:invoice:' || p_invoice_id::text || ':' || item.variant_id::text)
      on conflict(idempotency_key) do nothing;
    end loop;
  end if;
  return true;
end;
$$;
;

-- 20261103000309_exclude_test_sales_from_reporting.sql
-- Reporting excludes explicitly marked test orders without modifying accounting history.
-- Existing RPC permission and MFA checks remain unchanged.
create view public.reporting_orders with (security_invoker = true) as
select * from public.orders
where commercial_rules_snapshot->>'paymentMode' is distinct from 'test';

revoke all on public.reporting_orders from public, anon;
grant select on public.reporting_orders to authenticated, service_role;

create view private.reporting_accounts_receivable with (security_invoker = true) as
select r.* from public.accounts_receivable r
where not exists (
  select 1 from public.orders o
  where o.commercial_rules_snapshot->>'paymentMode' = 'test'
    and o.id = r.order_id
)
and not exists (
  select 1 from public.payments p join public.orders o on o.id = p.order_id
  where p.id = r.payment_id and o.commercial_rules_snapshot->>'paymentMode' = 'test'
);

create view private.reporting_accounts_payable with (security_invoker = true) as
select a.* from public.accounts_payable a
where not exists (
  select 1 from public.payments p join public.orders o on o.id = p.order_id
  where p.id = a.payment_id and o.commercial_rules_snapshot->>'paymentMode' = 'test'
);

create view private.reporting_financial_transactions with (security_invoker = true) as
select t.* from public.financial_transactions t
where (t.receivable_id is null or exists (
  select 1 from private.reporting_accounts_receivable r where r.id = t.receivable_id
)) and (t.payable_id is null or exists (
  select 1 from private.reporting_accounts_payable a where a.id = t.payable_id
));

revoke all on private.reporting_accounts_receivable,
  private.reporting_accounts_payable, private.reporting_financial_transactions
  from public, anon, authenticated;


-- Preserve the original calculation, authorization and public signature.
CREATE OR REPLACE FUNCTION public.admin_approved_sales_total_in_cents()
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  total_in_cents bigint;
begin
  perform private.require_permission('orders.read_all');

  select coalesce(sum(round(grand_total * 100)), 0)::bigint
  into total_in_cents
  from public.reporting_orders
  where payment_status = 'approved';

  return total_in_cents;
end;
$function$;


-- Preserve the original calculation, authorization and public signature.
CREATE OR REPLACE FUNCTION public.financial_control_snapshot(p_date_from date, p_date_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  base jsonb;
  additions jsonb;
  corrected_summary jsonb;
begin
  perform private.require_permission('financial.read_full');

  if p_date_from is null
    or p_date_to is null
    or p_date_to < p_date_from
    or p_date_to - p_date_from > 366
  then
    raise exception 'invalid financial period';
  end if;

  base :=
    public.financial_control_snapshot_categories_v2(
      p_date_from,
      p_date_to
    );

  corrected_summary :=
    (base->'summary')
    ||
    jsonb_build_object(
      'income',
      coalesce(
        (
          select sum(amount)
          from private.reporting_financial_transactions
          where reversed_at is null
            and affects_result
            and type = 'income'
            and occurred_on between p_date_from and p_date_to
        ),
        0
      ),
      'expense',
      coalesce(
        (
          select sum(amount)
          from private.reporting_financial_transactions
          where reversed_at is null
            and affects_result
            and type = 'expense'
            and occurred_on between p_date_from and p_date_to
        ),
        0
      ),
      'month_income',
      coalesce(
        (
          select sum(amount)
          from private.reporting_financial_transactions
          where reversed_at is null
            and affects_result
            and type = 'income'
            and occurred_on between
              date_trunc(
                'month',
                now() at time zone 'America/Sao_Paulo'
              )::date
              and
              (now() at time zone 'America/Sao_Paulo')::date
        ),
        0
      ),
      'month_expense',
      coalesce(
        (
          select sum(amount)
          from private.reporting_financial_transactions
          where reversed_at is null
            and affects_result
            and type = 'expense'
            and occurred_on between
              date_trunc(
                'month',
                now() at time zone 'America/Sao_Paulo'
              )::date
              and
              (now() at time zone 'America/Sao_Paulo')::date
        ),
        0
      )
    );

  with date_series as (
    select
      gs.day_value::date as occurred_day
    from generate_series(
      p_date_from::timestamp,
      p_date_to::timestamp,
      interval '1 day'
    ) as gs(day_value)
  ),
  daily as (
    select
      occurred_on as occurred_day,
      sum(amount)
        filter (
          where type = 'income'
            and affects_result
        ) as income,
      sum(amount)
        filter (
          where type = 'expense'
            and affects_result
        ) as expense,
      sum(
        case
          when type = 'income'
            then amount
          else -amount
        end
      ) as balance_delta
    from private.reporting_financial_transactions
    where reversed_at is null
      and occurred_on between p_date_from and p_date_to
    group by occurred_on
  ),
  balance_before as (
    select
      coalesce(
        (
          select sum(initial_balance)
          from public.financial_accounts
        ),
        0
      )
      +
      coalesce(
        sum(
          case
            when type = 'income'
              then amount
            else -amount
          end
        ),
        0
      ) as amount
    from private.reporting_financial_transactions
    where reversed_at is null
      and occurred_on < p_date_from
  ),
  series as (
    select
      d.occurred_day,
      coalesce(x.income,0) as income,
      coalesce(x.expense,0) as expense,
      (
        select amount
        from balance_before
      )
      +
      sum(
        coalesce(x.balance_delta,0)
      ) over (
        order by d.occurred_day
      ) as balance
    from date_series d
    left join daily x
      on x.occurred_day = d.occurred_day
  ),
  online as (
    select
      coalesce(
        sum(r.gross_amount)
          filter (
            where r.status = 'received'
              and r.received_on between p_date_from and p_date_to
          ),
        0
      ) as gross,
      coalesce(
        (
          select sum(p.amount)
          from private.reporting_accounts_payable p
          where p.origin = 'mercadopago_fee'
            and p.status = 'paid'
            and p.paid_on between p_date_from and p_date_to
        ),
        0
      ) as fees,
      coalesce(
        (
          select sum(p.amount)
          from private.reporting_accounts_payable p
          where p.origin = 'mercadopago_refund'
            and p.status = 'paid'
            and p.paid_on between p_date_from and p_date_to
        ),
        0
      ) as refunds,
      coalesce(
        sum(r.amount)
          filter (
            where r.status = 'pending'
              and r.due_on between p_date_from and p_date_to
          ),
        0
      ) as pending,
      count(*)
        filter (
          where r.status = 'received'
            and r.received_on between p_date_from and p_date_to
        ) as sales_count
    from private.reporting_accounts_receivable r
    where r.origin = 'online_store'
  ),
  methods as (
    select
      coalesce(
        nullif(payment_method,''),
        'Não informado'
      ) as name,
      coalesce(
        sum(gross_amount)
          filter (
            where status = 'received'
              and received_on between p_date_from and p_date_to
          ),
        0
      ) as value
    from private.reporting_accounts_receivable
    where origin = 'online_store'
    group by
      coalesce(
        nullif(payment_method,''),
        'Não informado'
      )
    having coalesce(
      sum(gross_amount)
        filter (
          where status = 'received'
            and received_on between p_date_from and p_date_to
        ),
      0
    ) > 0
  )
  select jsonb_build_object(
    'summary',
    corrected_summary,

    'series',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'date',
            occurred_day,
            'income',
            income,
            'expense',
            expense,
            'balance',
            balance
          )
          order by occurred_day
        )
        from series
      ),
      '[]'::jsonb
    ),

    'integration_settings',
    coalesce(
      (
        select jsonb_agg(
          to_jsonb(s)
          ||
          jsonb_build_object(
            'account_name',
            a.name,
            'revenue_category_name',
            rc.name,
            'fee_category_name',
            fc.name,
            'refund_category_name',
            rfc.name
          )
        )
        from public.financial_integration_settings s
        join public.financial_accounts a
          on a.id = s.account_id
        join public.financial_categories rc
          on rc.id = s.revenue_category_id
        join public.financial_categories fc
          on fc.id = s.fee_category_id
        join public.financial_categories rfc
          on rfc.id = s.refund_category_id
      ),
      '[]'::jsonb
    ),

    'accounts',
    coalesce(
      (
        select jsonb_agg(
          to_jsonb(a)
          ||
          jsonb_build_object(
            'current_balance',
            a.initial_balance
            +
            coalesce(
              (
                select sum(
                  case
                    when t.type = 'income' then t.amount
                    else -t.amount
                  end
                )
                from private.reporting_financial_transactions t
                where t.account_id = a.id
                  and t.reversed_at is null
              ),
              0
            )
          )
          order by a.name
        )
        from public.financial_accounts a
      ),
      '[]'::jsonb
    ),

    'online_sales_summary',
    (
      select jsonb_build_object(
        'gross',
        gross,
        'fees',
        fees,
        'refunds',
        refunds,
        'net',
        gross - fees - refunds,
        'pending',
        pending,
        'sales_count',
        sales_count
      )
      from online
    ),

    'online_sales_by_method',
    coalesce(
      (
        select jsonb_agg(
          row_to_json(m)
          order by m.value desc
        )
        from methods m
      ),
      '[]'::jsonb
    ),

    'transfers',
    coalesce(
      (
        select jsonb_agg(
          to_jsonb(t)
          ||
          jsonb_build_object(
            'source_account_name',
            sa.name,
            'destination_account_name',
            da.name,
            'responsible_name',
            p.full_name
          )
          order by
            t.occurred_on desc,
            t.created_at desc
        )
        from public.financial_transfers t
        join public.financial_accounts sa
          on sa.id = t.source_account_id
        join public.financial_accounts da
          on da.id = t.destination_account_id
        left join public.profiles p
          on p.id = t.created_by
        where t.occurred_on between p_date_from and p_date_to
      ),
      '[]'::jsonb
    ),

    'receivables',
    coalesce(
      (
        select jsonb_agg(
          item
          ||
          jsonb_build_object(
            'order_code',
            o.public_code,
            'mercadopago_payment_id',
            p.provider_payment_id,
            'provider_fee',
            p.provider_fee,
            'net_received_amount',
            p.net_received_amount,
            'payment_installments',
            p.installments
          )
        )
        from jsonb_array_elements(
          coalesce(base->'receivables','[]'::jsonb)
        ) as item
        left join private.reporting_accounts_receivable r
          on r.id = (item->>'id')::uuid
        left join public.reporting_orders o
          on o.id = r.order_id
        left join public.payments p
          on p.id = r.payment_id
      ),
      '[]'::jsonb
    )
  )
  into additions;

  return base || additions;
end;
$function$;


-- Preserve the original calculation, authorization and public signature.
CREATE OR REPLACE FUNCTION public.financial_control_snapshot_categories_v2(p_date_from date, p_date_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  base jsonb;
  hierarchy jsonb;
begin
  perform private.require_permission('financial.read_full');
  if p_date_from is null or p_date_to is null or p_date_to < p_date_from or p_date_to - p_date_from > 366 then
    raise exception 'invalid financial period';
  end if;
  base := public.financial_control_snapshot_flat_v1(p_date_from, p_date_to);

  with category_rows as materialized (
    select
      c.id as category_id, c.code as category_code, c.name as category_name,
      c.parent_id as group_id, coalesce(g.code, '') as group_code,
      coalesce(g.name, 'Sem conta totalizadora') as group_name,
      coalesce(g.name, c.name) as effective_group_name,
      c.kind, c.active, c.sort_order,
      coalesce(tx.expense_realized, 0) as expense_realized,
      coalesce(tx.income_realized, 0) as income_realized,
      coalesce(ap.projected, 0) as expense_projected,
      coalesce(ap.overdue, 0) as expense_overdue,
      coalesce(ar.projected, 0) as income_projected,
      coalesce(ar.overdue, 0) as income_overdue
    from public.financial_categories c
    left join public.financial_categories g on g.id = c.parent_id
    left join (
      select category_id,
        sum(amount) filter (where type = 'expense') as expense_realized,
        sum(amount) filter (where type = 'income') as income_realized
      from private.reporting_financial_transactions
      where reversed_at is null and occurred_on between p_date_from and p_date_to
      group by category_id
    ) tx on tx.category_id = c.id
    left join (
      select category_id, sum(amount) as projected,
        sum(amount) filter (where due_on < (now() at time zone 'America/Sao_Paulo')::date) as overdue
      from private.reporting_accounts_payable
      where status = 'pending' and due_on between p_date_from and p_date_to
      group by category_id
    ) ap on ap.category_id = c.id
    left join (
      select category_id, sum(amount) as projected,
        sum(amount) filter (where due_on < (now() at time zone 'America/Sao_Paulo')::date) as overdue
      from private.reporting_accounts_receivable
      where status = 'pending' and due_on between p_date_from and p_date_to
      group by category_id
    ) ar on ar.category_id = c.id
    where not c.is_group
  ), expense_groups as (
    select effective_group_name as name, sum(expense_realized + expense_projected) as value
    from category_rows where kind in ('expense', 'both')
    group by effective_group_name
  ), income_groups as (
    select effective_group_name as name, sum(income_realized + income_projected) as value
    from category_rows where kind in ('income', 'both')
    group by effective_group_name
  )
  select jsonb_build_object(
    'categories', coalesce((select jsonb_agg(
      to_jsonb(c) || jsonb_build_object(
        'parent_name', g.name,
        'category_path', case when g.id is null then c.name else g.name || ' > ' || c.name end
      ) order by coalesce(c.code, ''), c.sort_order, c.name
    ) from public.financial_categories c left join public.financial_categories g on g.id = c.parent_id), '[]'::jsonb),
    'receivables', coalesce((select jsonb_agg(to_jsonb(r) || jsonb_build_object(
      'display_status', case when r.status='pending' and r.due_on < (now() at time zone 'America/Sao_Paulo')::date then 'overdue' else r.status end,
      'category_name', case when g.id is null then c.name else g.name || ' > ' || c.name end,
      'category_code', c.code, 'group_id', g.id, 'group_name', g.name, 'subcategory_name', c.name,
      'account_name', a.name, 'responsible_name', pr.full_name
    ) order by r.due_on desc) from private.reporting_accounts_receivable r
      join public.financial_categories c on c.id=r.category_id
      left join public.financial_categories g on g.id=c.parent_id
      left join public.financial_accounts a on a.id=r.destination_account_id
      left join public.profiles pr on pr.id=r.created_by), '[]'::jsonb),
    'payables', coalesce((select jsonb_agg(to_jsonb(p) || jsonb_build_object(
      'display_status', case when p.status='pending' and p.due_on < (now() at time zone 'America/Sao_Paulo')::date then 'overdue' else p.status end,
      'category_name', case when g.id is null then c.name else g.name || ' > ' || c.name end,
      'category_code', c.code, 'group_id', g.id, 'group_name', g.name, 'subcategory_name', c.name,
      'account_name', a.name, 'responsible_name', pr.full_name
    ) order by p.due_on desc) from private.reporting_accounts_payable p
      join public.financial_categories c on c.id=p.category_id
      left join public.financial_categories g on g.id=c.parent_id
      left join public.financial_accounts a on a.id=p.source_account_id
      left join public.profiles pr on pr.id=p.created_by), '[]'::jsonb),
    'transactions', coalesce((select jsonb_agg(to_jsonb(t) || jsonb_build_object(
      'category_name', case when g.id is null then c.name else g.name || ' > ' || c.name end,
      'category_code', c.code, 'group_id', g.id, 'group_name', g.name, 'subcategory_name', c.name,
      'account_name', a.name, 'responsible_name', pr.full_name
    ) order by t.occurred_on desc,t.created_at desc) from private.reporting_financial_transactions t
      left join public.financial_categories c on c.id=t.category_id
      left join public.financial_categories g on g.id=c.parent_id
      join public.financial_accounts a on a.id=t.account_id
      left join public.profiles pr on pr.id=t.created_by
      where t.occurred_on between p_date_from and p_date_to), '[]'::jsonb),
    'expense_category_report', coalesce((select jsonb_agg(jsonb_build_object(
      'category_id', category_id, 'category_code', coalesce(category_code, ''),
      'category_name', category_name, 'group_id', group_id, 'group_code', group_code,
      'group_name', group_name, 'realized', expense_realized,
      'projected', expense_projected, 'overdue', expense_overdue,
      'total', expense_realized + expense_projected
    ) order by group_code, group_name, category_code, sort_order, category_name)
      from category_rows where kind in ('expense','both')), '[]'::jsonb),
    'income_category_report', coalesce((select jsonb_agg(jsonb_build_object(
      'category_id', category_id, 'category_code', coalesce(category_code, ''),
      'category_name', category_name, 'group_id', group_id, 'group_code', group_code,
      'group_name', group_name, 'realized', income_realized,
      'projected', income_projected, 'overdue', income_overdue,
      'total', income_realized + income_projected
    ) order by group_code, group_name, category_code, sort_order, category_name)
      from category_rows where kind in ('income','both')), '[]'::jsonb),
    'expense_by_group', coalesce((select jsonb_agg(row_to_json(x) order by x.value desc) from expense_groups x), '[]'::jsonb),
    'income_by_group', coalesce((select jsonb_agg(row_to_json(x) order by x.value desc) from income_groups x), '[]'::jsonb)
  ) into hierarchy;

  return base || hierarchy;
end;
$function$;


-- Preserve the original calculation, authorization and public signature.
CREATE OR REPLACE FUNCTION public.financial_control_snapshot_flat_v1(p_date_from date, p_date_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  result jsonb;
begin
  perform private.require_permission('financial.read_full');
  if p_date_from is null or p_date_to is null or p_date_to < p_date_from or p_date_to - p_date_from > 366 then
    raise exception 'invalid financial period';
  end if;

  with active_transactions as materialized (
    select * from private.reporting_financial_transactions where reversed_at is null
  ), period_transactions as materialized (
    select * from active_transactions where occurred_on between p_date_from and p_date_to
  ), daily as (
    select occurred_on as day,
      sum(amount) filter (where type = 'income') as income,
      sum(amount) filter (where type = 'expense') as expense
    from period_transactions group by occurred_on
  ), date_series as (
    select day::date from generate_series(p_date_from, p_date_to, interval '1 day') day
  ), balance_before as (
    select coalesce((select sum(initial_balance) from public.financial_accounts), 0)
      + coalesce(sum(case when type = 'income' then amount else -amount end) filter (where occurred_on < p_date_from), 0) as amount
    from active_transactions
  ), series as (
    select d.day,
      coalesce(x.income, 0) as income,
      coalesce(x.expense, 0) as expense,
      (select amount from balance_before) + sum(coalesce(x.income, 0) - coalesce(x.expense, 0)) over(order by d.day) as balance
    from date_series d left join daily x on x.day = d.day
  ), contribution_groups as (
    select g.id, g.name, g.expected_percentage,
      coalesce((select sum(c.amount) from public.partner_contributions c
        where c.contributed_on between p_date_from and p_date_to
          and (c.group_id = g.id or c.partner_id in (select fp.id from public.financial_partners fp where fp.group_id = g.id))), 0) as realized
    from public.financial_partner_groups g
    where g.active group by g.id
  ), contribution_total as (
    select coalesce(sum(realized), 0) as total from contribution_groups
  )
  select jsonb_build_object(
    'summary', jsonb_build_object(
      'balance', coalesce((select sum(initial_balance) from public.financial_accounts), 0)
        + coalesce((select sum(case when type='income' then amount else -amount end) from active_transactions), 0),
      'income', coalesce((select sum(amount) from period_transactions where type='income'), 0),
      'expense', coalesce((select sum(amount) from period_transactions where type='expense'), 0),
      'receivable', coalesce((select sum(amount) from private.reporting_accounts_receivable where status='pending'), 0),
      'payable', coalesce((select sum(amount) from private.reporting_accounts_payable where status='pending'), 0),
      'overdue_receivable', coalesce((select sum(amount) from private.reporting_accounts_receivable where status='pending' and due_on < (now() at time zone 'America/Sao_Paulo')::date), 0),
      'overdue_payable', coalesce((select sum(amount) from private.reporting_accounts_payable where status='pending' and due_on < (now() at time zone 'America/Sao_Paulo')::date), 0),
      'month_income', coalesce((select sum(amount) from active_transactions where type='income' and occurred_on between date_trunc('month', now() at time zone 'America/Sao_Paulo')::date and (now() at time zone 'America/Sao_Paulo')::date), 0),
      'month_expense', coalesce((select sum(amount) from active_transactions where type='expense' and occurred_on between date_trunc('month', now() at time zone 'America/Sao_Paulo')::date and (now() at time zone 'America/Sao_Paulo')::date), 0),
      'projected_balance', coalesce((select sum(initial_balance) from public.financial_accounts), 0)
        + coalesce((select sum(case when type='income' then amount else -amount end) from active_transactions), 0)
        + coalesce((select sum(amount) from private.reporting_accounts_receivable where status='pending'), 0)
        - coalesce((select sum(amount) from private.reporting_accounts_payable where status='pending'), 0)
    ),
    'series', coalesce((select jsonb_agg(jsonb_build_object('date',day,'income',income,'expense',expense,'balance',balance) order by day) from series), '[]'::jsonb),
    'payable_by_category', coalesce((select jsonb_agg(row_to_json(x) order by x.value desc) from (
      select c.name, sum(a.amount) as value from private.reporting_accounts_payable a join public.financial_categories c on c.id=a.category_id where a.status='pending' and a.due_on between p_date_from and p_date_to group by c.name
    ) x), '[]'::jsonb),
    'receivable_by_category', coalesce((select jsonb_agg(row_to_json(x) order by x.value desc) from (
      select c.name, sum(a.amount) as value from private.reporting_accounts_receivable a join public.financial_categories c on c.id=a.category_id where a.status='pending' and a.due_on between p_date_from and p_date_to group by c.name
    ) x), '[]'::jsonb),
    'largest_expenses', coalesce((select jsonb_agg(row_to_json(x) order by x.value desc) from (
      select description as name, amount as value from period_transactions where type='expense' order by amount desc limit 8
    ) x), '[]'::jsonb),
    'largest_receivables', coalesce((select jsonb_agg(row_to_json(x) order by x.value desc) from (
      select customer as name, sum(amount) as value from private.reporting_accounts_receivable where status='pending' and due_on between p_date_from and p_date_to group by customer order by value desc limit 8
    ) x), '[]'::jsonb),
    'account_status', jsonb_build_array(
      jsonb_build_object('name','Realizadas','value',(select count(*) from private.reporting_accounts_receivable where status='received' and due_on between p_date_from and p_date_to)+(select count(*) from private.reporting_accounts_payable where status='paid' and due_on between p_date_from and p_date_to)),
      jsonb_build_object('name','Pendentes','value',(select count(*) from private.reporting_accounts_receivable where status='pending' and due_on between greatest(p_date_from,(now() at time zone 'America/Sao_Paulo')::date) and p_date_to)+(select count(*) from private.reporting_accounts_payable where status='pending' and due_on between greatest(p_date_from,(now() at time zone 'America/Sao_Paulo')::date) and p_date_to)),
      jsonb_build_object('name','Vencidas','value',(select count(*) from private.reporting_accounts_receivable where status='pending' and due_on between p_date_from and least(p_date_to,(now() at time zone 'America/Sao_Paulo')::date-1))+(select count(*) from private.reporting_accounts_payable where status='pending' and due_on between p_date_from and least(p_date_to,(now() at time zone 'America/Sao_Paulo')::date-1)))
    ),
    'contribution_groups', coalesce((select jsonb_agg(jsonb_build_object(
      'id',id,'name',name,'expected_percentage',expected_percentage,'realized',realized,
      'ideal',(select total from contribution_total)*expected_percentage/100,
      'difference',realized-((select total from contribution_total)*expected_percentage/100)
    ) order by name) from contribution_groups), '[]'::jsonb),
    'contribution_partners', coalesce((select jsonb_agg(row_to_json(x) order by x.realized desc,x.name) from (
      select p.id,p.name,g.name as group_name,coalesce(sum(c.amount) filter (where c.contributed_on between p_date_from and p_date_to),0) as realized
      from public.financial_partners p join public.financial_partner_groups g on g.id=p.group_id
      left join public.partner_contributions c on c.partner_id=p.id
      where p.active group by p.id,g.name
    ) x), '[]'::jsonb),
    'accounts', coalesce((select jsonb_agg(to_jsonb(a) order by a.name) from public.financial_accounts a), '[]'::jsonb),
    'categories', coalesce((select jsonb_agg(to_jsonb(c) order by c.name) from public.financial_categories c), '[]'::jsonb),
    'partner_groups', coalesce((select jsonb_agg(to_jsonb(g) order by g.name) from public.financial_partner_groups g), '[]'::jsonb),
    'partners', coalesce((select jsonb_agg(to_jsonb(p) order by p.name) from public.financial_partners p), '[]'::jsonb),
    'receivables', coalesce((select jsonb_agg(to_jsonb(r) || jsonb_build_object('display_status',case when r.status='pending' and r.due_on < (now() at time zone 'America/Sao_Paulo')::date then 'overdue' else r.status end,'category_name',c.name,'account_name',a.name) order by r.due_on desc) from private.reporting_accounts_receivable r join public.financial_categories c on c.id=r.category_id left join public.financial_accounts a on a.id=r.destination_account_id), '[]'::jsonb),
    'payables', coalesce((select jsonb_agg(to_jsonb(p) || jsonb_build_object('display_status',case when p.status='pending' and p.due_on < (now() at time zone 'America/Sao_Paulo')::date then 'overdue' else p.status end,'category_name',c.name,'account_name',a.name) order by p.due_on desc) from private.reporting_accounts_payable p join public.financial_categories c on c.id=p.category_id left join public.financial_accounts a on a.id=p.source_account_id), '[]'::jsonb),
    'transactions', coalesce((select jsonb_agg(to_jsonb(t) || jsonb_build_object('category_name',c.name,'account_name',a.name,'responsible_name',pr.full_name) order by t.occurred_on desc,t.created_at desc) from private.reporting_financial_transactions t left join public.financial_categories c on c.id=t.category_id join public.financial_accounts a on a.id=t.account_id left join public.profiles pr on pr.id=t.created_by where t.occurred_on between p_date_from and p_date_to), '[]'::jsonb),
    'contributions', coalesce((select jsonb_agg(to_jsonb(c) || jsonb_build_object('partner_name',p.name,'group_name',coalesce(g.name,pg.name),'account_name',a.name) order by c.contributed_on desc) from public.partner_contributions c left join public.financial_partners p on p.id=c.partner_id left join public.financial_partner_groups pg on pg.id=p.group_id left join public.financial_partner_groups g on g.id=c.group_id join public.financial_accounts a on a.id=c.account_id), '[]'::jsonb),
    'audit', coalesce((select jsonb_agg(to_jsonb(l) || jsonb_build_object('actor_name',p.full_name) order by l.created_at desc) from (select * from public.audit_logs where entity_type like 'financial.%' order by created_at desc limit 200) l left join public.profiles p on p.id=l.actor_id), '[]'::jsonb)
  ) into result;
  return result;
end;
$function$;


-- Preserve the original calculation, authorization and public signature.
CREATE OR REPLACE FUNCTION public.manager_dashboard_metrics(p_date_from date, p_date_to date, p_region text DEFAULT NULL::text, p_product_id uuid DEFAULT NULL::uuid, p_category_id uuid DEFAULT NULL::uuid, p_model_id uuid DEFAULT NULL::uuid, p_representative_id uuid DEFAULT NULL::uuid, p_level_id uuid DEFAULT NULL::uuid, p_campaign_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  result jsonb;
  period_days integer;
  previous_from date;
  previous_to date;
begin
  perform private.require_permission('financial.read_summary');

  if p_date_from is null or p_date_to is null or p_date_to < p_date_from then
    raise exception 'invalid management period';
  end if;
  if p_date_to - p_date_from > 366 then
    raise exception 'management period exceeds one year';
  end if;

  period_days := p_date_to - p_date_from + 1;
  previous_to := p_date_from - 1;
  previous_from := previous_to - period_days + 1;

  with scoped_orders as materialized (
    select sale.*
    from public.reporting_orders sale
    where (
        p_product_id is null and p_category_id is null and p_model_id is null
        or exists (
          select 1
          from public.order_items item
          join public.products product on product.id = item.product_id
          where item.order_id = sale.id
            and (p_product_id is null or product.id = p_product_id)
            and (p_category_id is null or product.category_id = p_category_id)
            and (p_model_id is null or product.model_id = p_model_id)
        )
      )
      and (
        p_region is null and p_representative_id is null and p_level_id is null
        or exists (
          select 1
          from public.representative_sales representative_sale
          join public.representatives representative
            on representative.id = representative_sale.representative_id
          where representative_sale.order_id = sale.id
            and (p_region is null or representative.region_code = p_region)
            and (p_representative_id is null or representative.id = p_representative_id)
            and (p_level_id is null or representative.current_level_id = p_level_id)
        )
      )
      and (
        p_campaign_id is null
        or exists (
          select 1
          from public.marketing_events event
          join public.creative_campaigns campaign
            on campaign.id = p_campaign_id and campaign.slug = event.utm_campaign
          where event.order_id = sale.id
        )
      )
  ), filtered_orders as materialized (
    select * from scoped_orders
    where payment_status = 'approved'
      and status not in ('draft','pending_payment','cancellation_requested','cancelled','refunded')
      and (coalesce(placed_at, created_at) at time zone 'America/Sao_Paulo')::date
        between p_date_from and p_date_to
  ), previous_orders as materialized (
    select * from scoped_orders
    where payment_status = 'approved'
      and status not in ('draft','pending_payment','cancellation_requested','cancelled','refunded')
      and (coalesce(placed_at, created_at) at time zone 'America/Sao_Paulo')::date
        between previous_from and previous_to
  ), completed_refunds as (
    select coalesce(sum(refund.amount), 0) as amount, count(*)::bigint as refund_count
    from public.payment_refunds refund
    join public.payments payment on payment.id = refund.payment_id
    join scoped_orders sale on sale.id = payment.order_id
    where refund.status = 'completed'
      and sale.payment_status = 'approved'
      and sale.status not in ('draft','pending_payment','cancellation_requested','cancelled','refunded')
      and (refund.completed_at at time zone 'America/Sao_Paulo')::date
        between p_date_from and p_date_to
  ), current_totals as (
    select
      count(*)::bigint as order_count,
      round(coalesce(sum(grand_total), 0) * 100)::bigint as gross_cents,
      round(coalesce(sum(grand_total - fee_total - shipping_cost), 0) * 100)::bigint as net_before_refunds_cents,
      round(coalesce(sum(estimated_profit), 0) * 100)::bigint as estimated_profit_cents,
      round(coalesce(avg(grand_total), 0) * 100)::bigint as average_ticket_cents
    from filtered_orders
  ), previous_totals as (
    select round(coalesce(sum(grand_total), 0) * 100)::bigint as gross_cents
    from previous_orders
  ), daily_sales as (
    select (coalesce(placed_at, created_at) at time zone 'America/Sao_Paulo')::date as day,
      round(sum(grand_total) * 100)::bigint as gross_cents,
      round(sum(grand_total - fee_total - shipping_cost) * 100)::bigint as net_cents,
      count(*)::bigint as order_count
    from filtered_orders group by 1
  ), daily_refunds as (
    select (refund.completed_at at time zone 'America/Sao_Paulo')::date as day,
      round(sum(refund.amount) * 100)::bigint as refund_cents
    from public.payment_refunds refund
    join public.payments payment on payment.id = refund.payment_id
    join scoped_orders sale on sale.id = payment.order_id
    where refund.status = 'completed' and sale.payment_status = 'approved'
      and sale.status not in ('draft','pending_payment','cancellation_requested','cancelled','refunded')
      and (refund.completed_at at time zone 'America/Sao_Paulo')::date between p_date_from and p_date_to
    group by 1
  ), daily as (
    select jsonb_agg(jsonb_build_object(
      'day', coalesce(sale.day, refund.day),
      'gross_cents', coalesce(sale.gross_cents, 0),
      'net_cents', coalesce(sale.net_cents, 0) - coalesce(refund.refund_cents, 0),
      'orders', coalesce(sale.order_count, 0)
    ) order by coalesce(sale.day, refund.day)) as series
    from daily_sales sale full join daily_refunds refund on refund.day = sale.day
  )
  select jsonb_build_object(
    'period', jsonb_build_object('from', p_date_from, 'to', p_date_to),
    'gross_cents', totals.gross_cents,
    'net_cents', totals.net_before_refunds_cents - round(refunds.amount * 100)::bigint,
    'estimated_profit_cents', totals.estimated_profit_cents,
    'refunds_cents', round(refunds.amount * 100)::bigint,
    'average_ticket_cents', totals.average_ticket_cents,
    'orders', totals.order_count,
    'gross_change_percent', case
      when previous.gross_cents = 0 then null
      else round(((totals.gross_cents - previous.gross_cents)::numeric / previous.gross_cents) * 100, 1)
    end,
    'series', coalesce(daily.series, '[]'::jsonb),
    'overview', jsonb_build_object(
      'customers', (
        select count(*) from public.profiles profile
        where (profile.created_at at time zone 'America/Sao_Paulo')::date between p_date_from and p_date_to
          and not exists (
            select 1 from public.user_roles role
            where role.user_id = profile.id
              and role.role in ('operational', 'admin', 'manager', 'technical', 'representative')
          )
      ),
      'active_representatives', (select count(*) from public.representatives where status = 'active'),
      'network_growth', (select count(*) from public.representatives where (created_at at time zone 'America/Sao_Paulo')::date between p_date_from and p_date_to),
      'kits', (select count(*) from public.kit_orders where (created_at at time zone 'America/Sao_Paulo')::date between p_date_from and p_date_to),
      'kits_cents', coalesce((select sum(total_in_cents) from public.kit_orders where status not in ('cancelled', 'refunded') and (created_at at time zone 'America/Sao_Paulo')::date between p_date_from and p_date_to), 0),
      'critical_stock', (select count(*) from public.inventory where available_quantity <= minimum_quantity),
      'commissions_cents', coalesce((select sum(commission_in_cents) from public.commission_entries where status not in ('reversed', 'cancelled') and (created_at at time zone 'America/Sao_Paulo')::date between p_date_from and p_date_to), 0),
      'qualified_representatives', (select count(*) from public.representative_qualifications where qualified and (evaluated_at at time zone 'America/Sao_Paulo')::date between p_date_from and p_date_to),
      'active_levels', (select count(*) from public.representative_levels where active),
      'active_campaigns', (select count(*) from public.creative_campaigns where status in ('scheduled', 'published') and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now())),
      'homepage_events', (select count(*) from public.marketing_events where (occurred_at at time zone 'America/Sao_Paulo')::date between p_date_from and p_date_to and (p_campaign_id is null or utm_campaign = (select slug from public.creative_campaigns where id = p_campaign_id)) and (p_product_id is null or product_id = p_product_id))
    ),
    'pending', jsonb_build_object(
      'applications', (select count(*) from public.representative_applications where status in ('submitted', 'under_review', 'documents_pending')),
      'creatives', (select count(*) from public.creative_assets where status = 'pending_review'),
      'campaigns', (select count(*) from public.promotion_campaigns where requires_manager_approval and approved_by is null),
      'closings', (select count(*) from public.commission_closings where status = 'pending_approval')
    ),
    'alerts', jsonb_build_object(
      'reconciliation_divergences', (select count(*) from public.payment_reconciliations where divergence_amount <> 0 and status <> 'resolved'),
      'failed_commission_payments', (select count(*) from public.commission_payments where status = 'failed'),
      'critical_stock', (select count(*) from public.inventory where available_quantity <= minimum_quantity),
      'refunds_in_period', refunds.refund_count
    )
  ) into result
  from current_totals totals
  cross join previous_totals previous
  cross join daily
  cross join completed_refunds refunds;

  return result;
end;
$function$;


-- Preserve the original calculation, authorization and public signature.
CREATE OR REPLACE FUNCTION public.manager_executive_financial_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_permission('financial.read_summary');

  return jsonb_build_object(
    'receivable_cents', round(coalesce((select sum(amount) from private.reporting_accounts_receivable where status = 'pending'), 0) * 100)::bigint,
    'payable_cents', round(coalesce((select sum(amount) from private.reporting_accounts_payable where status = 'pending'), 0) * 100)::bigint,
    'overdue_receivable_cents', round(coalesce((select sum(amount) from private.reporting_accounts_receivable where status = 'pending' and due_on < (now() at time zone 'America/Sao_Paulo')::date), 0) * 100)::bigint,
    'overdue_payable_cents', round(coalesce((select sum(amount) from private.reporting_accounts_payable where status = 'pending' and due_on < (now() at time zone 'America/Sao_Paulo')::date), 0) * 100)::bigint
  );
end;
$function$;


-- Preserve the original calculation, authorization and public signature.
CREATE OR REPLACE FUNCTION public.manager_strategic_metrics(p_date_from date, p_date_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  result jsonb;
  period_days integer;
  previous_from date;
  previous_to date;
begin
  perform private.require_permission('financial.read_summary');

  if p_date_from is null or p_date_to is null or p_date_to < p_date_from then
    raise exception 'invalid management period';
  end if;
  if p_date_to - p_date_from > 366 then
    raise exception 'management period exceeds one year';
  end if;

  period_days := p_date_to - p_date_from + 1;
  previous_to := p_date_from - 1;
  previous_from := previous_to - period_days + 1;

  with current_orders as materialized (
    select sale.*, (select coalesce(sum(refund.amount), 0) from public.payment_refunds refund
          join public.payments payment on payment.id = refund.payment_id
          where payment.order_id = sale.id and refund.status = 'completed') as completed_refund_amount
    from public.reporting_orders sale
    where sale.payment_status = 'approved'
      and sale.status not in ('draft','pending_payment','cancellation_requested','cancelled','refunded')
      and (coalesce(sale.placed_at, sale.created_at) at time zone 'America/Sao_Paulo')::date
        between p_date_from and p_date_to
  ), previous_orders as materialized (
    select sale.*, (select coalesce(sum(refund.amount), 0) from public.payment_refunds refund
          join public.payments payment on payment.id = refund.payment_id
          where payment.order_id = sale.id and refund.status = 'completed') as completed_refund_amount
    from public.reporting_orders sale
    where sale.payment_status = 'approved'
      and sale.status not in ('draft','pending_payment','cancellation_requested','cancelled','refunded')
      and (coalesce(sale.placed_at, sale.created_at) at time zone 'America/Sao_Paulo')::date
        between previous_from and previous_to
  ), current_totals as (
    select
      count(*)::bigint as orders,
      round(coalesce(sum(grand_total), 0) * 100)::bigint as gross_cents,
      round(coalesce(sum(grand_total - fee_total - shipping_cost - completed_refund_amount), 0) * 100)::bigint as net_cents,
      round(coalesce(sum(estimated_profit), 0) * 100)::bigint as profit_cents
    from current_orders
  ), previous_totals as (
    select
      count(*)::bigint as orders,
      round(coalesce(sum(grand_total), 0) * 100)::bigint as gross_cents,
      round(coalesce(sum(grand_total - fee_total - shipping_cost - completed_refund_amount), 0) * 100)::bigint as net_cents,
      round(coalesce(sum(estimated_profit), 0) * 100)::bigint as profit_cents
    from previous_orders
  )
  select jsonb_build_object(
    'period', jsonb_build_object(
      'from', p_date_from,
      'to', p_date_to,
      'previous_from', previous_from,
      'previous_to', previous_to
    ),
    'comparison', jsonb_build_object('current', to_jsonb(current_total), 'previous', to_jsonb(previous_total)),
    'series', coalesce((
      select jsonb_agg(to_jsonb(series_row) order by series_row.day)
      from (
        select
          (coalesce(placed_at, created_at) at time zone 'America/Sao_Paulo')::date as day,
          round(sum(grand_total) * 100)::bigint as gross_cents,
          round(sum(grand_total - fee_total - shipping_cost - completed_refund_amount) * 100)::bigint as net_cents,
          round(sum(estimated_profit) * 100)::bigint as profit_cents,
          count(*)::bigint as orders
        from current_orders
        group by 1
      ) series_row
    ), '[]'::jsonb),
    'products', coalesce((
      select jsonb_agg(to_jsonb(product_row) order by greatest(product_row.current_revenue_cents, product_row.previous_revenue_cents) desc)
      from (
        select
          item.product_id,
          max(item.product_name_snapshot) as name,
          round(coalesce(sum(item.total) filter (where (coalesce(sale.placed_at, sale.created_at) at time zone 'America/Sao_Paulo')::date between p_date_from and p_date_to), 0) * 100)::bigint as current_revenue_cents,
          round(coalesce(sum(item.total) filter (where (coalesce(sale.placed_at, sale.created_at) at time zone 'America/Sao_Paulo')::date between previous_from and previous_to), 0) * 100)::bigint as previous_revenue_cents,
          coalesce(sum(item.quantity) filter (where (coalesce(sale.placed_at, sale.created_at) at time zone 'America/Sao_Paulo')::date between p_date_from and p_date_to), 0)::bigint as current_units,
          coalesce(sum(item.quantity) filter (where (coalesce(sale.placed_at, sale.created_at) at time zone 'America/Sao_Paulo')::date between previous_from and previous_to), 0)::bigint as previous_units
        from public.order_items item
        join public.reporting_orders sale on sale.id = item.order_id
        where sale.payment_status = 'approved'
      and sale.status not in ('draft','pending_payment','cancellation_requested','cancelled','refunded')
          and (coalesce(sale.placed_at, sale.created_at) at time zone 'America/Sao_Paulo')::date
            between previous_from and p_date_to
        group by item.product_id
        order by greatest(
          coalesce(sum(item.total) filter (where (coalesce(sale.placed_at, sale.created_at) at time zone 'America/Sao_Paulo')::date between p_date_from and p_date_to), 0),
          coalesce(sum(item.total) filter (where (coalesce(sale.placed_at, sale.created_at) at time zone 'America/Sao_Paulo')::date between previous_from and previous_to), 0)
        ) desc
        limit 30
      ) product_row
    ), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(to_jsonb(category_row) order by category_row.current_revenue_cents desc)
      from (
        select
          category.id as category_id,
          category.name,
          round(coalesce(sum(item.total), 0) * 100)::bigint as current_revenue_cents,
          coalesce(sum(item.quantity), 0)::bigint as current_units
        from current_orders sale
        join public.order_items item on item.order_id = sale.id
        join public.products product on product.id = item.product_id
        join public.categories category on category.id = product.category_id
        group by category.id, category.name
        order by current_revenue_cents desc
        limit 12
      ) category_row
    ), '[]'::jsonb),
    'regions', coalesce((
      select jsonb_agg(to_jsonb(region_row) order by region_row.revenue_cents desc)
      from (
        select
          coalesce(nullif(trim(representative.region_code), ''), 'Não informada') as name,
          round(coalesce(sum(representative_sale.total_in_cents), 0))::bigint as revenue_cents,
          count(*)::bigint as sales
        from public.representative_sales representative_sale
        join public.representatives representative
          on representative.id = representative_sale.representative_id
        join public.reporting_orders sale on sale.id = representative_sale.order_id
        where representative_sale.status = 'confirmed'
          and sale.payment_status = 'approved'
          and sale.status not in ('draft','pending_payment','cancellation_requested','cancelled','refunded')
          and (coalesce(sale.placed_at, sale.created_at) at time zone 'America/Sao_Paulo')::date
            between p_date_from and p_date_to
        group by 1
        order by revenue_cents desc
        limit 12
      ) region_row
    ), '[]'::jsonb),
    'representatives', coalesce((
      select jsonb_agg(to_jsonb(representative_row) order by representative_row.revenue_cents desc)
      from (
        select
          representative.id as representative_id,
          profile.full_name as name,
          representative.public_code,
          round(coalesce(sum(representative_sale.total_in_cents), 0))::bigint as revenue_cents,
          count(*)::bigint as sales
        from public.representative_sales representative_sale
        join public.representatives representative
          on representative.id = representative_sale.representative_id
        join public.profiles profile on profile.id = representative.user_id
        join public.reporting_orders sale on sale.id = representative_sale.order_id
        where representative_sale.status = 'confirmed'
          and sale.payment_status = 'approved'
          and sale.status not in ('draft','pending_payment','cancellation_requested','cancelled','refunded')
          and (coalesce(sale.placed_at, sale.created_at) at time zone 'America/Sao_Paulo')::date
            between p_date_from and p_date_to
        group by representative.id, profile.full_name, representative.public_code
        order by revenue_cents desc
        limit 12
      ) representative_row
    ), '[]'::jsonb),
    'campaigns', coalesce((
      select jsonb_agg(to_jsonb(campaign_row) order by campaign_row.events desc)
      from (
        select
          campaign.id as campaign_id,
          campaign.name,
          campaign.status::text,
          count(event.id)::bigint as events
        from public.creative_campaigns campaign
        left join public.marketing_events event on event.utm_campaign = campaign.slug
          and (event.occurred_at at time zone 'America/Sao_Paulo')::date between p_date_from and p_date_to
        where campaign.status in ('scheduled', 'published') or event.id is not null
        group by campaign.id, campaign.name, campaign.status
        order by events desc
        limit 12
      ) campaign_row
    ), '[]'::jsonb),
    'goals', coalesce((
      select jsonb_agg(to_jsonb(goal_row) order by goal_row.period_end)
      from (
        select
          goal.id,
          goal.title,
          goal.period_start,
          goal.period_end,
          goal.target,
          coalesce(profile.full_name, level.name, 'Escopo gerencial') as scope
        from public.representative_goals goal
        left join public.representatives representative on representative.id = goal.representative_id
        left join public.profiles profile on profile.id = representative.user_id
        left join public.representative_levels level on level.id = goal.level_id
        where goal.active and goal.period_start <= p_date_to and goal.period_end >= p_date_from
        order by goal.period_end
        limit 12
      ) goal_row
    ), '[]'::jsonb)
  ) into result
  from current_totals current_total
  cross join previous_totals previous_total;

  return result;
end;
$function$;
;

-- 20261103174235_bling_fiscal_approval_without_catalog_sync.sql
-- Approval bookkeeping is local to curti Z; it is not part of the Bling payload.
-- Do not enqueue provider writes when only approval evidence changes.
create or replace function private.enqueue_bling_catalog_media_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare product_ids uuid[]; v_id uuid;
begin
  if tg_table_schema = 'private' and tg_table_name = 'bling_catalog_metadata' and tg_op = 'UPDATE' then
    if (to_jsonb(old) - array['fiscal_unit_approved', 'evidence_reference', 'updated_at'])
      = (to_jsonb(new) - array['fiscal_unit_approved', 'evidence_reference', 'updated_at']) then
      return null;
    end if;
  end if;
  product_ids := case when tg_op='INSERT' then array[new.product_id]
    when tg_op='DELETE' then array[old.product_id] else array[old.product_id,new.product_id] end;
  for v_id in select link.variant_id from private.bling_product_links link
    join public.product_variants v on v.id=link.variant_id where v.product_id=any(product_ids) loop
    update private.bling_product_links set sync_status='pending',updated_at=now() where variant_id=v_id;
    insert into public.background_jobs(queue,job_type,payload_sanitized,idempotency_key)
    values('bling','bling.product.sync',jsonb_build_object('variantId',v_id),
      'bling:media:' || v_id::text || ':' || extract(epoch from clock_timestamp())::text) on conflict(idempotency_key) do nothing;
  end loop;
  return null;
end;
$$;
;

-- 202611070001_delete_representative_sale.sql
-- Allow representatives to permanently clear their own sales from the portal.
-- Stock is restored only once for confirmed sales and a sanitized audit record
-- is kept before the operational sale rows are removed.
create or replace function public.delete_representative_sale(
  p_sale_id uuid,
  p_confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  representative_row public.representatives%rowtype;
  sale_row public.representative_sales%rowtype;
  item record;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if lower(trim(coalesce(p_confirmation, ''))) not in ('excluir', 'delete', 'apagar') then
    raise exception 'explicit delete confirmation required' using errcode = '22023';
  end if;

  select * into representative_row
  from public.representatives where user_id = auth.uid();
  if representative_row.id is null then
    raise exception 'representative not found' using errcode = '42501';
  end if;
  select * into sale_row
  from public.representative_sales
  where id = p_sale_id and representative_id = representative_row.id
  for update;
  if sale_row.id is null then
    raise exception 'sale not found' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.commission_entries entry
    where entry.sale_id = sale_row.id and entry.status = 'paid'
  ) then
    raise exception 'sale commission is already paid' using errcode = '23514';
  end if;
  if exists (
    select 1
    from public.commission_entries entry
    join public.commission_closing_entries closing_entry
      on closing_entry.commission_entry_id = entry.id
    where entry.sale_id = sale_row.id
  ) then
    raise exception 'sale commission is in a closing' using errcode = '23514';
  end if;
  if exists (
    select 1
    from public.commission_entries entry
    where entry.sale_id = sale_row.id and entry.reversal_of is not null
  ) then
    raise exception 'sale commission history is preserved' using errcode = '23514';
  end if;
  if exists (
    select 1
    from public.commission_entries entry
    join public.commission_entries reversal on reversal.reversal_of = entry.id
    where entry.sale_id = sale_row.id
  ) then
    raise exception 'sale commission history is preserved' using errcode = '23514';
  end if;
  if exists (
    select 1
    from public.commission_entries entry
    join public.commission_adjustments adjustment
      on adjustment.commission_entry_id = entry.id
    where entry.sale_id = sale_row.id
  ) then
    raise exception 'sale commission history is preserved' using errcode = '23514';
  end if;

  if sale_row.status = 'confirmed' then
    for item in
      select variant_id, quantity
      from public.representative_sale_items
      where sale_id = sale_row.id
      order by variant_id
    loop
      insert into public.representative_inventory(representative_id, variant_id, quantity)
      values (representative_row.id, item.variant_id, item.quantity)
      on conflict (representative_id, variant_id) do update
        set quantity = public.representative_inventory.quantity + excluded.quantity,
            version = public.representative_inventory.version + 1,
            updated_at = now();
      insert into public.representative_inventory_movements(
        representative_id, variant_id, quantity_delta, reason, source_type,
        source_id, idempotency_key, created_by
      ) values (
        representative_row.id, item.variant_id, item.quantity,
        'sale_delete', 'representative_sale', sale_row.id,
        'delete:' || sale_row.id::text || ':' || item.variant_id::text,
        auth.uid()
      );
    end loop;
  end if;

  -- Sale items cascade. Commission entries are removed only when they are not
  -- part of a closing, preserving closing and adjustment history otherwise.
  delete from public.commission_entries where sale_id = sale_row.id;

  insert into public.audit_logs(
    actor_id, actor_role, action, entity_type, entity_id,
    previous_data_sanitized, reason
  ) values (
    auth.uid(), private.current_app_role(), 'representative.sale.deleted',
    'representative_sale', sale_row.id,
    jsonb_build_object(
      'public_code', sale_row.public_code,
      'status', sale_row.status,
      'total_in_cents', sale_row.total_in_cents
    ),
    'Deleted by the representative from the portal'
  );

  delete from public.representative_sales where id = sale_row.id;

  return jsonb_build_object('deleted', true, 'public_code', sale_row.public_code);
end;
$$;

revoke all on function public.delete_representative_sale(uuid, text) from public, anon;
grant execute on function public.delete_representative_sale(uuid, text) to authenticated;
;

-- 20261108153004_restrict_published_help_audiences.sql
-- Published help may target staff or specific authenticated audiences. A
-- public view and its search RPC must not trust an audience supplied by callers.
create or replace function private.help_audience_allowed(p_audiences jsonb, p_category_public boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_typeof(p_audiences) = 'array', false) and (
    (coalesce(p_category_public, false) and p_audiences ? 'visitor')
    or current_setting('role', true) = 'service_role'
    or auth.jwt()->>'role' = 'service_role'
    or (
      auth.uid() is not null
      and coalesce(auth.jwt()->>'is_anonymous', 'false') <> 'true'
      and private.is_active_user()
      and not private.customer_account_is_closed()
      and (
        (coalesce(p_category_public, false) and p_audiences ? 'customer')
        or exists (
          select 1 from public.user_roles ur
          where ur.user_id = auth.uid()
            and p_audiences ? ur.role::text
            and (
              (ur.role::text in ('customer', 'representative') and coalesce(p_category_public, false))
              or (ur.role::text not in ('customer', 'representative') and private.internal_mfa_satisfied())
            )
        )
      )
    )
  );
$$;

revoke all on function private.help_audience_allowed(jsonb, boolean) from public;
grant execute on function private.help_audience_allowed(jsonb, boolean) to anon, authenticated, service_role;

create or replace view public.published_help_contents with (security_barrier=true) as
select content.id,version.snapshot#>>'{content,slug}' slug,version.snapshot#>>'{content,content_type}' content_type,
  coalesce((version.snapshot#>>'{content,priority}')::integer,0) priority,
  content.views_count,content.helpful_count,content.unhelpful_count,
  version.version,version.created_at as version_created_at,
  jsonb_build_object(
    'content',(version.snapshot->'content') - 'category_id' - 'author_id' - 'reviewer_id' - 'attachments' - 'created_at' - 'updated_at',
    'category',version.snapshot->'category',
    'related',coalesce((
      select jsonb_agg(related.entry order by related.position)
      from jsonb_array_elements(
        case when jsonb_typeof(version.snapshot->'related') = 'array'
          then version.snapshot->'related' else '[]'::jsonb end
      ) with ordinality as related(entry,position)
      join public.help_contents target on target.slug = related.entry->>'slug'
      join public.support_categories target_category on target_category.id = target.category_id
      join public.help_content_versions target_version on target_version.id = case
        when target.scheduled_version_id is not null and target.scheduled_at <= now() then target.scheduled_version_id
        else target.published_version_id end
      where (target.published_version_id is not null
          or (target.scheduled_version_id is not null and target.scheduled_at <= now()))
        and (target.expires_at is null or target.expires_at > now())
        and private.help_audience_allowed(target_version.snapshot#>'{content,audiences}', target_category.active and target_category.public_visible)
    ), '[]'::jsonb)
  ) snapshot,
  version.snapshot#>>'{category,name}' as category_name,version.snapshot#>>'{category,slug}' as category_slug
from public.help_contents content
join public.support_categories category on category.id = content.category_id
join public.help_content_versions version on version.id=case
  when content.scheduled_version_id is not null and content.scheduled_at<=now() then content.scheduled_version_id
  else content.published_version_id end
where (content.published_version_id is not null
    or (content.scheduled_version_id is not null and content.scheduled_at<=now()))
  and (content.expires_at is null or content.expires_at>now())
  and private.help_audience_allowed(version.snapshot#>'{content,audiences}', category.active and category.public_visible);

notify pgrst, 'reload schema';
;

-- 20261108153226_protect_cookie_consent_release.sql
-- Consent records are immutable: a caller must not overwrite another user's record
-- merely by knowing its identifier. Each preference change creates a new record.
create or replace function public.record_cookie_consent(
  p_id uuid,
  p_policy_version text,
  p_categories jsonb,
  p_origin text,
  p_revoked boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  category_count integer;
begin
  if pg_catalog.jsonb_typeof(p_categories) <> 'object' then
    raise exception 'invalid cookie consent';
  end if;

  select pg_catalog.count(*) into category_count
  from pg_catalog.jsonb_object_keys(p_categories);

  if category_count > 8
    or pg_catalog.char_length(p_policy_version) > 40
    or p_origin not in ('banner', 'preferences', 'account') then
    raise exception 'invalid cookie consent';
  end if;

  insert into public.cookie_consents(id, user_id, policy_version, categories, origin, revoked)
  values (p_id, auth.uid(), p_policy_version, p_categories, p_origin, p_revoked)
  on conflict (id) do nothing;

  -- A retry with the same payload and owner is harmless and must be idempotent.
  if not found and not exists (
    select 1 from public.cookie_consents c
    where c.id = p_id
      and c.user_id is not distinct from auth.uid()
      and c.policy_version = p_policy_version
      and c.categories = p_categories
      and c.origin = p_origin
      and c.revoked = p_revoked
  ) then
    raise exception 'cookie consent identifier already used' using errcode = '23505';
  end if;
end;
$$;

notify pgrst, 'reload schema';
;

-- 20261108153312_restrict_homepage_metric_rpc.sql
-- The store applies rate limiting and consent before calling this server-only RPC.
revoke execute on function public.record_homepage_metric(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.record_homepage_metric(uuid, text, text, text) to service_role;
;

-- 20261108153342_representative_portal_safety.sql
-- Compute totals over the complete history under the caller's existing RLS.
create or replace function public.get_representative_portal_totals()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'confirmed_sales_in_cents', coalesce((
      select sum(s.total_in_cents) from public.representative_sales s
      join public.representatives r on r.id = s.representative_id
      where r.user_id = auth.uid() and s.status = 'confirmed'
    ), 0),
    'available_commission_in_cents', coalesce((
      select sum(c.commission_in_cents) from public.commission_entries c
      join public.representatives r on r.id = c.representative_id
      where r.user_id = auth.uid() and c.status in ('approved', 'payable')
    ), 0),
    'kit_count', (
      select count(*) from public.kit_orders k
      join public.representatives r on r.id = k.representative_id
      where r.user_id = auth.uid() and k.status in ('paid', 'separating', 'ready_to_ship', 'shipped', 'delivered')
    )
  );
$$;
revoke all on function public.get_representative_portal_totals() from public, anon;
grant execute on function public.get_representative_portal_totals() to authenticated;

-- Do not silently invalidate a settled or closed commission. Such cases
-- require a financial adjustment through the authorized management process.
create or replace function private.prevent_settled_representative_sale_cancellation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'confirmed' and new.status = 'cancelled' then
    perform 1 from public.commission_entries where sale_id = old.id for update;
    if exists (
      select 1 from public.commission_entries c
      where c.sale_id = old.id and (
        c.status = 'paid' or exists (
          select 1 from public.commission_closing_entries ce where ce.commission_entry_id = c.id
        )
      )
    ) then
      raise exception 'sale has a settled or closed commission' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.prevent_settled_representative_sale_cancellation() from public, anon, authenticated;
create trigger prevent_settled_representative_sale_cancellation
before update of status on public.representative_sales
for each row execute function private.prevent_settled_representative_sale_cancellation();

-- Serialize closing creation with cancellation and recheck the current status
-- after acquiring the same commission row lock.
create or replace function private.validate_commission_closing_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare current_status public.commission_status;
begin
  select status into current_status from public.commission_entries
  where id = new.commission_entry_id for update;
  if current_status is null or current_status not in ('approved', 'payable') then
    raise exception 'commission is not eligible for closing' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_commission_closing_entry() from public, anon, authenticated;
create trigger validate_commission_closing_entry
before insert on public.commission_closing_entries
for each row execute function private.validate_commission_closing_entry();

-- Recheck the current commission row under its DELETE lock. A prior check in
-- delete_representative_sale can become stale while another transaction pays it.
create or replace function private.protect_commission_history_on_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'paid' then
    raise exception 'sale commission is already paid' using errcode = '23514';
  end if;
  if old.reversal_of is not null
    or exists (select 1 from public.commission_entries reversal where reversal.reversal_of = old.id)
    or exists (select 1 from public.commission_adjustments adjustment where adjustment.commission_entry_id = old.id)
    or exists (select 1 from public.commission_closing_entries closing_entry where closing_entry.commission_entry_id = old.id) then
    raise exception 'sale commission history is preserved' using errcode = '23514';
  end if;
  return old;
end;
$$;
revoke all on function private.protect_commission_history_on_delete() from public, anon, authenticated;
create trigger protect_commission_history_on_delete
before delete on public.commission_entries
for each row execute function private.protect_commission_history_on_delete();
;

-- 20261108210341_prepare_help_writes_server.sql
-- The application verifies the viewer's identity and content access before
-- calling these service-only helpers. Old callers remain valid until rollout.
grant execute on function public.record_help_search(text,text,integer,text),
  public.record_help_view(uuid) to service_role;

create function public.record_help_feedback_server(
  p_content_id uuid, p_session_id uuid, p_user_id uuid, p_helpful boolean,
  p_reason text default null, p_action text default null
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.published_help_contents where id=p_content_id) then
    raise exception 'content unavailable';
  end if;
  insert into public.help_content_feedback(content_id,session_id,user_id,helpful,reason,action_taken)
  values(p_content_id,p_session_id,p_user_id,p_helpful,
    nullif(left(trim(coalesce(p_reason,'')),500),''),
    nullif(left(trim(coalesce(p_action,'')),120),''))
  on conflict(content_id,session_id) do update
    set helpful=excluded.helpful,reason=excluded.reason,
        action_taken=excluded.action_taken,created_at=now()
    where public.help_content_feedback.user_id is not distinct from excluded.user_id;
  if not found then raise exception 'feedback session belongs to another user' using errcode='42501'; end if;
  update public.help_contents
    set helpful_count=(select count(*) from public.help_content_feedback where content_id=p_content_id and helpful),
        unhelpful_count=(select count(*) from public.help_content_feedback where content_id=p_content_id and not helpful)
    where id=p_content_id;
end;
$$;
revoke all on function public.record_help_feedback_server(uuid,uuid,uuid,boolean,text,text) from public,anon,authenticated;
grant execute on function public.record_help_feedback_server(uuid,uuid,uuid,boolean,text,text) to service_role;
notify pgrst, 'reload schema';
;

-- 20261108210447_restrict_help_writes_client.sql
-- Apply after the application uses the service-only helpers.
revoke execute on function public.record_help_search(text,text,integer,text),
  public.record_help_view(uuid),
  public.record_help_feedback(uuid,uuid,boolean,text,text) from public,anon,authenticated;
notify pgrst, 'reload schema';
;

-- 20261108212415_prepare_intelligence_ingest_server.sql
-- Only the server may supply the identity after validating the session and consent.
create function public.ingest_intelligence_events_server(p_session_id uuid, p_events jsonb, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.set_config('request.jwt.claim.sub', coalesce(p_user_id::text, ''), true);
  perform pg_catalog.set_config('request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', p_user_id, 'role', case when p_user_id is null then 'anon' else 'authenticated' end)::text, true);
  return public.ingest_intelligence_events(p_session_id, p_events, true);
end;
$$;
revoke all on function public.ingest_intelligence_events_server(uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.ingest_intelligence_events_server(uuid,jsonb,uuid) to service_role;
notify pgrst, 'reload schema';
;

-- 20261108212529_restrict_intelligence_ingest_client.sql
-- Apply only after the store uses the service-only entry point.
revoke execute on function public.ingest_intelligence_events(uuid,jsonb,boolean) from public,anon,authenticated;
notify pgrst, 'reload schema';
;

-- 20261110153802_restrict_order_ciphertext_read.sql
-- RLS controls which orders are visible, but a table-wide SELECT also exposed
-- encrypted CPF values to every authenticated reader of an allowed order.
-- Preserve the existing public columns and leave service_role untouched.
-- The reporting view previously selected the encrypted field too. Keep its
-- existing column shape without requiring callers to read the underlying CPF.
create or replace view public.reporting_orders with (security_invoker = true) as
select id, public_code, customer_id, customer_email_snapshot, customer_name_snapshot,
  customer_phone_snapshot, null::text as cpf_ciphertext, cpf_last_four, status,
  payment_status, currency, subtotal, discount_total, shipping_total, shipping_cost,
  fee_total, grand_total, cost_total, estimated_profit, coupon_id,
  shipping_address_snapshot, commercial_rules_snapshot, risk_level, placed_at,
  created_at, updated_at
from public.orders
where (commercial_rules_snapshot ->> 'paymentMode') is distinct from 'test';

revoke select on table public.orders from authenticated;
grant select (
  id, public_code, customer_id, customer_email_snapshot, customer_name_snapshot,
  customer_phone_snapshot, cpf_last_four, status, payment_status, currency,
  subtotal, discount_total, shipping_total, shipping_cost, fee_total, grand_total,
  cost_total, estimated_profit, coupon_id, shipping_address_snapshot,
  commercial_rules_snapshot, risk_level, placed_at, created_at, updated_at
) on public.orders to authenticated;

notify pgrst, 'reload schema';
;

-- 20261111100800_prepare_protected_catalog_costs.sql
-- Preparation only: the panel must switch to this function before direct
-- client access to cost columns can be revoked.
create function public.admin_read_catalog_costs(p_product_ids uuid[])
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not private.user_has_role('admin'::public.app_role) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_product_ids is null or cardinality(p_product_ids) > 500 then
    raise exception 'invalid product ids' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'product_id', p.id,
    'product_cost', p.cost_price,
    'variants', coalesce((select jsonb_object_agg(v.id::text, v.cost_override)
      from public.product_variants v where v.product_id = p.id), '{}'::jsonb)
  )), '[]'::jsonb) into result
  from public.products p where p.id = any(p_product_ids);
  return result;
end;
$$;

revoke all on function public.admin_read_catalog_costs(uuid[]) from public, anon, authenticated;
grant execute on function public.admin_read_catalog_costs(uuid[]) to authenticated;
notify pgrst, 'reload schema';
;

-- 20261111101306_restrict_catalog_costs.sql
-- Apply only after the panel uses admin_read_catalog_costs.
-- Abort if new columns need review before replacing table-wide grants.
do $$
begin
  if exists (select 1 from pg_attribute where attrelid = 'public.products'::regclass and attnum > 0 and not attisdropped
    and attname::text <> all(array['id','name','slug','short_description','description','category_id','collection_id',
      'status','featured','base_price','cost_price','weight_grams','height_cm','width_cm','length_cm','seo_title',
      'seo_description','search_document','created_by','updated_by','created_at','updated_at','compare_at_price',
      'model_id','status_reason','published_at','published_by','merchant_condition','merchant_gender',
      'merchant_age_group','google_product_category','merchant_identifier_exists']))
  then raise exception 'products columns changed; review cost grants'; end if;
  if exists (select 1 from pg_attribute where attrelid = 'public.product_variants'::regclass and attnum > 0 and not attisdropped
    and attname::text <> all(array['id','product_id','sku','color_name','color_hex','size','price_override','cost_override',
      'active','barcode','created_at','updated_at','merchant_mpn','color_hex_secondary','display_title']))
  then raise exception 'product_variants columns changed; review cost grants'; end if;
end;
$$;

revoke select on table public.products from authenticated;
revoke select (cost_price) on public.products from public, anon, authenticated;
grant select (
  id, name, slug, short_description, description, category_id, collection_id,
  status, featured, base_price, weight_grams, height_cm, width_cm, length_cm,
  seo_title, seo_description, search_document, created_by, updated_by,
  created_at, updated_at, compare_at_price, model_id, status_reason, published_at,
  published_by, merchant_condition, merchant_gender, merchant_age_group,
  google_product_category, merchant_identifier_exists
) on public.products to authenticated;

revoke select on table public.product_variants from authenticated;
revoke select (cost_override) on public.product_variants from public, anon, authenticated;
grant select (
  id, product_id, sku, color_name, color_hex, size, price_override, active,
  barcode, created_at, updated_at, merchant_mpn, color_hex_secondary, display_title
) on public.product_variants to authenticated;

notify pgrst, 'reload schema';
;

-- 20261111110000_restrict_order_item_cost_read.sql
-- Customers need the sale price of their items, not the store's unit cost.
-- RLS still controls which rows may be read; preserve every other column.
do $$
begin
  if exists (
    select 1 from pg_attribute
    where attrelid = 'public.order_items'::regclass and attnum > 0 and not attisdropped
      and attname::text <> all(array['id','order_id','product_id','variant_id','product_name_snapshot',
        'sku_snapshot','color_snapshot','size_snapshot','quantity','unit_price','discount_amount','total','unit_cost_snapshot'])
  ) then raise exception 'order_items columns changed; review cost grants'; end if;
end;
$$;
revoke select on table public.order_items from authenticated;
revoke select (unit_cost_snapshot) on public.order_items from public, anon, authenticated;
grant select (
  id, order_id, product_id, variant_id, product_name_snapshot, sku_snapshot,
  color_snapshot, size_snapshot, quantity, unit_price, discount_amount, total
) on public.order_items to authenticated;

notify pgrst, 'reload schema';
;

-- 20261111121500_prepare_manager_order_profits.sql
-- The manager panel must not rely on customer-readable order cost columns.
create or replace function public.manager_read_order_profits(p_order_ids uuid[])
returns table(order_id uuid, estimated_profit numeric)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.user_has_role('manager'::public.app_role)
     or private.customer_account_is_closed()
     or not private.has_permission('orders.read_all')
     or not private.has_permission('financial.read_summary') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_order_ids is null or cardinality(p_order_ids) > 500 then
    raise exception 'invalid order ids' using errcode = '22023';
  end if;
  return query select o.id, o.estimated_profit
    from public.orders o where o.id = any(p_order_ids);
end;
$$;
revoke all on function public.manager_read_order_profits(uuid[]) from public, anon, authenticated;
grant execute on function public.manager_read_order_profits(uuid[]) to authenticated;
;

-- 20261111122000_restrict_order_financial_read.sql
-- Keep financial reporting behind its existing security-definer functions.
-- A separate private view lets customer-facing reporting retain RLS without
-- granting customers access to order costs or estimated profit.
do $$
begin
  if exists (
    select 1 from pg_attribute
    where attrelid = 'public.orders'::regclass and attnum > 0 and not attisdropped
      and attname::text <> all(array['id','public_code','customer_id','customer_email_snapshot','customer_name_snapshot',
        'customer_phone_snapshot','cpf_ciphertext','cpf_last_four','status','payment_status','currency','subtotal',
        'discount_total','shipping_total','shipping_cost','fee_total','grand_total','cost_total','estimated_profit',
        'coupon_id','shipping_address_snapshot','commercial_rules_snapshot','risk_level','placed_at','created_at','updated_at'])
  ) then raise exception 'orders columns changed; review financial grants'; end if;
end;
$$;
create view private.reporting_orders_financial with (security_invoker = true) as
select id, public_code, customer_id, customer_email_snapshot, customer_name_snapshot,
  customer_phone_snapshot, null::text as cpf_ciphertext, cpf_last_four, status,
  payment_status, currency, subtotal, discount_total, shipping_total, shipping_cost,
  fee_total, grand_total, cost_total, estimated_profit, coupon_id,
  shipping_address_snapshot, commercial_rules_snapshot, risk_level, placed_at,
  created_at, updated_at
from public.orders
where (commercial_rules_snapshot ->> 'paymentMode') is distinct from 'test';
revoke all on private.reporting_orders_financial from public, anon, authenticated;

-- Replace only reviewed security-definer functions. Abort on unexpected drift,
-- rather than silently breaking an unknown consumer of the existing view.
do $$
declare f record; seen text[] := array[]::text[]; definition text;
begin
  for f in
    select p.oid, n.nspname, p.proname, p.prosecdef, p.proowner
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prokind = 'f'
      and pg_get_functiondef(p.oid) ilike '%public.reporting_orders%'
  loop
    if f.nspname <> 'public' or not f.prosecdef
       or f.proowner <> (select relowner from pg_class where oid = 'private.reporting_orders_financial'::regclass)
       or f.proname = any(seen) or f.proname not in (
      'admin_approved_sales_total_in_cents', 'financial_control_snapshot',
      'manager_dashboard_metrics', 'manager_strategic_metrics'
    ) then
      raise exception 'unexpected reporting_orders consumer: %', f.oid::regprocedure;
    end if;
    definition := pg_get_functiondef(f.oid);
    if position('public.reporting_orders' in definition) = 0 then
      raise exception 'unexpected reporting reference in %', f.oid::regprocedure;
    end if;
    execute replace(definition, 'public.reporting_orders', 'private.reporting_orders_financial');
    seen := array_append(seen, f.proname::text);
  end loop;
  if cardinality(seen) <> 4 then raise exception 'unexpected reporting functions: %', seen; end if;
end;
$$;

create or replace view public.reporting_orders with (security_invoker = true) as
select id, public_code, customer_id, customer_email_snapshot, customer_name_snapshot,
  customer_phone_snapshot, null::text as cpf_ciphertext, cpf_last_four, status,
  payment_status, currency, subtotal, discount_total, shipping_total,
  null::numeric(12,2) as shipping_cost, fee_total, grand_total,
  null::numeric(12,2) as cost_total, null::numeric(12,2) as estimated_profit, coupon_id,
  shipping_address_snapshot, commercial_rules_snapshot, risk_level, placed_at,
  created_at, updated_at
from public.orders
where (commercial_rules_snapshot ->> 'paymentMode') is distinct from 'test';

revoke select on public.orders from authenticated;
revoke select (shipping_cost, cost_total, estimated_profit) on public.orders from public, anon, authenticated;
grant select (
  id, public_code, customer_id, customer_email_snapshot, customer_name_snapshot,
  customer_phone_snapshot, cpf_last_four, status, payment_status, currency,
  subtotal, discount_total, shipping_total, fee_total, grand_total, coupon_id,
  shipping_address_snapshot, commercial_rules_snapshot, risk_level, placed_at,
  created_at, updated_at
) on public.orders to authenticated;
notify pgrst, 'reload schema';
;

-- 20261111122500_prepare_operational_shipment_costs.sql
-- Restrict the cost reader to active operational users with order access.
create or replace function public.operational_read_shipment_costs(p_shipment_ids uuid[])
returns table(shipment_id uuid, shipping_cost numeric)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.user_has_role('operational'::public.app_role)
     or private.customer_account_is_closed()
     or not (private.has_permission('orders.read_all') or private.has_permission('orders.read_assigned')) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_shipment_ids is null or cardinality(p_shipment_ids) > 500 then
    raise exception 'invalid shipment ids' using errcode = '22023';
  end if;
  return query select s.id, s.shipping_cost from public.shipments s
    where s.id = any(p_shipment_ids);
end;
$$;
revoke all on function public.operational_read_shipment_costs(uuid[]) from public, anon, authenticated;
grant execute on function public.operational_read_shipment_costs(uuid[]) to authenticated;
;

-- 20261111123000_restrict_shipment_cost_read.sql
-- Keep customer shipment tracking available while hiding the carrier cost.
do $$
begin
  if exists (
    select 1 from pg_attribute
    where attrelid = 'public.shipments'::regclass and attnum > 0 and not attisdropped
      and attname::text <> all(array['id','order_id','provider','service','tracking_code','label_path','status',
        'package_snapshot','dispatched_at','delivered_at','metadata_sanitized','created_at','shipping_quote_id',
        'external_id','carrier','shipping_amount','shipping_cost','estimated_days','volume_index','operation_state',
        'operation_key','last_error_code','updated_at'])
  ) then raise exception 'shipments columns changed; review cost grants'; end if;
end;
$$;
revoke select on public.shipments from authenticated;
revoke select (shipping_cost) on public.shipments from public, anon, authenticated;
grant select (
  id, order_id, provider, service, tracking_code, label_path, status,
  package_snapshot, dispatched_at, delivered_at, metadata_sanitized, created_at,
  shipping_quote_id, external_id, carrier, shipping_amount, estimated_days,
  volume_index, operation_state, operation_key, last_error_code, updated_at
) on public.shipments to authenticated;
notify pgrst, 'reload schema';
;

-- 20261117110542_restrict_closed_order_history.sql
create or replace function public.list_my_visible_orders(p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if auth.uid() is null or not private.is_active_user() or private.customer_account_is_closed() then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'invalid_order_limit' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(entry.payload order by entry.created_at desc), '[]'::jsonb)
  into result
  from (
    select candidate.created_at,
      jsonb_build_object(
        'id', candidate.id,
        'public_code', candidate.public_code,
        'status', candidate.status,
        'payment_status', candidate.payment_status,
        'subtotal', candidate.subtotal,
        'discount_total', candidate.discount_total,
        'shipping_total', candidate.shipping_total,
        'grand_total', candidate.grand_total,
        'shipping_address_snapshot', candidate.shipping_address_snapshot,
        'cpf_last_four', candidate.cpf_last_four,
        'placed_at', candidate.placed_at,
        'created_at', candidate.created_at,
        'cancellation_completed_at', candidate.cancellation_completed_at,
        'refund_status', candidate.refund_status,
        'refund_completed_at', candidate.refund_completed_at,
        'had_approved_payment', candidate.had_approved_payment,
        'customer_visible_until', case
          when candidate.status = 'cancelled'
            and not candidate.had_approved_payment
            and candidate.refund_status is null
            then candidate.cancellation_completed_at + interval '72 hours'
          when candidate.status in ('cancelled', 'refunded')
            and candidate.refund_status = 'completed'
            then candidate.refund_completed_at + interval '240 hours'
          else null
        end
      ) as payload
    from (
      select sale.*,
        payment.provider_payment_id,
        payment.status as latest_payment_status,
        payment.status_detail,
        payment.expires_at,
        payment.payment_method_summary,
        cancellation.completed_at as cancellation_completed_at,
        refund.status as refund_status,
        refund.completed_at as refund_completed_at,
        exists (
          select 1
          from public.payments approved_payment
          where approved_payment.order_id = sale.id
            and (
              approved_payment.status in ('approved', 'refunded')
              or approved_payment.paid_at is not null
            )
        ) as had_approved_payment
      from public.orders sale
      left join lateral (
        select current_payment.provider_payment_id, current_payment.status,
          current_payment.status_detail, current_payment.expires_at,
          current_payment.payment_method_summary
        from public.payments current_payment
        where current_payment.order_id = sale.id
        order by current_payment.created_at desc, current_payment.id desc
        limit 1
      ) payment on true
      left join lateral (
        select max(history.created_at) as completed_at
        from public.order_status_history history
        where history.order_id = sale.id
          and history.new_status = 'cancelled'
      ) cancellation on true
      left join lateral (
        select current_refund.status, current_refund.completed_at
        from public.payment_refunds current_refund
        where current_refund.order_id = sale.id
        order by current_refund.created_at desc, current_refund.id desc
        limit 1
      ) refund on true
      where sale.customer_id = auth.uid()
    ) candidate
    where case
      when candidate.status in ('refund_pending', 'manual_review')
        or candidate.refund_status in ('pending', 'failed') then true
      when candidate.status = 'refunded' then
        candidate.refund_status <> 'completed'
        or candidate.refund_completed_at is null
        or now() < candidate.refund_completed_at + interval '240 hours'
      when candidate.status = 'cancelled'
        and (candidate.had_approved_payment or candidate.refund_status is not null) then
        candidate.refund_status <> 'completed'
        or candidate.refund_completed_at is null
        or now() < candidate.refund_completed_at + interval '240 hours'
      when candidate.status = 'cancelled' then
        candidate.cancellation_completed_at is null
        or now() < candidate.cancellation_completed_at + interval '72 hours'
      else
        coalesce(candidate.status_detail, '') <> 'expired'
        and not (
          candidate.latest_payment_status in ('pending', 'rejected', 'cancelled')
          and candidate.expires_at is not null
          and candidate.expires_at <= now()
        )
        and nullif(trim(coalesce(candidate.payment_method_summary, '')), '') is not null
        and (
          nullif(trim(coalesce(candidate.provider_payment_id, '')), '') is not null
          or exists (
            select 1
            from public.payment_attempts attempt
            where attempt.order_id = candidate.id
          )
        )
    end
    order by candidate.created_at desc
    limit p_limit
  ) entry;

  return result;
end;
$$;

revoke all on function public.list_my_visible_orders(integer) from public, anon;
grant execute on function public.list_my_visible_orders(integer) to authenticated;

;

-- 20261117111539_restrict_inactive_representative_network.sql
create or replace function public.get_representative_network(
  p_search text default null,
  p_status public.representative_status default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table(
  representative_id uuid,
  public_code text,
  display_name text,
  status public.representative_status,
  level_name text,
  depth integer,
  joined_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    member.id,
    member.public_code,
    profile.full_name,
    member.status,
    level.name,
    closure.depth,
    member.created_at
  from public.representatives owner
  join public.representative_network_closure closure
    on closure.ancestor_id = owner.id and closure.depth > 0
  join public.representatives member on member.id = closure.descendant_id
  join public.profiles profile on profile.id = member.user_id
  left join public.representative_levels level on level.id = member.current_level_id
  where owner.user_id = auth.uid()
    and private.is_active_user()
    and not private.customer_account_is_closed()
    and owner.status in ('active', 'unqualified', 'approved_waiting_kit')
    and (p_status is null or member.status = p_status)
    and (
      nullif(trim(p_search), '') is null
      or member.public_code ilike '%' || trim(p_search) || '%'
      or profile.full_name ilike '%' || trim(p_search) || '%'
    )
  order by closure.depth, profile.full_name
  limit least(greatest(p_limit, 1), 50)
  offset greatest(p_offset, 0);
$$;
;

-- 20261117120000_restrict_inactive_support_reopen.sql
create or replace function public.reopen_own_support_conversation(p_conversation_id uuid, p_reason text)
returns public.support_conversations
language plpgsql security definer set search_path = ''
as $$
declare conversation public.support_conversations; previous_status public.support_status;
begin
  if auth.uid() is null or not private.is_active_user() or private.customer_account_is_closed() then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if char_length(trim(p_reason)) not between 5 and 500 then raise exception 'invalid reopen'; end if;
  select * into conversation from public.support_conversations where id=p_conversation_id and customer_id=auth.uid() for update;
  if not found or conversation.status not in ('resolved','closed') then raise exception 'conversation cannot be reopened'; end if;
  previous_status:=conversation.status;
  update public.support_conversations set status='reopened',reopened_at=now(),closed_at=null,updated_at=now()
  where id=p_conversation_id returning * into conversation;
  insert into public.support_status_history(conversation_id,previous_status,new_status,reason,changed_by)
  values(conversation.id,previous_status,'reopened',trim(p_reason),auth.uid());
  if conversation.assigned_user_id is not null then
    insert into public.notifications(user_id,type,title,body)
    values(conversation.assigned_user_id,'support_reopened','Atendimento reaberto',conversation.public_code);
  else
    insert into public.notifications(user_id,type,title,body)
    select distinct role.user_id,'support_reopened','Atendimento reaberto',conversation.public_code
    from public.user_roles role join public.profiles profile on profile.id=role.user_id and profile.status='active'
    where role.role='admin';
  end if;
  return conversation;
end;
$$;
;

-- 20261117130000_restrict_closed_support_create.sql
CREATE OR REPLACE FUNCTION public.create_support_conversation(p_category text, p_subject text, p_initial_message text, p_related_order_code text DEFAULT NULL::text, p_client_request_id uuid DEFAULT gen_random_uuid())
 RETURNS public.support_conversations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  existing_conversation public.support_conversations;
  new_conversation public.support_conversations;
  selected_category public.support_categories;
  selected_order_id uuid;
  category_slug text;
begin
  if auth.uid() is null or not private.is_active_user() or private.customer_account_is_closed() then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if char_length(trim(p_subject)) not between 5 and 120
     or char_length(trim(p_initial_message)) not between 10 and 4000 then
    raise exception 'invalid support content' using errcode = '22023';
  end if;

  select c.* into existing_conversation
  from public.support_conversations c
  where c.customer_id = auth.uid() and c.client_request_id = p_client_request_id;
  if found then return existing_conversation; end if;

  category_slug := case p_category
    when 'order' then 'pedido'
    when 'payment' then 'pagamento'
    when 'delivery' then 'entrega'
    when 'return' then 'troca-devolucao'
    when 'product' then 'produto'
    when 'account' then 'conta'
    when 'technical' then 'problema-tecnico'
    else 'outro'
  end;

  select c.* into selected_category
  from public.support_categories c
  where c.slug = category_slug and c.active = true;
  if not found then raise exception 'support category unavailable'; end if;

  if nullif(trim(coalesce(p_related_order_code, '')), '') is not null then
    select o.id into selected_order_id
    from public.orders o
    where o.public_code = trim(p_related_order_code) and o.customer_id = auth.uid();
    if not found then raise exception 'order not found' using errcode = '22023'; end if;
  end if;

  insert into public.support_conversations(
    customer_id, related_order_id, category_id, priority, origin, subject, client_request_id
  ) values (
    auth.uid(), selected_order_id, selected_category.id, selected_category.default_priority,
    'store', trim(p_subject), p_client_request_id
  ) returning * into new_conversation;

  insert into public.support_participants(conversation_id, user_id, participant_role)
  values (new_conversation.id, auth.uid(), 'customer');

  insert into public.support_messages(
    conversation_id, sender_id, sender_role, content_sanitized, is_internal_note
  ) values (
    new_conversation.id, auth.uid(), 'customer', trim(p_initial_message), false
  );

  insert into public.support_status_history(
    conversation_id, previous_status, new_status, reason, changed_by
  ) values (
    new_conversation.id, null, 'queued', 'Chamado criado pelo cliente', auth.uid()
  );

  insert into public.notifications(user_id, type, title, body)
  select distinct ur.user_id, 'support_new', 'Novo atendimento na fila', new_conversation.public_code
  from public.user_roles ur
  join public.profiles p on p.id = ur.user_id and p.status = 'active'
  where ur.role = 'admin';

  return new_conversation;
end;
$function$
;

-- 20261117170000_restrict_inactive_support_tables.sql
-- Restrictive policies apply alongside all existing customer and staff policies.
create policy "inactive support access revoked" on public.support_conversations as restrictive for all to authenticated using (private.is_active_user()) with check (private.is_active_user());
create policy "inactive support access revoked" on public.support_messages as restrictive for all to authenticated using (private.is_active_user()) with check (private.is_active_user());
create policy "inactive support access revoked" on public.support_participants as restrictive for all to authenticated using (private.is_active_user()) with check (private.is_active_user());
create policy "inactive support access revoked" on public.support_attachments as restrictive for all to authenticated using (private.is_active_user()) with check (private.is_active_user());
create policy "inactive support access revoked" on public.support_status_history as restrictive for all to authenticated using (private.is_active_user()) with check (private.is_active_user());
;

-- 20261117180000_restrict_inactive_customer_storage.sql
-- Keep access to other buckets governed by their existing policies.
create policy "inactive customer private storage access revoked"
on storage.objects as restrictive for all to authenticated
using (bucket_id <> 'customer-private' or private.is_active_user())
with check (bucket_id <> 'customer-private' or private.is_active_user());
;

-- 20261117190000_restrict_inactive_customer_records.sql
-- Require an active profile in addition to all existing ownership and staff policies.
create policy "inactive customer records revoked" on public.addresses as restrictive for all to authenticated using (private.is_active_user()) with check (private.is_active_user());
create policy "inactive customer records revoked" on public.carts as restrictive for all to authenticated using (private.is_active_user()) with check (private.is_active_user());
create policy "inactive customer records revoked" on public.cart_items as restrictive for all to authenticated using (private.is_active_user()) with check (private.is_active_user());
create policy "inactive customer records revoked" on public.notifications as restrictive for all to authenticated using (private.is_active_user()) with check (private.is_active_user());
create policy "inactive customer records revoked" on public.orders as restrictive for all to authenticated using (private.is_active_user()) with check (private.is_active_user());
create policy "inactive customer records revoked" on public.order_items as restrictive for all to authenticated using (private.is_active_user()) with check (private.is_active_user());
create policy "inactive customer records revoked" on public.payments as restrictive for all to authenticated using (private.is_active_user()) with check (private.is_active_user());
create policy "inactive customer records revoked" on public.returns as restrictive for all to authenticated using (private.is_active_user()) with check (private.is_active_user());
;

-- 20261117200000_restrict_inactive_admin_access.sql
-- Legacy policies call this helper directly, so require an active, open account.
create or replace function private.is_admin_user(target_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles role
    join public.profiles profile on profile.id = role.user_id
    where role.user_id = target_user_id and role.role = 'admin'::public.app_role
      and profile.status = 'active' and profile.account_closed_at is null
  );
$$;

-- Legacy policies on other tables query user_roles directly under caller RLS.
create policy "inactive role access revoked" on public.user_roles
as restrictive for all to authenticated
using (private.is_active_user()) with check (private.is_active_user());
;

-- 20261117210000_restrict_inactive_payment_references.sql
-- The server service role retains access; direct client queries require an active, open account.
create policy "inactive payment references revoked" on public.payment_provider_customers
as restrictive for all to authenticated
using (private.is_active_user() and not private.customer_account_is_closed())
with check (private.is_active_user() and not private.customer_account_is_closed());
create policy "inactive payment references revoked" on public.payment_provider_card_operations
as restrictive for all to authenticated
using (private.is_active_user() and not private.customer_account_is_closed())
with check (private.is_active_user() and not private.customer_account_is_closed());
;

-- 20261117220000_restrict_inactive_representative_records.sql
-- Ownership is used by the existing policies for sales, network and documents.
create or replace function private.owns_representative(requested_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select private.is_active_user() and not private.customer_account_is_closed() and exists (
    select 1 from public.representatives r where r.id=requested_id and r.user_id=auth.uid()
  );
$$;

-- These tables also have policies that compare user_id directly.
create policy "inactive representative access revoked" on public.representatives
as restrictive for all to authenticated using (private.is_active_user()) with check (private.is_active_user());
create policy "inactive representative access revoked" on public.representative_applications
as restrictive for all to authenticated using (private.is_active_user()) with check (private.is_active_user());
create policy "inactive representative access revoked" on public.representative_application_documents
as restrictive for all to authenticated using (private.is_active_user()) with check (private.is_active_user());
;

-- 20261118010000_minimize_published_help_snapshot.sql
-- Keep editorial metadata out of the published help projection.
create or replace view public.published_help_contents with (security_barrier=true) as
select content.id,version.snapshot#>>'{content,slug}' slug,version.snapshot#>>'{content,content_type}' content_type,
  coalesce((version.snapshot#>>'{content,priority}')::integer,0) priority,
  content.views_count,content.helpful_count,content.unhelpful_count,
  version.version,version.created_at as version_created_at,
  jsonb_build_object(
    'content',coalesce((
      select jsonb_object_agg(field.key, field.value)
      from jsonb_each(case when jsonb_typeof(version.snapshot->'content') = 'object'
        then version.snapshot->'content' else '{}'::jsonb end) as field(key,value)
      where field.key in ('slug','content_type','title','summary','body','keywords','synonyms',
        'audiences','priority','related_action','media')
    ), '{}'::jsonb),
    'category',jsonb_build_object('name',version.snapshot#>'{category,name}','slug',version.snapshot#>'{category,slug}'),
    'related',coalesce((
      select jsonb_agg(jsonb_build_object('slug',related.entry->'slug','title',related.entry->'title') order by related.position)
      from jsonb_array_elements(
        case when jsonb_typeof(version.snapshot->'related') = 'array'
          then version.snapshot->'related' else '[]'::jsonb end
      ) with ordinality as related(entry,position)
      join public.help_contents target on target.slug = related.entry->>'slug'
      join public.support_categories target_category on target_category.id = target.category_id
      join public.help_content_versions target_version on target_version.id = case
        when target.scheduled_version_id is not null and target.scheduled_at <= now() then target.scheduled_version_id
        else target.published_version_id end
      where (target.published_version_id is not null
          or (target.scheduled_version_id is not null and target.scheduled_at <= now()))
        and (target.expires_at is null or target.expires_at > now())
        and private.help_audience_allowed(target_version.snapshot#>'{content,audiences}', target_category.active and target_category.public_visible)
    ), '[]'::jsonb)
  ) snapshot,
  version.snapshot#>>'{category,name}' as category_name,version.snapshot#>>'{category,slug}' as category_slug
from public.help_contents content
join public.support_categories category on category.id = content.category_id
join public.help_content_versions version on version.id=case
  when content.scheduled_version_id is not null and content.scheduled_at<=now() then content.scheduled_version_id
  else content.published_version_id end
where (content.published_version_id is not null
    or (content.scheduled_version_id is not null and content.scheduled_at<=now()))
  and (content.expires_at is null or content.expires_at>now())
  and private.help_audience_allowed(version.snapshot#>'{content,audiences}', category.active and category.public_visible);

notify pgrst, 'reload schema';
;

-- 20261118020000_minimize_published_legal_snapshot.sql
-- Only fields intended for publication belong in the Data API projection.
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
    'document', coalesce((
      select jsonb_object_agg(field.key, field.value)
      from jsonb_each(case when jsonb_typeof(version.snapshot->'document') = 'object'
        then version.snapshot->'document' else '{}'::jsonb end) as field(key,value)
      where field.key in ('slug', 'public_title', 'summary', 'document_type', 'language', 'audience', 'requires_acceptance', 'requires_new_acceptance', 'display_locations')
    ), '{}'::jsonb),
    'sections', coalesce((
      select jsonb_agg(projected.item order by entry.position)
      from jsonb_array_elements(case when jsonb_typeof(version.snapshot->'sections') = 'array'
        then version.snapshot->'sections' else '[]'::jsonb end) with ordinality as entry(value,position)
      cross join lateral (
        select coalesce((
          select jsonb_object_agg(field.key, field.value)
          from jsonb_each(case when jsonb_typeof(entry.value) = 'object'
            then entry.value else '{}'::jsonb end) as field(key,value)
          where field.key in ('section_number', 'title', 'content', 'content_format', 'sort_order')
        ), '{}'::jsonb) as item
      ) projected
    ), '[]'::jsonb),
    'references', coalesce((
      select jsonb_agg(projected.item order by entry.position)
      from jsonb_array_elements(case when jsonb_typeof(version.snapshot->'references') = 'array'
        then version.snapshot->'references' else '[]'::jsonb end) with ordinality as entry(value,position)
      cross join lateral (
        select coalesce((
          select jsonb_object_agg(field.key, field.value)
          from jsonb_each(case when jsonb_typeof(entry.value) = 'object'
            then entry.value else '{}'::jsonb end) as field(key,value)
          where field.key in ('name', 'related_article', 'official_url', 'consulted_on')
        ), '{}'::jsonb) as item
      ) projected
    ), '[]'::jsonb),
    'company', coalesce((
      select jsonb_object_agg(field.key, field.value)
      from jsonb_each(case when jsonb_typeof(version.snapshot->'company') = 'object'
        then version.snapshot->'company' else '{}'::jsonb end) as field(key,value)
      where field.key in ('legal_name', 'trade_name', 'tax_id', 'address', 'email', 'phone', 'privacy_channel', 'data_protection_contact', 'support_channel')
    ), '{}'::jsonb)
  ) as snapshot,
  version.effective_from, version.effective_until, version.published_at
from public.legal_documents document
join public.legal_document_versions version on version.document_id = document.id
where document.public_visible
  and version.effective_from <= now()
  and (version.effective_until is null or version.effective_until > now())
order by document.id, version.version desc;

notify pgrst, 'reload schema';
;

-- 20261118030000_minimize_published_homepage_config.sql
-- Keep spreadsheet synchronization metadata out of the published homepage.
create or replace view public.published_homepage_sections
with (security_invoker = false) as
with selected_page_version as (
  select coalesce(
    (select scheduled.id
      from public.home_page_versions scheduled
      join public.home_pages page on page.id = scheduled.home_page_id
      where page.slug = 'principal'
        and scheduled.status = 'scheduled'
        and scheduled.scheduled_at <= now()
      order by scheduled.scheduled_at desc
      limit 1),
    (select published_version_id from public.home_pages where slug = 'principal')
  ) as id
), entries as (
  select entry
  from public.home_page_versions page_version,
    selected_page_version selected,
    jsonb_array_elements(page_version.manifest->'sections') entry
  where page_version.id = selected.id
)
select version.id as section_version_id,
  version.section_id,
  (entries.entry->>'position')::integer as position,
  jsonb_set(
    case
      when jsonb_typeof(version.snapshot->'content') = 'object' then
        (version.snapshot - 'internalName')
          #- '{content,configHash}'
          #- '{content,autoPublishAfterApproval}'
      else version.snapshot - 'internalName'
    end,
    '{items}',
    coalesce((
      select jsonb_agg(item - 'internalName' order by (item->>'sortOrder')::integer)
      from jsonb_array_elements(coalesce(version.snapshot->'items', '[]'::jsonb)) item
    ), '[]'::jsonb)
  ) as snapshot
from entries
join public.homepage_section_versions version
  on version.id = (entries.entry->>'versionId')::uuid
join public.homepage_sections section on section.id = version.section_id
where not (
    section.internal_name like 'xlsx:%'
    and (section.status in ('hidden', 'archived') or not section.active)
  )
  and (version.snapshot->>'startsAt' is null or (version.snapshot->>'startsAt')::timestamptz <= now())
  and (version.snapshot->>'endsAt' is null or (version.snapshot->>'endsAt')::timestamptz > now())
order by (entries.entry->>'position')::integer;

notify pgrst, 'reload schema';
;

-- 20261118040000_representative_resale_fiscal_rules.sql
-- Private, append-only fiscal rule evidence for the future resale integration.
-- No rules, approvals, or production-enabling flags are seeded by this migration.
create table private.representative_resale_fiscal_rule_versions (
  id uuid primary key default gen_random_uuid(),
  rule_key uuid not null,
  version integer not null check (version > 0),
  issuer_reference text not null check (length(btrim(issuer_reference)) between 1 and 120),
  product_fingerprint text not null check (product_fingerprint ~ '^[a-f0-9]{64}$'),
  origin_state text not null check (origin_state in ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO')),
  destination_state text not null check (destination_state in ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO')),
  person_type text not null check (person_type in ('individual','business')),
  icms_status text not null check (icms_status in ('taxpayer','registration_exempt','non_taxpayer')),
  final_consumer boolean not null,
  purpose text not null check (purpose = 'resale'),
  valid_from timestamptz not null,
  valid_until timestamptz not null,
  fiscal_parameters jsonb not null check (jsonb_typeof(fiscal_parameters) = 'object' and fiscal_parameters <> '{}'::jsonb),
  created_at timestamptz not null default now(),
  unique (rule_key, version),
  check (valid_from < valid_until)
);

create table private.representative_resale_fiscal_rule_approvals (
  rule_version_id uuid primary key references private.representative_resale_fiscal_rule_versions(id),
  approver_reference text not null check (length(btrim(approver_reference)) between 3 and 200),
  evidence_reference text not null check (length(btrim(evidence_reference)) between 10 and 500),
  approved_at timestamptz not null default now()
);

create table private.representative_resale_fiscal_rule_revocations (
  rule_version_id uuid primary key references private.representative_resale_fiscal_rule_approvals(rule_version_id),
  reason text not null check (length(btrim(reason)) between 10 and 500),
  revoked_at timestamptz not null default now()
);

alter table private.representative_resale_fiscal_rule_versions enable row level security;
alter table private.representative_resale_fiscal_rule_versions force row level security;
alter table private.representative_resale_fiscal_rule_approvals enable row level security;
alter table private.representative_resale_fiscal_rule_approvals force row level security;
alter table private.representative_resale_fiscal_rule_revocations enable row level security;
alter table private.representative_resale_fiscal_rule_revocations force row level security;
revoke all on private.representative_resale_fiscal_rule_versions,
  private.representative_resale_fiscal_rule_approvals,
  private.representative_resale_fiscal_rule_revocations from public, anon, authenticated, service_role;

create function private.protect_resale_fiscal_rule_history()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'resale_fiscal_history_is_append_only' using errcode = '23514';
end;
$$;
revoke all on function private.protect_resale_fiscal_rule_history() from public, anon, authenticated, service_role;
create trigger protect_resale_fiscal_rule_versions before update or delete on private.representative_resale_fiscal_rule_versions
  for each row execute function private.protect_resale_fiscal_rule_history();
create trigger protect_resale_fiscal_rule_approvals before update or delete on private.representative_resale_fiscal_rule_approvals
  for each row execute function private.protect_resale_fiscal_rule_history();
create trigger protect_resale_fiscal_rule_revocations before update or delete on private.representative_resale_fiscal_rule_revocations
  for each row execute function private.protect_resale_fiscal_rule_history();

-- This is a lookup only: a match does not authorize checkout, charging, NF-e,
-- or shipping. The future server-side integration must validate the snapshot,
-- recipient, approval evidence, and all release gates before using any rule.
-- A missing or ambiguous rule fails closed; no caller controls the lookup time.
create function public.find_representative_resale_fiscal_rule_candidate(
  p_issuer_reference text, p_product_fingerprint text, p_origin_state text,
  p_destination_state text, p_person_type text, p_icms_status text,
  p_final_consumer boolean, p_purpose text
) returns jsonb language sql stable security definer set search_path = '' as $$
  with candidates as (
    select r.id, r.rule_key, r.version, r.valid_from, r.valid_until, r.fiscal_parameters,
      a.approver_reference, a.evidence_reference, a.approved_at
    from private.representative_resale_fiscal_rule_versions r
    join private.representative_resale_fiscal_rule_approvals a on a.rule_version_id = r.id
    left join private.representative_resale_fiscal_rule_revocations x on x.rule_version_id = r.id
    where r.issuer_reference = p_issuer_reference and r.product_fingerprint = p_product_fingerprint
      and r.origin_state = p_origin_state and r.destination_state = p_destination_state
      and r.person_type = p_person_type and r.icms_status = p_icms_status
      and r.final_consumer = p_final_consumer and r.purpose = p_purpose
      and r.valid_from <= statement_timestamp() and statement_timestamp() < r.valid_until
      and a.approved_at <= statement_timestamp() and x.rule_version_id is null
  )
  select case when count(*) = 1 then (jsonb_agg(to_jsonb(candidates)) -> 0) else null end from candidates;
$$;
revoke all on function public.find_representative_resale_fiscal_rule_candidate(text,text,text,text,text,text,boolean,text)
  from public, anon, authenticated;
grant execute on function public.find_representative_resale_fiscal_rule_candidate(text,text,text,text,text,text,boolean,text)
  to service_role;

-- A server-derived identifier for the current kit fiscal composition. This is
-- not a fiscal approval and must not be accepted from a browser as evidence.
-- Missing, inactive, stale or incomplete catalog data fails closed.
create function public.read_representative_resale_product_fingerprint(p_variant_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  with kit as (
    select v.id, private.bling_kit_source_hash(v.id) as source_hash, m.pairs_per_sku,
      to_jsonb(m) as metadata
    from public.product_variants v
    join public.products p on p.id = v.product_id
    join private.bling_catalog_metadata m on m.product_id = p.id
    where v.id = p_variant_id and v.active and p.status = 'active' and m.pairs_per_sku > 1
  ), components as (
    select c.kit_variant_id, jsonb_agg(to_jsonb(c) order by c.position) as snapshot,
      sum(c.quantity_pairs) as pairs, bool_and(c.source_hash = kit.source_hash) as source_current
    from private.bling_kit_fiscal_components c join kit on kit.id = c.kit_variant_id
    group by c.kit_variant_id
  )
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    jsonb_build_object('version',1,'sourceHash',kit.source_hash,'metadata',kit.metadata,
      'components',components.snapshot)::text,'UTF8')),'hex')
  from kit join components on components.kit_variant_id = kit.id
  where kit.source_hash is not null and components.source_current is true and components.pairs = kit.pairs_per_sku;
$$;
revoke all on function public.read_representative_resale_product_fingerprint(uuid) from public, anon, authenticated;
grant execute on function public.read_representative_resale_product_fingerprint(uuid) to service_role;

-- The caller supplies an authenticated, independently verified recipient
-- context. This lookup derives the product fingerprint in the database and
-- remains informational: it never authorizes a sale or fiscal operation.
create function public.find_representative_resale_fiscal_rule_for_variant(
  p_variant_id uuid, p_issuer_reference text, p_origin_state text,
  p_destination_state text, p_person_type text, p_icms_status text,
  p_final_consumer boolean, p_purpose text
) returns jsonb language sql stable security definer set search_path = '' as $$
  select public.find_representative_resale_fiscal_rule_candidate(
    p_issuer_reference, public.read_representative_resale_product_fingerprint(p_variant_id),
    p_origin_state, p_destination_state, p_person_type, p_icms_status, p_final_consumer, p_purpose);
$$;
revoke all on function public.find_representative_resale_fiscal_rule_for_variant(uuid,text,text,text,text,text,boolean,text)
  from public, anon, authenticated;
grant execute on function public.find_representative_resale_fiscal_rule_for_variant(uuid,text,text,text,text,text,boolean,text)
  to service_role;
;

-- 20261118040100_representative_test_recipient_declaration.sql
-- A declaration is an unverified snapshot for an isolated TEST order. It is
-- not fiscal approval and creates no production payment, invoice or shipment.
create table private.kit_test_recipient_declarations (
  order_id uuid primary key references private.kit_test_transactions(order_id),
  actor_id uuid not null references public.profiles(id),
  schema_version integer not null check (schema_version = 1),
  declared_scenario jsonb not null,
  declared_at timestamptz not null default now(),
  check (jsonb_typeof(declared_scenario) = 'object')
);
alter table private.kit_test_recipient_declarations enable row level security;
alter table private.kit_test_recipient_declarations force row level security;
revoke all on private.kit_test_recipient_declarations from public, anon, authenticated, service_role;

create function private.protect_kit_test_recipient_declaration()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'kit_test_declaration_is_append_only' using errcode = '23514';
end;
$$;
revoke all on function private.protect_kit_test_recipient_declaration() from public, anon, authenticated, service_role;
create trigger protect_kit_test_recipient_declaration before update or delete on private.kit_test_recipient_declarations
  for each row execute function private.protect_kit_test_recipient_declaration();

create function public.create_kit_test_checkout_with_declaration(
  p_actor uuid, p_variant uuid, p_quantity integer, p_quote uuid,
  p_fingerprint text, p_key uuid, p_address uuid, p_scenario jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb; transaction_row private.kit_test_transactions; prior private.kit_test_recipient_declarations;
  snapshot_state text;
begin
  if jsonb_typeof(p_scenario) is distinct from 'object'
    or p_scenario - array['personType','purpose','icmsStatus','destinationState'] <> '{}'::jsonb
    or jsonb_typeof(p_scenario->'personType') is distinct from 'string'
    or jsonb_typeof(p_scenario->'purpose') is distinct from 'string'
    or jsonb_typeof(p_scenario->'icmsStatus') is distinct from 'string'
    or jsonb_typeof(p_scenario->'destinationState') is distinct from 'string'
    or p_scenario->>'personType' not in ('individual','business')
    or p_scenario->>'purpose' <> 'resale'
    or p_scenario->>'icmsStatus' not in ('taxpayer','registration_exempt','non_taxpayer','unknown')
    or p_scenario->>'destinationState' not in ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO') then
    raise exception 'invalid_kit_test_declaration' using errcode = '23514';
  end if;

  result := public.create_kit_test_checkout(p_actor,p_variant,p_quantity,p_quote,p_fingerprint,p_key,p_address);
  select * into transaction_row from private.kit_test_transactions
    where order_id = (result->>'orderId')::uuid and actor_id = p_actor for update;
  if not found then raise exception 'kit_test_declaration_access_denied' using errcode = '42501'; end if;
  select shipping_snapshot->'address'->>'state' into snapshot_state from public.kit_orders where id = transaction_row.order_id;
  if snapshot_state is distinct from p_scenario->>'destinationState' then
    raise exception 'kit_test_declaration_state_mismatch' using errcode = '23514';
  end if;
  select * into prior from private.kit_test_recipient_declarations where order_id = transaction_row.order_id;
  if found then
    if prior.actor_id is distinct from p_actor or prior.declared_scenario is distinct from p_scenario then
      raise exception 'kit_test_declaration_conflict' using errcode = '23514';
    end if;
  else
    if transaction_row.state <> 'reserved' or transaction_row.payment_started_at is not null then
      raise exception 'kit_test_declaration_too_late' using errcode = '23514';
    end if;
    insert into private.kit_test_recipient_declarations(order_id,actor_id,schema_version,declared_scenario)
      values(transaction_row.order_id,p_actor,1,p_scenario);
  end if;
  return result || jsonb_build_object('declarationState','unverified');
end;
$$;
revoke all on function public.create_kit_test_checkout_with_declaration(uuid,uuid,integer,uuid,text,uuid,uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.create_kit_test_checkout_with_declaration(uuid,uuid,integer,uuid,text,uuid,uuid,jsonb)
  to service_role;

create function public.read_kit_test_recipient_declaration(p_actor uuid,p_order uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('scenario',d.declared_scenario,'schemaVersion',d.schema_version,
    'declaredAt',d.declared_at,'verification','unverified')
  from private.kit_test_recipient_declarations d
  join private.kit_test_transactions t on t.order_id=d.order_id and t.actor_id=d.actor_id
  where d.order_id=p_order and d.actor_id=p_actor;
$$;
revoke all on function public.read_kit_test_recipient_declaration(uuid,uuid) from public, anon, authenticated;
grant execute on function public.read_kit_test_recipient_declaration(uuid,uuid) to service_role;
;

-- 20261118110000_representative_kit_shipping_checkout_quotes.sql
create table private.representative_kit_shipping_checkout_quotes (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id) on delete cascade,
  quantity integer not null check (quantity between 1 and 99),
  address_id uuid not null references public.addresses(id) on delete cascade,
  address_updated_at timestamptz not null,
  postal_code text not null check (postal_code ~ '^[0-9]{8}$'),
  cart_fingerprint text not null check (cart_fingerprint ~ '^[0-9a-f]{64}$'),
  service_id text not null check (length(service_id) between 1 and 50),
  service text not null check (length(btrim(service)) between 1 and 200),
  carrier text not null check (length(btrim(carrier)) between 1 and 200),
  amount_in_cents integer not null check (amount_in_cents >= 0),
  cost_in_cents integer not null check (cost_in_cents >= 0),
  estimated_days integer not null check (estimated_days between 0 and 365),
  packages jsonb not null check (jsonb_typeof(packages) = 'array'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null check (expires_at > created_at),
  used_at timestamptz
);
alter table private.representative_kit_shipping_checkout_quotes enable row level security;
alter table private.representative_kit_shipping_checkout_quotes force row level security;
revoke all on private.representative_kit_shipping_checkout_quotes from public, anon, authenticated, service_role;

create index representative_kit_shipping_quotes_actor_expiry
  on private.representative_kit_shipping_checkout_quotes(actor_id, expires_at);
create index representative_kit_shipping_quotes_variant
  on private.representative_kit_shipping_checkout_quotes(variant_id);
create index representative_kit_shipping_quotes_address
  on private.representative_kit_shipping_checkout_quotes(address_id);

create function public.issue_representative_kit_shipping_quote(
  p_actor uuid, p_variant uuid, p_quantity integer, p_address uuid, p_postal_code text,
  p_cart_fingerprint text, p_service_id text, p_service text, p_carrier text,
  p_amount_in_cents integer, p_cost_in_cents integer, p_estimated_days integer,
  p_packages jsonb, p_expires_at timestamptz
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  address_version timestamptz;
  issued private.representative_kit_shipping_checkout_quotes;
begin
  if p_expires_at is null or p_expires_at <= now() then
    return null;
  end if;
  select a.updated_at into address_version
    from public.addresses a
    join public.profiles p on p.id = a.user_id and p.status = 'active'
    join public.representatives r on r.user_id = a.user_id
    where a.id = p_address and a.user_id = p_actor and a.country = 'BR'
      and regexp_replace(a.postal_code, '[^0-9]', '', 'g') = p_postal_code
      and r.status in ('approved_waiting_kit', 'active', 'unqualified')
    for share of a;
  if not found then
    return null;
  end if;

  delete from private.representative_kit_shipping_checkout_quotes
    where actor_id = p_actor and expires_at <= now();
  insert into private.representative_kit_shipping_checkout_quotes (
    actor_id, variant_id, quantity, address_id, address_updated_at, postal_code, cart_fingerprint,
    service_id, service, carrier, amount_in_cents, cost_in_cents, estimated_days, packages, expires_at
  ) values (
    p_actor, p_variant, p_quantity, p_address, address_version, p_postal_code, p_cart_fingerprint,
    p_service_id, p_service, p_carrier, p_amount_in_cents, p_cost_in_cents, p_estimated_days,
    p_packages, least(p_expires_at, now() + interval '30 minutes')
  ) returning * into issued;

  return jsonb_build_object('id', issued.id, 'serviceId', issued.service_id, 'service', issued.service,
    'carrier', issued.carrier, 'amountInCents', issued.amount_in_cents, 'estimatedDays', issued.estimated_days,
    'expiresAt', issued.expires_at);
end;
$$;
revoke all on function public.issue_representative_kit_shipping_quote(uuid,uuid,integer,uuid,text,text,text,text,text,integer,integer,integer,jsonb,timestamptz)
  from public, anon, authenticated;
grant execute on function public.issue_representative_kit_shipping_quote(uuid,uuid,integer,uuid,text,text,text,text,text,integer,integer,integer,jsonb,timestamptz)
  to service_role;

-- Call within the order-creation transaction so a failed order rolls back consumption.
create function private.consume_representative_kit_shipping_quote(
  p_quote uuid, p_actor uuid, p_variant uuid, p_quantity integer, p_address uuid, p_cart_fingerprint text
) returns private.representative_kit_shipping_checkout_quotes language plpgsql set search_path = '' as $$
declare
  selected private.representative_kit_shipping_checkout_quotes;
begin
  perform 1 from public.addresses a
    join private.representative_kit_shipping_checkout_quotes q on q.address_id = a.id
    where q.id = p_quote and a.id = p_address and a.user_id = p_actor and a.country = 'BR'
      and a.updated_at = q.address_updated_at
      and regexp_replace(a.postal_code, '[^0-9]', '', 'g') = q.postal_code
    for share of a;
  if not found then
    return null;
  end if;

  update private.representative_kit_shipping_checkout_quotes q set used_at = now()
    where q.id = p_quote and q.actor_id = p_actor and q.variant_id = p_variant and q.quantity = p_quantity
      and q.address_id = p_address and q.cart_fingerprint = p_cart_fingerprint
      and q.expires_at > now() and q.used_at is null
    returning q.* into selected;
  return selected;
end;
$$;
revoke all on function private.consume_representative_kit_shipping_quote(uuid,uuid,uuid,integer,uuid,text)
  from public, anon, authenticated, service_role;
;

-- 20261118114500_restrict_representative_kits_to_mg.sql
-- Apply regional restrictions only to the representative kit channel.
alter table private.representative_resale_fiscal_rule_versions
  add constraint representative_resale_rule_mg_only
  check (origin_state = 'MG' and destination_state = 'MG') not valid;

alter table private.representative_kit_shipping_checkout_quotes
  add constraint representative_kit_shipping_quote_mg_only
  check (postal_code ~ '^3[0-9]{7}$') not valid;

create function private.guard_representative_kit_quote_mg()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.addresses a
    where a.id = new.address_id and a.user_id = new.actor_id
      and a.country = 'BR' and a.state = 'MG'
      and regexp_replace(a.postal_code, '[^0-9]', '', 'g') = new.postal_code
  ) then
    raise exception 'representative_kit_address_outside_mg' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_representative_kit_quote_mg() from public, anon, authenticated, service_role;
create trigger representative_kit_quote_mg
  before insert or update on private.representative_kit_shipping_checkout_quotes
  for each row execute function private.guard_representative_kit_quote_mg();

create function private.is_representative_kit_mg_snapshot(p_snapshot jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(p_snapshot->'address'->>'state' = 'MG'
    and regexp_replace(p_snapshot->'address'->>'postalCode', '[^0-9]', '', 'g') ~ '^3[0-9]{7}$', false);
$$;
revoke all on function private.is_representative_kit_mg_snapshot(jsonb) from public, anon, authenticated, service_role;

create function private.guard_representative_kit_shipping_snapshot_mg()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.shipping_snapshot->'address' is not null
    and not private.is_representative_kit_mg_snapshot(new.shipping_snapshot) then
    raise exception 'representative_kit_address_outside_mg' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_representative_kit_shipping_snapshot_mg() from public, anon, authenticated, service_role;
create trigger representative_kit_shipping_snapshot_mg
  before insert or update of shipping_snapshot on public.kit_orders
  for each row execute function private.guard_representative_kit_shipping_snapshot_mg();

-- Keep recovery and refunds available for existing transactions.
create or replace function public.claim_kit_test_creation(p_actor uuid,p_order uuid,p_fingerprint text,p_lock uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; tx private.kit_test_transactions;
begin
  result:=public.claim_kit_test_payment(p_actor,p_order,p_fingerprint,p_lock);
  select * into tx from private.kit_test_transactions where order_id=p_order for update;
  if tx.state<>'reserved' then raise exception 'kit_not_payable'; end if;
  if not exists(select 1 from public.kit_orders where id=p_order and shipping_snapshot->'address' is not null) then
    raise exception 'kit_address_required';
  end if;
  if not exists(select 1 from public.kit_orders where id=p_order and private.is_representative_kit_mg_snapshot(shipping_snapshot)) then
    raise exception 'representative_kit_address_outside_mg' using errcode='23514';
  end if;
  return result||jsonb_build_object('state',tx.state,'refundedInCents',tx.refunded_cents);
end;
$$;
;

-- 20261118143000_recheck_kit_quote_consumption.sql
-- Revalidate live eligibility while the eventual order transaction holds locks.
create or replace function private.consume_representative_kit_shipping_quote(
  p_quote uuid, p_actor uuid, p_variant uuid, p_quantity integer, p_address uuid, p_cart_fingerprint text
) returns private.representative_kit_shipping_checkout_quotes language plpgsql set search_path = '' as $$
declare
  selected private.representative_kit_shipping_checkout_quotes;
begin
  perform 1 from public.profiles p
    join public.representatives r on r.user_id = p.id
    where p.id = p_actor and p.status = 'active'
      and r.status in ('approved_waiting_kit', 'active', 'unqualified')
    for share of p, r;
  if not found then return null; end if;

  perform 1 from public.product_variants v
    join public.products p on p.id = v.product_id
    join private.bling_catalog_metadata m on m.product_id = p.id
    where v.id = p_variant and v.active and p.status = 'active' and m.pairs_per_sku > 1
    for share of v, p, m;
  if not found then return null; end if;

  perform 1 from public.addresses a
    join private.representative_kit_shipping_checkout_quotes q on q.address_id = a.id
    where q.id = p_quote and a.id = p_address and a.user_id = p_actor
      and a.country = 'BR' and a.state = 'MG' and q.postal_code ~ '^3[0-9]{7}$'
      and a.updated_at = q.address_updated_at
      and regexp_replace(a.postal_code, '[^0-9]', '', 'g') = q.postal_code
    for share of a;
  if not found then return null; end if;

  perform 1 from public.inventory i
    where i.variant_id = p_variant and p_quantity between 1 and 99
      and i.available_quantity >= p_quantity
    for update;
  if not found then return null; end if;

  update private.representative_kit_shipping_checkout_quotes q set used_at = now()
    where q.id = p_quote and q.actor_id = p_actor and q.variant_id = p_variant and q.quantity = p_quantity
      and q.address_id = p_address and q.cart_fingerprint = p_cart_fingerprint
      and q.expires_at > now() and q.used_at is null
    returning q.* into selected;
  return selected;
end;
$$;
revoke all on function private.consume_representative_kit_shipping_quote(uuid,uuid,uuid,integer,uuid,text)
  from public, anon, authenticated, service_role;
;

-- 20261118150000_representative_kit_commercial_orders.sql
-- Commercial kit orders use shared stock and a private lifecycle.
-- Release evidence is intentionally empty after migration.
create table private.representative_kit_checkout_approvals (
  actor_id uuid not null references public.profiles(id),
  rule_version_id uuid not null references private.representative_resale_fiscal_rule_approvals(rule_version_id),
  buyer_profile text not null check (buyer_profile in ('MG01', 'MG02')),
  buyer_fiscal_state text not null check (buyer_fiscal_state = 'MG'),
  origin_postal_code text not null check (origin_postal_code ~ '^3[0-9]{7}$'),
  buyer_evidence text not null check (length(btrim(buyer_evidence)) >= 10),
  operation_evidence text not null check (length(btrim(operation_evidence)) >= 10),
  stock_evidence text not null check (length(btrim(stock_evidence)) >= 10),
  homologation_evidence text not null check (length(btrim(homologation_evidence)) >= 10),
  valid_until timestamptz not null,
  revoked_at timestamptz,
  primary key (actor_id, rule_version_id)
);

alter table private.representative_kit_shipping_checkout_quotes
  add column origin_postal_code text check (origin_postal_code ~ '^3[0-9]{7}$'),
  add column merchandise_unit_cents bigint check (merchandise_unit_cents > 0),
  add column product_dimensions jsonb check (jsonb_typeof(product_dimensions) = 'array');

create table private.representative_kit_orders (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id),
  variant_id uuid not null references public.product_variants(id),
  quantity integer not null check (quantity between 1 and 99),
  quote_id uuid not null unique,
  address_id uuid not null,
  idempotency_key uuid not null,
  rule_version_id uuid not null,
  sku text not null,
  product_name text not null,
  unit_price_cents bigint not null check (unit_price_cents > 0),
  shipping_cents bigint not null check (shipping_cents >= 0),
  shipping_snapshot jsonb not null,
  state text not null default 'reserved' check (state in ('reserved','payment_pending','paid','cancelled','refunded','manual_review')),
  stock_state text not null default 'reserved' check (stock_state in ('reserved','sold','released')),
  payment_started_at timestamptz,
  provider_payment_id text unique,
  reserved_until timestamptz not null,
  created_at timestamptz not null default now(),
  unique (actor_id, idempotency_key),
  foreign key (actor_id, rule_version_id) references private.representative_kit_checkout_approvals(actor_id, rule_version_id),
  check (private.is_representative_kit_mg_snapshot(shipping_snapshot))
);
create index representative_kit_orders_variant on private.representative_kit_orders(variant_id);
create index representative_kit_orders_rule on private.representative_kit_orders(actor_id, rule_version_id);
create index representative_kit_orders_unstarted on private.representative_kit_orders(reserved_until)
  where state = 'reserved' and payment_started_at is null;
create index representative_kit_checkout_approvals_rule on private.representative_kit_checkout_approvals(rule_version_id);

alter table private.representative_kit_checkout_approvals enable row level security;
alter table private.representative_kit_checkout_approvals force row level security;
alter table private.representative_kit_orders enable row level security;
alter table private.representative_kit_orders force row level security;
revoke all on private.representative_kit_checkout_approvals, private.representative_kit_orders
  from public, anon, authenticated, service_role;

-- These values match the inputs used by resolveShippingProducts, in database units.
create function private.representative_kit_shipping_inputs(p_variant uuid)
returns table (price_cents bigint, dimensions jsonb)
language sql stable set search_path = '' as $$
  select round(coalesce(v.price_override, p.base_price) * 100)::bigint,
    jsonb_build_array(p.weight_grams, p.width_cm, p.height_cm, p.length_cm)
  from public.product_variants v join public.products p on p.id = v.product_id
  where v.id = p_variant and v.active and p.status = 'active';
$$;
revoke all on function private.representative_kit_shipping_inputs(uuid) from public, anon, authenticated, service_role;

-- The server passes the exact inputs used for the carrier call. Compare them
-- under catalog locks so a concurrent price or packing edit invalidates the result.
create function public.confirm_representative_kit_shipping_quote(
  p_actor uuid, p_variant uuid, p_quantity integer, p_address uuid, p_postal_code text,
  p_cart_fingerprint text, p_service_id text, p_service text, p_carrier text,
  p_amount_in_cents integer, p_cost_in_cents integer, p_estimated_days integer,
  p_packages jsonb, p_expires_at timestamptz, p_origin_postal_code text,
  p_unit_price_cents bigint, p_dimensions jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  issued jsonb;
begin
  if p_origin_postal_code is null or p_origin_postal_code !~ '^3[0-9]{7}$' then
    raise exception 'representative_kit_origin_outside_mg' using errcode = '23514';
  end if;
  perform 1 from public.product_variants v join public.products p on p.id = v.product_id
    where v.id = p_variant for share of v, p;
  if not exists (select 1 from private.representative_kit_shipping_inputs(p_variant) s
    where s.price_cents = p_unit_price_cents and s.price_cents > 0 and s.dimensions = p_dimensions) then
    raise exception 'kit_shipping_inputs_changed' using errcode = '23514';
  end if;
  issued := public.issue_representative_kit_shipping_quote(
    p_actor, p_variant, p_quantity, p_address, p_postal_code, p_cart_fingerprint,
    p_service_id, p_service, p_carrier, p_amount_in_cents, p_cost_in_cents,
    p_estimated_days, p_packages, p_expires_at
  );
  update private.representative_kit_shipping_checkout_quotes
    set origin_postal_code = p_origin_postal_code, merchandise_unit_cents = p_unit_price_cents,
      product_dimensions = p_dimensions
    where id = (issued ->> 'id')::uuid;
  return issued;
end;
$$;
revoke all on function public.confirm_representative_kit_shipping_quote(
  uuid,uuid,integer,uuid,text,text,text,text,text,integer,integer,integer,jsonb,timestamptz,text,bigint,jsonb
) from public, anon, authenticated;
grant execute on function public.confirm_representative_kit_shipping_quote(
  uuid,uuid,integer,uuid,text,text,text,text,text,integer,integer,integer,jsonb,timestamptz,text,bigint,jsonb
) to service_role;

create function private.find_representative_kit_checkout_approval(p_actor uuid, p_variant uuid, p_origin text)
returns uuid language sql stable set search_path = '' as $$
  with candidates as (
    select r.id
    from private.representative_kit_checkout_approvals a
    join private.representative_resale_fiscal_rule_versions r on r.id = a.rule_version_id
    join private.representative_resale_fiscal_rule_approvals e on e.rule_version_id = r.id
    left join private.representative_resale_fiscal_rule_revocations v on v.rule_version_id = r.id
    where a.actor_id = p_actor and a.revoked_at is null and a.valid_until > statement_timestamp()
      and a.origin_postal_code = p_origin and a.buyer_fiscal_state = 'MG'
      and e.approved_at <= statement_timestamp() and v.rule_version_id is null
      and r.origin_state = 'MG' and r.destination_state = 'MG' and r.person_type = 'business'
      and r.icms_status = 'taxpayer' and r.purpose = 'resale' and not r.final_consumer
      and r.fiscal_parameters ->> 'buyerProfile' = a.buyer_profile
      and r.valid_from <= statement_timestamp() and statement_timestamp() < r.valid_until
      and r.product_fingerprint = public.read_representative_resale_product_fingerprint(p_variant)
  )
  select case when count(*) = 1 then (array_agg(id))[1] end from candidates;
$$;
revoke all on function private.find_representative_kit_checkout_approval(uuid,uuid,text)
  from public, anon, authenticated, service_role;

create function private.representative_kit_order_summary(o private.representative_kit_orders)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('orderId', o.id, 'state', o.state, 'variantId', o.variant_id,
    'quantity', o.quantity, 'amountInCents', o.unit_price_cents * o.quantity + o.shipping_cents,
    'shippingInCents', o.shipping_cents, 'reservedUntil', o.reserved_until);
$$;
revoke all on function private.representative_kit_order_summary(private.representative_kit_orders)
  from public, anon, authenticated, service_role;

create function public.reserve_representative_kit_order(
  p_actor uuid, p_variant uuid, p_quantity integer, p_quote uuid, p_address uuid, p_key uuid,
  p_origin_postal_code text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  order_row private.representative_kit_orders;
  quote private.representative_kit_shipping_checkout_quotes;
  cart_fingerprint text;
  address_row public.addresses;
  rule_id uuid;
  price_cents bigint;
  current_dimensions jsonb;
  selected_sku text;
  selected_name text;
begin
  if p_actor is null or p_variant is null or p_quote is null or p_address is null or p_key is null
    or p_quantity is null or p_quantity not between 1 and 99 then
    raise exception 'invalid_kit_request' using errcode = '22023';
  end if;

  perform 1 from public.profiles p join public.representatives r on r.user_id = p.id
    where p.id = p_actor and p.status = 'active' and r.status in ('approved_waiting_kit','active','unqualified')
    for share of p, r;
  if not found then raise exception 'kit_access_denied' using errcode = '42501'; end if;

  perform pg_advisory_xact_lock(hashtextextended('representative-kit:' || p_actor::text || ':' || p_key::text, 0));
  select * into order_row from private.representative_kit_orders
    where actor_id = p_actor and idempotency_key = p_key;
  if found then
    if (order_row.variant_id, order_row.quantity, order_row.quote_id, order_row.address_id)
      is distinct from (p_variant, p_quantity, p_quote, p_address) then
      raise exception 'kit_idempotency_conflict' using errcode = '23505';
    end if;
    return private.representative_kit_order_summary(order_row);
  end if;

  select q.cart_fingerprint into cart_fingerprint from private.representative_kit_shipping_checkout_quotes q
    where q.id = p_quote and q.actor_id = p_actor;
  quote := private.consume_representative_kit_shipping_quote(
    p_quote, p_actor, p_variant, p_quantity, p_address, cart_fingerprint);
  if quote.id is null or quote.expires_at <= clock_timestamp() or p_origin_postal_code is null
    or quote.origin_postal_code is distinct from p_origin_postal_code then
    raise exception 'kit_quote_unavailable' using errcode = '23514';
  end if;

  select s.price_cents, s.dimensions, v.sku, p.name
    into price_cents, current_dimensions, selected_sku, selected_name
    from private.representative_kit_shipping_inputs(p_variant) s
    join public.product_variants v on v.id = p_variant join public.products p on p.id = v.product_id;
  if quote.merchandise_unit_cents is null or quote.product_dimensions is null
    or quote.merchandise_unit_cents is distinct from price_cents
    or quote.product_dimensions is distinct from current_dimensions then
    raise exception 'kit_shipping_inputs_changed' using errcode = '23514';
  end if;

  rule_id := private.find_representative_kit_checkout_approval(p_actor, p_variant, p_origin_postal_code);
  if rule_id is null then raise exception 'resale_not_homologated' using errcode = '23514'; end if;

  select * into strict address_row from public.addresses where id = p_address;
  update public.inventory set available_quantity = available_quantity - p_quantity,
    reserved_quantity = reserved_quantity + p_quantity, version = version + 1, updated_at = now()
    where variant_id = p_variant and available_quantity >= p_quantity;
  if not found then raise exception 'kit_stock_unavailable' using errcode = '23514'; end if;

  insert into private.representative_kit_orders (
    actor_id, variant_id, quantity, quote_id, address_id, idempotency_key, rule_version_id,
    sku, product_name, unit_price_cents, shipping_cents, shipping_snapshot, reserved_until
  ) values (
    p_actor, p_variant, p_quantity, p_quote, p_address, p_key, rule_id, selected_sku, selected_name,
    price_cents, quote.amount_in_cents,
    jsonb_build_object('provider', 'melhorenvio', 'originPostalCode', quote.origin_postal_code,
      'serviceId', quote.service_id, 'service', quote.service, 'carrier', quote.carrier,
      'packages', quote.packages, 'costInCents', quote.cost_in_cents, 'estimatedDays', quote.estimated_days,
      'address', jsonb_build_object('state', address_row.state, 'postalCode', quote.postal_code,
        'version', address_row.updated_at)),
    least(quote.expires_at, clock_timestamp() + interval '15 minutes')
  ) returning * into order_row;
  return private.representative_kit_order_summary(order_row);
end;
$$;
revoke all on function public.reserve_representative_kit_order(uuid,uuid,integer,uuid,uuid,uuid,text)
  from public, anon, authenticated;
grant execute on function public.reserve_representative_kit_order(uuid,uuid,integer,uuid,uuid,uuid,text)
  to service_role;

-- Recovery only releases a hold while no provider write could be in flight.
create function public.cancel_unstarted_representative_kit_order(p_actor uuid, p_order uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  order_row private.representative_kit_orders;
begin
  select * into order_row from private.representative_kit_orders where id = p_order for update;
  if not found or (p_actor is not null and order_row.actor_id <> p_actor) then return false; end if;
  if order_row.state = 'cancelled' then return true; end if;
  if order_row.state <> 'reserved' or order_row.stock_state <> 'reserved'
    or order_row.payment_started_at is not null
    or (p_actor is null and order_row.reserved_until > clock_timestamp()) then return false; end if;

  update public.inventory set available_quantity = available_quantity + order_row.quantity,
    reserved_quantity = reserved_quantity - order_row.quantity, version = version + 1, updated_at = now()
    where variant_id = order_row.variant_id and reserved_quantity >= order_row.quantity;
  if not found then raise exception 'kit_stock_inconsistent' using errcode = '23514'; end if;
  update private.representative_kit_orders set state = 'cancelled', stock_state = 'released' where id = p_order;
  return true;
end;
$$;
revoke all on function public.cancel_unstarted_representative_kit_order(uuid,uuid) from public, anon, authenticated;
grant execute on function public.cancel_unstarted_representative_kit_order(uuid,uuid) to service_role;
;

-- 20261118153000_representative_kit_commercial_payments.sql
alter table private.representative_kit_checkout_approvals
  add column buyer_document text check (buyer_document ~ '^[0-9]{14}$'),
  add column buyer_legal_name text check (length(btrim(buyer_legal_name)) between 2 and 200);

alter table private.representative_kit_orders
  add column payment_expires_at timestamptz,
  add column cancellation_requested_at timestamptz,
  add column payment_checked_at timestamptz not null default now(),
  add column paid_at timestamptz;

create index representative_kit_payment_recovery on private.representative_kit_orders(payment_checked_at)
  where payment_started_at is not null and state in ('reserved','payment_pending');

create table private.representative_kit_provider_refunds (
  provider_refund_id text primary key,
  order_id uuid not null references private.representative_kit_orders(id),
  amount_cents bigint not null check (amount_cents > 0),
  reconciled_at timestamptz not null default now()
);
create index representative_kit_provider_refunds_order on private.representative_kit_provider_refunds(order_id);
alter table private.representative_kit_provider_refunds enable row level security;
alter table private.representative_kit_provider_refunds force row level security;
revoke all on private.representative_kit_provider_refunds from public, anon, authenticated, service_role;

create function private.representative_kit_payment_allowed(o private.representative_kit_orders)
returns boolean language sql stable set search_path = '' as $$
  select coalesce(private.find_representative_kit_checkout_approval(o.actor_id, o.variant_id,
    o.shipping_snapshot ->> 'originPostalCode') = o.rule_version_id, false)
  and exists (
    select 1 from public.profiles p join public.representatives r on r.user_id = p.id
    join public.addresses a on a.user_id = p.id
    where p.id = o.actor_id and p.status = 'active' and r.status in ('approved_waiting_kit','active','unqualified')
      and a.id = o.address_id and a.state = 'MG' and a.country = 'BR'
      and a.updated_at = (o.shipping_snapshot -> 'address' ->> 'version')::timestamptz
      and regexp_replace(a.postal_code, '[^0-9]', '', 'g') = o.shipping_snapshot -> 'address' ->> 'postalCode'
  );
$$;
revoke all on function private.representative_kit_payment_allowed(private.representative_kit_orders)
  from public, anon, authenticated, service_role;

create function public.read_representative_kit_payment(p_actor uuid, p_order uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select private.representative_kit_order_summary(o) ||
    jsonb_build_object('providerPaymentId', o.provider_payment_id, 'startedAt', o.payment_started_at,
      'cancellationRequested', o.cancellation_requested_at is not null,
      'customerCanPay', o.state = 'payment_pending' and private.representative_kit_payment_allowed(o))
  from private.representative_kit_orders o where o.id = p_order and o.actor_id = p_actor;
$$;

-- Exactly one HTTP request is allowed to create a payment. Uncertain writes are
-- recovered by reference and never lead to a second charge attempt.
create function public.claim_representative_kit_pix(p_actor uuid, p_order uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  o private.representative_kit_orders;
  a private.representative_kit_checkout_approvals;
begin
  select * into o from private.representative_kit_orders where id = p_order and actor_id = p_actor for update;
  if not found then raise exception 'kit_access_denied' using errcode = '42501'; end if;
  if o.payment_started_at is not null then return null; end if;
  if o.state <> 'reserved' or o.reserved_until <= clock_timestamp() or not private.representative_kit_payment_allowed(o) then
    raise exception 'resale_payment_blocked' using errcode = '23514';
  end if;
  select * into a from private.representative_kit_checkout_approvals
    where actor_id = o.actor_id and rule_version_id = o.rule_version_id for share;
  if a.buyer_document is null or a.buyer_legal_name is null or a.revoked_at is not null or a.valid_until <= clock_timestamp() then
    raise exception 'resale_payment_blocked' using errcode = '23514';
  end if;
  update private.representative_kit_orders set payment_started_at = clock_timestamp(),
    payment_checked_at = clock_timestamp(), payment_expires_at = clock_timestamp() + interval '30 minutes'
    where id = p_order returning * into o;
  return private.representative_kit_order_summary(o) || jsonb_build_object(
    'buyerDocument', a.buyer_document, 'buyerName', a.buyer_legal_name, 'expiresAt', o.payment_expires_at);
end;
$$;

create function public.request_representative_kit_payment_cancellation(p_actor uuid, p_order uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  o private.representative_kit_orders;
begin
  select * into o from private.representative_kit_orders where actor_id = p_actor and id = p_order for update;
  if not found then return null; end if;
  if o.payment_started_at is null then
    perform public.cancel_unstarted_representative_kit_order(p_actor,p_order);
  elsif o.state in ('reserved','payment_pending') then
    update private.representative_kit_orders set cancellation_requested_at = coalesce(cancellation_requested_at, now())
      where id = p_order;
  end if;
  return public.read_representative_kit_payment(p_actor, p_order);
end;
$$;

create function public.settle_representative_kit_payment(
  p_order uuid, p_payment_id text, p_reference text, p_amount bigint, p_currency text,
  p_status text, p_paid_at timestamptz, p_refunds jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  o private.representative_kit_orders;
  refund jsonb;
  refund_total bigint;
  refunded_now bigint;
  next_state text;
  next_stock text;
  stock_available integer;
  stock_reserved integer;
begin
  select * into o from private.representative_kit_orders where id = p_order for update;
  if not found or o.payment_started_at is null or p_reference is distinct from ('KITMG-' || p_order::text)
    or p_amount is distinct from (o.unit_price_cents * o.quantity + o.shipping_cents)
    or p_currency is distinct from 'BRL' or p_payment_id is null or p_payment_id !~ '^[0-9]{1,30}$'
    or (o.provider_payment_id is not null and o.provider_payment_id <> p_payment_id)
    or p_status is null or jsonb_typeof(p_refunds) is distinct from 'array' or jsonb_array_length(p_refunds) > 100 then
    raise exception 'kit_payment_identity_mismatch' using errcode = '23514';
  end if;

  for refund in select value from jsonb_array_elements(p_refunds) loop
    if coalesce(refund ->> 'id', '') !~ '^[0-9]{1,30}$' or coalesce(refund ->> 'amountInCents','') !~ '^[0-9]{1,15}$' then
      raise exception 'kit_refund_identity_mismatch' using errcode = '23514';
    end if;
    refunded_now := (refund ->> 'amountInCents')::bigint;
    insert into private.representative_kit_provider_refunds(provider_refund_id,order_id,amount_cents)
      values (refund ->> 'id',p_order,refunded_now) on conflict do nothing;
    if not exists (select 1 from private.representative_kit_provider_refunds r
      where r.provider_refund_id = refund ->> 'id' and r.order_id = p_order and r.amount_cents = refunded_now) then
      raise exception 'kit_refund_identity_mismatch' using errcode = '23514';
    end if;
  end loop;
  select coalesce(sum(amount_cents),0) into refund_total from private.representative_kit_provider_refunds where order_id = p_order;
  if refund_total > p_amount then raise exception 'kit_refund_amount_mismatch' using errcode = '23514'; end if;

  next_state := o.state;
  next_stock := o.stock_state;
  if refund_total = p_amount then
    next_state := 'refunded';
    if o.stock_state = 'reserved' then next_stock := 'released'; end if;
  elsif o.state in ('reserved','payment_pending') then
    if p_status = 'approved' and refund_total = 0 and p_paid_at is not null and private.representative_kit_payment_allowed(o) then
      next_state := 'paid';
      next_stock := 'sold';
    elsif p_status in ('cancelled','expired','rejected') and refund_total = 0 then
      next_state := 'cancelled';
      next_stock := 'released';
    elsif p_status in ('pending','in_process') and refund_total = 0 then
      next_state := 'payment_pending';
    else
      next_state := 'manual_review';
    end if;
  elsif (o.state = 'cancelled' and p_status in ('approved','refunded','charged_back'))
    or (o.state = 'paid' and (p_status in ('cancelled','refunded','charged_back','in_mediation') or refund_total > 0)) then
    next_state := 'manual_review';
  end if;

  if o.stock_state = 'reserved' and next_stock <> 'reserved' then
    update public.inventory set reserved_quantity = reserved_quantity - o.quantity,
      available_quantity = available_quantity + case when next_stock = 'released' then o.quantity else 0 end,
      version = version + 1, updated_at = now()
      where variant_id = o.variant_id and reserved_quantity >= o.quantity
      returning available_quantity,reserved_quantity into stock_available,stock_reserved;
    if not found then raise exception 'kit_stock_inconsistent' using errcode = '23514'; end if;
    if next_stock = 'sold' then
      insert into public.inventory_movements(variant_id,movement_type,quantity,previous_quantity,new_quantity,
        reason,reference_type,reference_id,performed_by)
      values (o.variant_id,'sale',-o.quantity,stock_available+stock_reserved+o.quantity,stock_available+stock_reserved,
        'Pagamento confirmado de kit de revenda MG','representative_kit_order',p_order,o.actor_id);
    end if;
  end if;

  update private.representative_kit_orders set state = next_state, stock_state = next_stock,
    provider_payment_id = p_payment_id, payment_checked_at = clock_timestamp(),
    paid_at = coalesce(paid_at, case when p_status = 'approved' then p_paid_at end)
    where id = p_order returning * into o;
  return private.representative_kit_order_summary(o) || jsonb_build_object('refundedInCents',refund_total);
end;
$$;

create function public.due_representative_kit_payments()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(due)),'[]'::jsonb) from (
    select id as "orderId", provider_payment_id as "providerPaymentId", payment_started_at as "startedAt",
      payment_expires_at as "expiresAt", cancellation_requested_at is not null as "cancellationRequested"
    from private.representative_kit_orders
    where (state = 'reserved' and payment_started_at is null and reserved_until <= now())
      or (state in ('reserved','payment_pending') and payment_started_at is not null
        and payment_checked_at < now() - interval '1 minute')
    order by payment_checked_at,id limit 10
  ) due;
$$;

create function public.defer_representative_kit_payment_check(p_order uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update private.representative_kit_orders set payment_checked_at = clock_timestamp()
    where id = p_order and state in ('reserved','payment_pending');
  return found;
end;
$$;

revoke all on function public.read_representative_kit_payment(uuid,uuid),
  public.claim_representative_kit_pix(uuid,uuid), public.request_representative_kit_payment_cancellation(uuid,uuid),
  public.settle_representative_kit_payment(uuid,text,text,bigint,text,text,timestamptz,jsonb),
  public.due_representative_kit_payments(), public.defer_representative_kit_payment_check(uuid)
  from public, anon, authenticated;
grant execute on function public.read_representative_kit_payment(uuid,uuid),
  public.claim_representative_kit_pix(uuid,uuid), public.request_representative_kit_payment_cancellation(uuid,uuid),
  public.settle_representative_kit_payment(uuid,text,text,bigint,text,text,timestamptz,jsonb),
  public.due_representative_kit_payments(), public.defer_representative_kit_payment_check(uuid)
  to service_role;
;

-- 20261118160000_representative_kit_fulfillment.sql
alter table private.representative_kit_checkout_approvals
  add column buyer_state_registration text check (buyer_state_registration ~ '^[0-9]{2,14}$');

-- An operator links the Bling sale and NF-e IDs after the paid order enters
-- fulfillment. Provider readback is the only path to fiscal clearance.
create table private.representative_kit_fulfillment (
  order_id uuid primary key references private.representative_kit_orders(id),
  bling_sale_id bigint not null unique check (bling_sale_id > 0),
  bling_invoice_id bigint not null unique check (bling_invoice_id > 0),
  invoice_access_key text unique check (invoice_access_key ~ '^31[0-9]{42}$'),
  invoice_protocol text unique check (invoice_protocol ~ '^[0-9]{15}$'),
  invoice_xml_sha256 text check (invoice_xml_sha256 ~ '^[0-9a-f]{64}$'),
  invoice_confirmed_at timestamptz,
  shipment_id text unique check (shipment_id ~ '^[A-Za-z0-9-]{1,100}$'),
  shipment_status text check (shipment_status in ('pending','ready','label_created','dispatched','in_transit','delayed','delivered','returned','cancelled')),
  shipment_rank integer not null default 0,
  tracking_code text check (tracking_code ~ '^[A-Za-z0-9-]{1,80}$'),
  checked_at timestamptz,
  check ((invoice_access_key is null and invoice_protocol is null and invoice_xml_sha256 is null)
    or (invoice_access_key is not null and invoice_protocol is not null and invoice_xml_sha256 is not null))
);
create index representative_kit_fulfillment_due on private.representative_kit_fulfillment(checked_at nulls first);
alter table private.representative_kit_fulfillment enable row level security;
alter table private.representative_kit_fulfillment force row level security;
revoke all on private.representative_kit_fulfillment from public, anon, authenticated, service_role;

create function public.due_representative_kit_fulfillment()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(due)),'[]'::jsonb) from (
    select f.order_id as "orderId", f.bling_sale_id as "saleId", f.bling_invoice_id as "invoiceId",
      f.shipment_id as "shipmentId", f.shipment_status as "shipmentStatus", o.variant_id as "variantId",
      o.sku, o.product_name as "productName", o.quantity, o.paid_at as "paidAt",
      o.unit_price_cents as "unitPriceInCents", o.shipping_cents as "shippingInCents",
      o.unit_price_cents * o.quantity + o.shipping_cents as "amountInCents",
      o.shipping_snapshot ->> 'serviceId' as "serviceId",
      o.shipping_snapshot ->> 'originPostalCode' as "originPostalCode",
      o.shipping_snapshot -> 'address' ->> 'postalCode' as "postalCode",
      a.buyer_profile as "buyerProfile", a.buyer_document as "buyerDocument", a.buyer_state_registration as "buyerStateRegistration",
      r.fiscal_parameters as "fiscalParameters"
    from private.representative_kit_fulfillment f
    join private.representative_kit_orders o on o.id = f.order_id
    join private.representative_kit_checkout_approvals a on a.actor_id = o.actor_id and a.rule_version_id = o.rule_version_id
    join private.representative_resale_fiscal_rule_versions r on r.id = o.rule_version_id
    where o.state = 'paid' and o.stock_state = 'sold' and private.representative_kit_payment_allowed(o)
      and coalesce(f.shipment_status,'pending') not in ('returned','cancelled','delivered')
      and (f.checked_at is null or f.checked_at < now() - interval '15 minutes')
      and not exists(select 1 from private.bling_order_links b
        where b.invoice_id = f.bling_invoice_id or b.external_order_id = f.bling_sale_id)
    order by f.checked_at nulls first, f.order_id limit 3
  ) due;
$$;

create function public.record_representative_kit_authorized_invoice(
  p_order uuid, p_sale bigint, p_invoice bigint, p_key text, p_protocol text, p_sha256 text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  o private.representative_kit_orders;
begin
  select * into o from private.representative_kit_orders where id = p_order for update;
  if not found or o.state <> 'paid' or o.stock_state <> 'sold' or not private.representative_kit_payment_allowed(o)
    or p_key is null or p_key !~ '^31[0-9]{42}$' or substr(p_key,21,5) <> '55002'
    or p_protocol is null or p_protocol !~ '^[0-9]{15}$'
    or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then return false; end if;
  update private.representative_kit_fulfillment set invoice_access_key = p_key, invoice_protocol = p_protocol,
    invoice_xml_sha256 = p_sha256, invoice_confirmed_at = clock_timestamp()
    where order_id = p_order and bling_sale_id = p_sale and bling_invoice_id = p_invoice
      and (invoice_access_key is null or (invoice_access_key = p_key and invoice_protocol = p_protocol and invoice_xml_sha256 = p_sha256))
      and not exists (select 1 from private.bling_order_links b
        where b.invoice_id = p_invoice or b.external_order_id = p_sale or b.invoice_access_key = p_key);
  return found;
end;
$$;

create function public.record_representative_kit_tracking(
  p_order uuid, p_shipment text, p_invoice_key text, p_status text, p_tracking text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  o private.representative_kit_orders;
  next_rank integer;
begin
  select * into o from private.representative_kit_orders where id = p_order for update;
  if not found or o.state <> 'paid' or o.stock_state <> 'sold' or not private.representative_kit_payment_allowed(o)
    or p_invoice_key is null then return false; end if;
  next_rank := case p_status when 'pending' then 0 when 'ready' then 1 when 'label_created' then 2
    when 'dispatched' then 4 when 'in_transit' then 5 when 'delayed' then 5 when 'delivered' then 7
    when 'returned' then 8 when 'cancelled' then 8 else null end;
  if next_rank is null then return false; end if;
  update private.representative_kit_fulfillment set shipment_status = p_status, shipment_rank = next_rank,
    tracking_code = coalesce(nullif(p_tracking,''),tracking_code), checked_at = clock_timestamp()
    where order_id = p_order and shipment_id = p_shipment and invoice_access_key = p_invoice_key
      and invoice_confirmed_at > clock_timestamp() - interval '15 minutes'
      and shipment_rank <= next_rank and (shipment_rank < 8 or shipment_status = p_status);
  return found;
end;
$$;

create function public.finish_representative_kit_fulfillment_check(p_order uuid, p_clearance_current boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update private.representative_kit_fulfillment set checked_at = clock_timestamp(),
    invoice_confirmed_at = case when p_clearance_current is true then invoice_confirmed_at else null end
    where order_id = p_order;
  return found;
end;
$$;

create function public.read_representative_kit_tracking(p_actor uuid, p_order uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('status',f.shipment_status,'trackingCode',f.tracking_code)
  from private.representative_kit_orders o join private.representative_kit_fulfillment f on f.order_id = o.id
  where o.id = p_order and o.actor_id = p_actor and f.shipment_status is not null;
$$;

revoke all on function public.due_representative_kit_fulfillment(),
  public.record_representative_kit_authorized_invoice(uuid,bigint,bigint,text,text,text),
  public.record_representative_kit_tracking(uuid,text,text,text,text),
  public.finish_representative_kit_fulfillment_check(uuid,boolean), public.read_representative_kit_tracking(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.due_representative_kit_fulfillment(),
  public.record_representative_kit_authorized_invoice(uuid,bigint,bigint,text,text,text),
  public.record_representative_kit_tracking(uuid,text,text,text,text),
  public.finish_representative_kit_fulfillment_check(uuid,boolean), public.read_representative_kit_tracking(uuid,uuid)
  to service_role;
;

-- 20261118163000_representative_kit_refunds.sql
-- Only a recorded operational decision can start a refund. Buyer endpoints
-- cannot issue one. Refunds and physical returns are distinct events.
create table private.representative_kit_refund_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references private.representative_kit_orders(id),
  amount_cents bigint not null check (amount_cents > 0),
  reason text not null check (reason in ('undispatched_cancellation', 'accepted_return')),
  operational_evidence text not null check (length(btrim(operational_evidence)) >= 10),
  fiscal_evidence text not null check (length(btrim(fiscal_evidence)) >= 10),
  original_invoice_key text check (original_invoice_key ~ '^31[0-9]{42}$'),
  return_invoice_key text unique check (return_invoice_key ~ '^31[0-9]{42}$'),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  checked_at timestamptz,
  baseline_refund_ids text[],
  provider_ack_id text unique check (provider_ack_id ~ '^[0-9]{1,30}$'),
  provider_refund_id text unique references private.representative_kit_provider_refunds(provider_refund_id),
  check (reason <> 'accepted_return' or (original_invoice_key is not null and return_invoice_key is not null
    and original_invoice_key <> return_invoice_key))
);
create unique index representative_kit_one_open_refund on private.representative_kit_refund_requests(order_id)
  where provider_refund_id is null;
create index representative_kit_refund_requests_order on private.representative_kit_refund_requests(order_id);
alter table private.representative_kit_refund_requests enable row level security;
alter table private.representative_kit_refund_requests force row level security;
revoke all on private.representative_kit_refund_requests from public, anon, authenticated, service_role;

create function public.due_representative_kit_refunds()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(due)),'[]'::jsonb) from (
    select r.id as "refundId", o.id as "orderId", o.provider_payment_id as "paymentId",
      r.amount_cents as "amountInCents", r.started_at as "startedAt", r.provider_ack_id as "providerAckId"
    from private.representative_kit_refund_requests r join private.representative_kit_orders o on o.id = r.order_id
    where r.provider_refund_id is null and o.provider_payment_id is not null
      and (r.checked_at is null or r.checked_at < now() - interval '5 minutes')
    order by r.checked_at nulls first, r.id limit 3
  ) due;
$$;

create function public.claim_representative_kit_refund(p_refund uuid, p_baseline_ids text[])
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  r private.representative_kit_refund_requests;
  o private.representative_kit_orders;
  f private.representative_kit_fulfillment;
  confirmed_ids text[];
  refunded bigint;
begin
  select * into r from private.representative_kit_refund_requests where id = p_refund for update;
  if not found or r.started_at is not null or r.provider_refund_id is not null then return false; end if;
  select * into o from private.representative_kit_orders where id = r.order_id for update;
  if o.state not in ('paid','manual_review') or o.provider_payment_id is null then return false; end if;
  select * into f from private.representative_kit_fulfillment where order_id = r.order_id for update;
  select coalesce(array_agg(provider_refund_id order by provider_refund_id),'{}'), coalesce(sum(amount_cents),0)
    into confirmed_ids,refunded from private.representative_kit_provider_refunds where order_id = r.order_id;
  if p_baseline_ids is distinct from confirmed_ids or refunded + r.amount_cents > o.unit_price_cents * o.quantity + o.shipping_cents
    or r.original_invoice_key is distinct from f.invoice_access_key then return false; end if;
  if r.reason = 'undispatched_cancellation' and (coalesce(f.shipment_rank, 0) >= 4 or
    (f.shipment_id is not null and f.shipment_status is distinct from 'cancelled') or f.invoice_confirmed_at is not null)
    then return false; end if;
  update private.representative_kit_refund_requests set started_at = clock_timestamp(), checked_at = clock_timestamp(),
    baseline_refund_ids = confirmed_ids where id = p_refund;
  update private.representative_kit_orders set state = 'manual_review' where id = r.order_id;
  return true;
end;
$$;

create function public.finish_representative_kit_refund(p_refund uuid, p_provider_refund text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update private.representative_kit_refund_requests r
    set provider_refund_id = p_provider_refund, checked_at = clock_timestamp()
    where r.id = p_refund and r.started_at is not null
      and r.provider_ack_id = p_provider_refund
      and (r.provider_refund_id is null or r.provider_refund_id = p_provider_refund)
      and not (p_provider_refund = any(r.baseline_refund_ids))
      and exists(select 1 from private.representative_kit_provider_refunds a
        where a.provider_refund_id = p_provider_refund and a.order_id = r.order_id and a.amount_cents = r.amount_cents);
  return found;
end;
$$;

create function public.acknowledge_representative_kit_refund(p_refund uuid, p_provider_refund text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update private.representative_kit_refund_requests set provider_ack_id = p_provider_refund
    where id = p_refund and started_at is not null and p_provider_refund ~ '^[0-9]{1,30}$'
      and (provider_ack_id is null or provider_ack_id = p_provider_refund);
  return found;
end;
$$;

create function public.defer_representative_kit_refund(p_refund uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update private.representative_kit_refund_requests set checked_at = clock_timestamp()
    where id = p_refund and provider_refund_id is null;
  return found;
end;
$$;

revoke all on function public.due_representative_kit_refunds(), public.claim_representative_kit_refund(uuid,text[]),
  public.finish_representative_kit_refund(uuid,text), public.defer_representative_kit_refund(uuid),
  public.acknowledge_representative_kit_refund(uuid,text)
  from public, anon, authenticated;
grant execute on function public.due_representative_kit_refunds(), public.claim_representative_kit_refund(uuid,text[]),
  public.finish_representative_kit_refund(uuid,text), public.defer_representative_kit_refund(uuid),
  public.acknowledge_representative_kit_refund(uuid,text) to service_role;
;

-- 20261118164500_representative_kit_commercial_preflight.sql
-- Validate the supported fiscal configuration before allowing a Pix write.
-- A matching generic fiscal rule, without its buyer and Bling parameters,
-- cannot open the checkout.
create function private.representative_kit_commercial_configuration(p_actor uuid, p_rule uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1 from private.representative_kit_checkout_approvals a
    join private.representative_resale_fiscal_rule_versions r on r.id = a.rule_version_id
    cross join lateral (select r.fiscal_parameters as config, r.fiscal_parameters -> 'blingRule' as bling) as fiscal
    where a.actor_id = p_actor and a.rule_version_id = p_rule and a.revoked_at is null
      and a.valid_until > statement_timestamp()
      and a.buyer_document is not null and a.buyer_legal_name is not null and a.buyer_state_registration is not null
      and config ->> 'issuerDocument' ~ '^[0-9]{14}$'
      and config ->> 'classification' = 'third_party_no_st'
      and jsonb_typeof(config -> 'creditEligible') = 'boolean'
      and bling ->> 'issuer_state' = 'MG' and bling ->> 'series' = '2' and bling ->> 'document_model' = '55'
      and bling ->> 'cfop' = '5102' and bling ->> 'icms_rate' ~ '^0([.]0+)?$'
      and bling ->> 'pis_cst' = '49' and bling ->> 'cofins_cst' = '49'
      and bling ->> 'ipi_cst' = '99' and bling ->> 'ipi_cenq' = '999'
      and bling ->> 'pis_rate' ~ '^0([.]0+)?$' and bling ->> 'cofins_rate' ~ '^0([.]0+)?$'
      and bling ->> 'ipi_rate' ~ '^0([.]0+)?$'
      and exists (
        select 1 from jsonb_each(case when jsonb_typeof(config -> 'returnRules')='object'
          then config -> 'returnRules' else '{}'::jsonb end) as returns(route,rule)
        where ((route='buyer_outflow' and rule ->> 'cfop' ~ '^5[0-9]{3}$')
            or (route='own_inflow' and rule ->> 'cfop' ~ '^1[0-9]{3}$'))
          and ((rule ->> 'taxCodeKind'='CST' and rule ->> 'taxCode' ~ '^[0-9]{2}$')
            or (rule ->> 'taxCodeKind'='CSOSN' and rule ->> 'taxCode' ~ '^[0-9]{3}$'))
          and length(btrim(rule ->> 'homologationEvidence')) >= 10
      )
      and 1 = (select count(*) from jsonb_array_elements(
        case when jsonb_typeof(bling -> 'natures') = 'array' then bling -> 'natures' else '[]'::jsonb end
      ) nature where nature -> 'final_consumer' = 'false'::jsonb and nature ->> 'external_nature_id' ~ '^[1-9][0-9]{0,15}$')
      and (
        (config -> 'creditEligible' = 'false'::jsonb and bling ->> 'csosn' = '102'
          and bling ->> 'scenario' = 'resale_in_state_no_credit')
        or (a.buyer_profile = 'MG01' and config -> 'creditEligible' = 'true'::jsonb
          and config ->> 'creditBase' in ('merchandise','merchandise_with_shipping')
          and bling ->> 'csosn' = '101' and bling ->> 'scenario' = 'resale_in_state_credit'
          and 1 = (
            select count(*) from jsonb_array_elements(
              case when jsonb_typeof(bling -> 'credit_periods') = 'array' then bling -> 'credit_periods' else '[]'::jsonb end
            ) credit
            where credit ->> 'application_month' = to_char(statement_timestamp() at time zone 'America/Sao_Paulo','YYYY-MM-01')
              and credit ->> 'reference_month' = to_char((statement_timestamp() at time zone 'America/Sao_Paulo') - interval '1 month','YYYY-MM-01')
              and credit ->> 'rate' ~ '^([1-9][0-9]?|0)([.][0-9]{1,4})?$'
              and credit ->> 'rate' !~ '^0([.]0+)?$' and length(credit ->> 'evidence_reference') >= 10
              and credit ->> 'revision' ~ '^[1-9][0-9]{0,7}$'
              and credit ->> 'approved_by' ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
              and credit ->> 'approved_at' is not null
          ))
      )
  );
$$;
revoke all on function private.representative_kit_commercial_configuration(uuid,uuid) from public, anon, authenticated, service_role;

create function private.guard_representative_kit_commercial_configuration()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (tg_op = 'INSERT' or (old.payment_started_at is null and new.payment_started_at is not null))
    and not private.representative_kit_commercial_configuration(new.actor_id,new.rule_version_id) then
    raise exception 'resale_configuration_required' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_representative_kit_commercial_configuration() from public, anon, authenticated, service_role;
create trigger representative_kit_commercial_configuration
  before insert or update of payment_started_at on private.representative_kit_orders
  for each row execute function private.guard_representative_kit_commercial_configuration();

create function public.representative_kit_purchase_available(p_actor uuid,p_variant uuid,p_origin text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.representative_kit_commercial_configuration(p_actor,
    private.find_representative_kit_checkout_approval(p_actor,p_variant,p_origin));
$$;
revoke all on function public.representative_kit_purchase_available(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.representative_kit_purchase_available(uuid,uuid,text) to service_role;

create function public.list_representative_kit_orders(p_actor uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(orders.summary),'[]'::jsonb) from (
    select private.representative_kit_order_summary(o) || jsonb_build_object('productName',o.product_name,
      'cancellationRequested',o.cancellation_requested_at is not null, 'paymentStarted',o.payment_started_at is not null)
      as summary from private.representative_kit_orders o
    where o.actor_id = p_actor order by o.created_at desc, o.id limit 25
  ) orders;
$$;
revoke all on function public.list_representative_kit_orders(uuid) from public, anon, authenticated;
grant execute on function public.list_representative_kit_orders(uuid) to service_role;
;

-- 20261118170000_representative_kit_provider_writes.sql
-- Durable one-write claims per external operation. An uncertain provider
-- mutation is recovered by readback or an operator with the original identity.
create table private.representative_kit_fulfillment_writes (
  order_id uuid not null references private.representative_kit_fulfillment(order_id),
  operation text not null check (operation in ('shipment_cart','shipment_purchase','shipment_generate',
    'bling_sale','bling_invoice_draft','bling_invoice_send')),
  started_at timestamptz not null default now(),
  primary key (order_id, operation)
);
alter table private.representative_kit_fulfillment_writes enable row level security;
alter table private.representative_kit_fulfillment_writes force row level security;
revoke all on private.representative_kit_fulfillment_writes from public, anon, authenticated, service_role;

create function public.read_representative_kit_dispatch(p_order uuid, p_invoice_key text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('shipmentId',f.shipment_id, 'serviceId',o.shipping_snapshot ->> 'serviceId',
    'originPostalCode',o.shipping_snapshot ->> 'originPostalCode',
    'costInCents',o.shipping_snapshot -> 'costInCents', 'packages',o.shipping_snapshot -> 'packages',
    'address',jsonb_build_object('state',a.state,'street',a.street,'number',a.number,'district',a.district,
      'city',a.city,'complement',a.complement,'postalCode',o.shipping_snapshot -> 'address' ->> 'postalCode'),
    'buyerName',buyer.buyer_legal_name, 'buyerDocument',buyer.buyer_document,
    'buyerRegistration',buyer.buyer_state_registration,'phone',p.phone,'email',u.email,
    'sku',o.sku,'name',o.product_name,'quantity',o.quantity,'unitPriceInCents',o.unit_price_cents,
    'variantId',o.variant_id)
  from private.representative_kit_orders o
  join private.representative_kit_fulfillment f on o.id = f.order_id
  join private.representative_kit_checkout_approvals buyer on buyer.actor_id = o.actor_id and buyer.rule_version_id = o.rule_version_id
  join public.addresses a on a.id = o.address_id and a.user_id = o.actor_id
  join public.profiles p on p.id = o.actor_id join auth.users u on u.id = o.actor_id
  where o.id = p_order and f.invoice_access_key = p_invoice_key
    and f.invoice_confirmed_at > now() - interval '5 minutes'
    and o.state = 'paid' and o.stock_state = 'sold' and private.representative_kit_payment_allowed(o)
    and o.cancellation_requested_at is null
    and not exists (select 1 from private.representative_kit_refund_requests r where r.order_id = o.id);
$$;

create function public.claim_representative_kit_shipping_write(p_order uuid, p_invoice_key text, p_operation text, p_shipment text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  f private.representative_kit_fulfillment;
begin
  perform 1 from private.representative_kit_orders where id = p_order for update;
  if not found then return false; end if;
  select * into f from private.representative_kit_fulfillment where order_id = p_order for update;
  if not found or public.read_representative_kit_dispatch(p_order,p_invoice_key) is null or p_operation is null then return false; end if;
  if not (case p_operation
    when 'shipment_cart' then f.shipment_id is null and p_shipment is null
    when 'shipment_purchase' then f.shipment_id is not null and f.shipment_id = p_shipment and f.shipment_status = 'pending'
    when 'shipment_generate' then f.shipment_id is not null and f.shipment_id = p_shipment and f.shipment_status = 'ready'
    else false end) then return false; end if;
  insert into private.representative_kit_fulfillment_writes(order_id,operation) values (p_order,p_operation)
    on conflict do nothing;
  return found;
end;
$$;

-- Always record the returned carrier identity, even if payment entered manual
-- review while the request was in flight. This preserves recovery without
-- authorizing another mutation or purchasing the label.
create function public.link_representative_kit_shipment(p_order uuid,p_shipment text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_shipment is null or p_shipment !~ '^[A-Za-z0-9-]{1,100}$' then return false; end if;
  update private.representative_kit_fulfillment f
    set shipment_id=p_shipment, shipment_status=coalesce(shipment_status,'pending')
    where f.order_id=p_order and (f.shipment_id is null or f.shipment_id=p_shipment)
      and exists (select 1 from private.representative_kit_fulfillment_writes w
        where w.order_id=f.order_id and w.operation='shipment_cart')
      and not exists (select 1 from public.shipments s where s.provider='melhorenvio' and s.external_id=p_shipment);
  return found;
end;
$$;

revoke all on function public.read_representative_kit_dispatch(uuid,text),
  public.claim_representative_kit_shipping_write(uuid,text,text,text), public.link_representative_kit_shipment(uuid,text)
  from public, anon, authenticated;
grant execute on function public.read_representative_kit_dispatch(uuid,text),
  public.claim_representative_kit_shipping_write(uuid,text,text,text), public.link_representative_kit_shipment(uuid,text)
  to service_role;
;

-- 20261118171000_representative_kit_paid_cancellation.sql
alter table private.representative_kit_fulfillment
  alter column bling_sale_id drop not null,
  alter column bling_invoice_id drop not null,
  add column invoice_cancellation_confirmed_at timestamptz;
alter table private.representative_kit_orders add column returned_kit_count integer not null default 0,
  add check (returned_kit_count between 0 and quantity);

create function private.can_cancel_unshipped_representative_kit(o private.representative_kit_orders)
returns boolean language sql stable set search_path = '' as $$
  select o.state='paid' and o.stock_state='sold'
    and not exists(select 1 from private.representative_kit_fulfillment f where f.order_id=o.id
      and (f.bling_sale_id is not null or f.bling_invoice_id is not null or f.shipment_id is not null))
    and not exists(select 1 from private.representative_kit_fulfillment_writes w where w.order_id=o.id)
    and not exists(select 1 from private.representative_kit_refund_requests r where r.order_id=o.id)
    and not exists(select 1 from private.representative_kit_provider_refunds r where r.order_id=o.id);
$$;
revoke all on function private.can_cancel_unshipped_representative_kit(private.representative_kit_orders)
  from public,anon,authenticated,service_role;

create function private.queue_unshipped_representative_kit_refund(p_order uuid)
returns boolean language plpgsql set search_path = '' as $$
declare
  o private.representative_kit_orders;
  f private.representative_kit_fulfillment;
begin
  select * into o from private.representative_kit_orders where id=p_order for update;
  if not found or o.state <> 'paid' or o.stock_state <> 'sold' or o.cancellation_requested_at is null then return false; end if;
  select * into f from private.representative_kit_fulfillment where order_id=p_order for update;
  if not private.can_cancel_unshipped_representative_kit(o) then return false; end if;
  insert into private.representative_kit_refund_requests(order_id,amount_cents,reason,operational_evidence,fiscal_evidence)
    values(p_order,o.unit_price_cents*o.quantity+o.shipping_cents,'undispatched_cancellation',
      'Solicitação autenticada do titular antes da expedição','Sem operação fiscal ou logística iniciada no pedido');
  return true;
end;
$$;

create function private.enqueue_representative_kit_after_payment()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.state='paid' and old.state is distinct from new.state then
    if not private.queue_unshipped_representative_kit_refund(new.id) then
      insert into private.representative_kit_fulfillment(order_id) values(new.id) on conflict do nothing;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.queue_unshipped_representative_kit_refund(uuid),
  private.enqueue_representative_kit_after_payment() from public, anon, authenticated, service_role;
create trigger enqueue_representative_kit_after_payment after update of state on private.representative_kit_orders
  for each row execute function private.enqueue_representative_kit_after_payment();

create or replace function public.read_representative_kit_payment(p_actor uuid, p_order uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select private.representative_kit_order_summary(o) ||
    jsonb_build_object('providerPaymentId',o.provider_payment_id,'startedAt',o.payment_started_at,
      'cancellationRequested',o.cancellation_requested_at is not null,
      'customerCanPay',o.state='payment_pending' and private.representative_kit_payment_allowed(o),
      'canCancelPaid',o.cancellation_requested_at is null and private.can_cancel_unshipped_representative_kit(o))
  from private.representative_kit_orders o where o.id=p_order and o.actor_id=p_actor;
$$;

create or replace function public.request_representative_kit_payment_cancellation(p_actor uuid, p_order uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  o private.representative_kit_orders;
begin
  select * into o from private.representative_kit_orders where actor_id=p_actor and id=p_order for update;
  if not found then return null; end if;
  if o.state='paid' and o.cancellation_requested_at is null and not private.can_cancel_unshipped_representative_kit(o) then
    raise exception 'kit_requires_cancellation_review' using errcode='23514';
  end if;
  if o.payment_started_at is null then
    perform public.cancel_unstarted_representative_kit_order(p_actor,p_order);
  elsif o.state in ('reserved','payment_pending','paid') then
    update private.representative_kit_orders set cancellation_requested_at=coalesce(cancellation_requested_at,now()) where id=p_order;
    if o.state = 'paid' then perform private.queue_unshipped_representative_kit_refund(p_order); end if;
  end if;
  return public.read_representative_kit_payment(p_actor,p_order);
end;
$$;

create function public.observe_representative_kit_invoice_cancellation(p_order uuid, p_invoice bigint, p_key text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update private.representative_kit_fulfillment set invoice_cancellation_confirmed_at=clock_timestamp(),invoice_confirmed_at=null
    where order_id=p_order and bling_invoice_id=p_invoice and invoice_access_key is not distinct from nullif(p_key,'');
  return found;
end;
$$;
revoke all on function public.observe_representative_kit_invoice_cancellation(uuid,bigint,text) from public, anon, authenticated;
grant execute on function public.observe_representative_kit_invoice_cancellation(uuid,bigint,text) to service_role;

create function private.restore_cancelled_representative_kit_stock()
returns trigger language plpgsql set search_path = '' as $$
declare
  o private.representative_kit_orders;
  restored integer;
begin
  if old.provider_refund_id is not null or new.provider_refund_id is null or new.reason <> 'undispatched_cancellation' then return new; end if;
  select * into o from private.representative_kit_orders where id=new.order_id for update;
  if not found or o.state <> 'refunded' or o.stock_state <> 'sold' or o.returned_kit_count <> 0 then return new; end if;
  update public.inventory set available_quantity=available_quantity+o.quantity,version=version+1,updated_at=now()
    where variant_id=o.variant_id returning available_quantity into restored;
  if not found then raise exception 'kit_stock_inconsistent' using errcode='23514'; end if;
  update private.representative_kit_orders set stock_state='released',returned_kit_count=o.quantity where id=o.id;
  insert into public.inventory_movements(variant_id,movement_type,quantity,previous_quantity,new_quantity,reason,reference_type,reference_id,performed_by)
    values(o.variant_id,'return',o.quantity,restored-o.quantity,restored,
      'Estorno confirmado antes da expedição de kit de revenda MG','representative_kit_refund',new.id,o.actor_id);
  return new;
end;
$$;
revoke all on function private.restore_cancelled_representative_kit_stock() from public, anon, authenticated, service_role;
create trigger restore_cancelled_representative_kit_stock after update of provider_refund_id on private.representative_kit_refund_requests
  for each row execute function private.restore_cancelled_representative_kit_stock();

-- The original claim protects balances and acknowledges prior provider refunds.
-- This additional guard requires positive fiscal cancellation evidence, even
-- when an invoice poll failed or a provider write lost its response.
create function private.guard_representative_kit_refund_dispatch()
returns trigger language plpgsql set search_path = '' as $$
declare
  f private.representative_kit_fulfillment;
begin
  if old.started_at is not null or new.started_at is null or new.reason <> 'undispatched_cancellation' then return new; end if;
  select * into f from private.representative_kit_fulfillment where order_id=new.order_id for update;
  if (f.bling_invoice_id is not null or f.invoice_access_key is not null
    or exists(select 1 from private.representative_kit_fulfillment_writes w where w.order_id=new.order_id
      and w.operation in ('bling_invoice_draft','bling_invoice_send')))
    and f.invoice_cancellation_confirmed_at is null then
    raise exception 'kit_invoice_cancellation_unconfirmed' using errcode='23514';
  end if;
  if f.shipment_status is distinct from 'cancelled' and (f.shipment_id is not null
    or exists(select 1 from private.representative_kit_fulfillment_writes w where w.order_id=new.order_id and w.operation='shipment_cart'))
    then raise exception 'kit_shipment_cancellation_unconfirmed' using errcode='23514'; end if;
  return new;
end;
$$;
revoke all on function private.guard_representative_kit_refund_dispatch() from public, anon, authenticated, service_role;
create trigger guard_representative_kit_refund_dispatch before update of started_at on private.representative_kit_refund_requests
  for each row execute function private.guard_representative_kit_refund_dispatch();
;

-- 20261118172000_representative_kit_bling_writes.sql
alter table private.representative_kit_checkout_approvals add column buyer_fiscal_address jsonb
  check (buyer_fiscal_address is null or (jsonb_typeof(buyer_fiscal_address) = 'object' and buyer_fiscal_address ->> 'state' = 'MG'
    and buyer_fiscal_address ->> 'postal_code' ~ '^3[0-9]{7}$'
    and length(btrim(coalesce(buyer_fiscal_address ->> 'street',''))) > 0
    and length(btrim(coalesce(buyer_fiscal_address ->> 'number',''))) > 0
    and length(btrim(coalesce(buyer_fiscal_address ->> 'district',''))) > 0
    and length(btrim(coalesce(buyer_fiscal_address ->> 'city',''))) > 0));

alter table private.representative_kit_orders add column buyer_snapshot jsonb
  check (jsonb_typeof(buyer_snapshot)='object');

create function private.require_representative_kit_fiscal_address()
returns trigger language plpgsql set search_path = '' as $$
declare snapshot jsonb;
begin
  if tg_op='UPDATE' and old.payment_started_at is not null then return new; end if;
  select jsonb_build_object('name',a.buyer_legal_name,'document',a.buyer_document,'registration',a.buyer_state_registration,
    'address',a.buyer_fiscal_address) into snapshot
  from private.representative_kit_checkout_approvals a where a.actor_id=new.actor_id and a.rule_version_id=new.rule_version_id
    and a.buyer_fiscal_address ->> 'state' = 'MG' and a.buyer_fiscal_address ->> 'postal_code' ~ '^3[0-9]{7}$'
    for share of a;
  if snapshot is null then raise exception 'kit_fiscal_address_required' using errcode='23514'; end if;
  if tg_op='INSERT' then new.buyer_snapshot := snapshot;
  elsif new.buyer_snapshot is distinct from snapshot then raise exception 'kit_fiscal_recipient_changed' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function private.require_representative_kit_fiscal_address() from public,anon,authenticated,service_role;
create trigger representative_kit_fiscal_address before insert or update of payment_started_at on private.representative_kit_orders
  for each row execute function private.require_representative_kit_fiscal_address();

create or replace function private.representative_kit_payment_allowed(o private.representative_kit_orders)
returns boolean language sql stable set search_path = '' as $$
  select coalesce(private.find_representative_kit_checkout_approval(o.actor_id,o.variant_id,
    o.shipping_snapshot ->> 'originPostalCode')=o.rule_version_id,false)
  and exists (
    select 1 from public.profiles p join public.representatives r on r.user_id=p.id
    join public.addresses a on a.user_id=p.id
    join private.representative_kit_checkout_approvals buyer on buyer.actor_id=p.id and buyer.rule_version_id=o.rule_version_id
    where p.id=o.actor_id and p.status='active' and r.status in ('approved_waiting_kit','active','unqualified')
      and a.id=o.address_id and a.state='MG' and a.country='BR'
      and a.updated_at=(o.shipping_snapshot -> 'address' ->> 'version')::timestamptz
      and regexp_replace(a.postal_code,'[^0-9]','','g')=o.shipping_snapshot -> 'address' ->> 'postalCode'
      and o.buyer_snapshot=jsonb_build_object('name',buyer.buyer_legal_name,'document',buyer.buyer_document,
        'registration',buyer.buyer_state_registration,'address',buyer.buyer_fiscal_address)
  );
$$;

create or replace function public.representative_kit_purchase_available(p_actor uuid,p_variant uuid,p_origin text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from private.representative_kit_checkout_approvals a where a.actor_id=p_actor
    and a.rule_version_id=private.find_representative_kit_checkout_approval(p_actor,p_variant,p_origin)
    and a.buyer_fiscal_address ->> 'state' = 'MG' and a.buyer_fiscal_address ->> 'postal_code' ~ '^3[0-9]{7}$'
    and private.representative_kit_commercial_configuration(p_actor,a.rule_version_id));
$$;

alter table private.representative_kit_fulfillment add column invoice_draft_hash text check (invoice_draft_hash ~ '^[0-9a-f]{64}$'),
  add column reviewed_draft_hash text check (reviewed_draft_hash ~ '^[0-9a-f]{64}$'),
  add column reviewed_draft_evidence text check (length(btrim(reviewed_draft_evidence)) >= 10),
  add constraint representative_kit_review_complete check ((reviewed_draft_hash is null) = (reviewed_draft_evidence is null));

create function public.read_representative_kit_bling_order(p_order uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('saleId',f.bling_sale_id,'invoiceId',f.bling_invoice_id,
    'buyerName',o.buyer_snapshot -> 'name','buyerDocument',o.buyer_snapshot -> 'document',
    'buyerRegistration',o.buyer_snapshot -> 'registration','fiscalAddress',o.buyer_snapshot -> 'address',
    'reviewedDraftHash',f.reviewed_draft_hash,'draftHash',f.invoice_draft_hash,
    'address',jsonb_build_object('street',d.street,'number',d.number,'district',d.district,'city',d.city,
      'complement',d.complement,'state',d.state,'postal_code',o.shipping_snapshot -> 'address' ->> 'postalCode'))
  from private.representative_kit_orders o
  join private.representative_kit_fulfillment f on f.order_id=o.id
  join public.addresses d on d.id=o.address_id and d.user_id=o.actor_id
  where o.id=p_order and o.state='paid' and o.stock_state='sold'
    and o.cancellation_requested_at is null and private.representative_kit_payment_allowed(o)
    and private.representative_kit_commercial_configuration(o.actor_id,o.rule_version_id)
    and not exists(select 1 from private.representative_kit_refund_requests r where r.order_id=o.id);
$$;

create function public.claim_representative_kit_bling_write(p_order uuid,p_operation text,p_expected_hash text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  f private.representative_kit_fulfillment;
begin
  perform 1 from private.representative_kit_orders where id=p_order for update;
  if not found then return false; end if;
  select * into f from private.representative_kit_fulfillment where order_id=p_order for update;
  if not found or public.read_representative_kit_bling_order(p_order) is null or p_operation is null then return false; end if;
  if not (case p_operation
    when 'bling_sale' then f.bling_sale_id is null
    when 'bling_invoice_draft' then f.bling_sale_id is not null and f.bling_invoice_id is null
    when 'bling_invoice_send' then f.bling_invoice_id is not null and f.invoice_access_key is null and p_expected_hash is not null
      and f.invoice_draft_hash is not distinct from p_expected_hash and f.reviewed_draft_hash is not distinct from p_expected_hash
    else false end) then return false; end if;
  insert into private.representative_kit_fulfillment_writes(order_id,operation) values(p_order,p_operation) on conflict do nothing;
  return found;
end;
$$;

create function public.link_representative_kit_bling_sale(p_order uuid,p_sale bigint,p_invoice bigint default null)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_sale is null or p_sale <= 0 or p_invoice <= 0 then return false; end if;
  update private.representative_kit_fulfillment f
    set bling_sale_id=p_sale,bling_invoice_id=coalesce(p_invoice,bling_invoice_id)
    where f.order_id=p_order and (f.bling_sale_id is null or f.bling_sale_id=p_sale)
      and (p_invoice is null or f.bling_invoice_id is null or f.bling_invoice_id=p_invoice)
      and not exists (select 1 from private.bling_order_links b
        where b.external_order_id=p_sale or (p_invoice is not null and b.invoice_id=p_invoice));
  return found;
end;
$$;

create function public.record_representative_kit_bling_draft(p_order uuid,p_invoice bigint,p_hash text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then return false; end if;
  update private.representative_kit_fulfillment set invoice_draft_hash=p_hash
    where order_id=p_order and bling_invoice_id=p_invoice and invoice_access_key is null
      and public.read_representative_kit_bling_order(p_order) is not null;
  return found;
end;
$$;

revoke all on function public.read_representative_kit_bling_order(uuid),
  public.claim_representative_kit_bling_write(uuid,text,text), public.link_representative_kit_bling_sale(uuid,bigint,bigint),
  public.record_representative_kit_bling_draft(uuid,bigint,text) from public,anon,authenticated;
grant execute on function public.read_representative_kit_bling_order(uuid),
  public.claim_representative_kit_bling_write(uuid,text,text), public.link_representative_kit_bling_sale(uuid,bigint,bigint),
  public.record_representative_kit_bling_draft(uuid,bigint,text) to service_role;
;

-- 20261118173000_representative_kit_returns.sql
create table private.representative_kit_returns (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references private.representative_kit_orders(id),
  request_key uuid not null,
  quantity integer not null check (quantity between 1 and 99),
  reason text not null check (length(btrim(reason)) between 5 and 500),
  state text not null default 'requested' check (state in ('requested','approved','received','verified','refund_pending','completed','rejected')),
  instructions text check (length(btrim(instructions)) between 5 and 500),
  reviewed_by uuid references public.profiles(id),
  inspected_by uuid references public.profiles(id),
  inspection_reference text check (length(btrim(inspection_reference)) between 10 and 200),
  restock_quantity integer not null default 0 check (restock_quantity between 0 and quantity),
  bling_invoice_id bigint unique check (bling_invoice_id > 0),
  document_origin text check (document_origin in ('buyer_outflow','own_inflow')),
  invoice_key text unique check (invoice_key ~ '^31[0-9]{42}$'),
  invoice_protocol text unique check (invoice_protocol ~ '^[0-9]{15}$'),
  invoice_sha256 text check (invoice_sha256 ~ '^[0-9a-f]{64}$'),
  refund_cents bigint check (refund_cents > 0),
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  unique(order_id,request_key)
);
create index representative_kit_returns_review on private.representative_kit_returns(state,created_at);
create index representative_kit_returns_inspector on private.representative_kit_returns(inspected_by);
create index representative_kit_returns_reviewer on private.representative_kit_returns(reviewed_by);
alter table private.representative_kit_returns enable row level security;
alter table private.representative_kit_returns force row level security;
revoke all on private.representative_kit_returns from public,anon,authenticated,service_role;

alter table private.representative_kit_refund_requests add column kit_return_id uuid unique
  references private.representative_kit_returns(id);

create function private.representative_kit_return_summary(r private.representative_kit_returns)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id',r.id,'orderId',r.order_id,'quantity',r.quantity,'state',r.state,
    'instructions',r.instructions,'createdAt',r.created_at);
$$;
revoke all on function private.representative_kit_return_summary(private.representative_kit_returns) from public,anon,authenticated,service_role;

create function public.request_representative_kit_return(p_actor uuid,p_order uuid,p_quantity integer,p_reason text,p_key uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  o private.representative_kit_orders;
  r private.representative_kit_returns;
begin
  select * into o from private.representative_kit_orders where id=p_order and actor_id=p_actor for update;
  if not found or not exists(select 1 from public.profiles where id=p_actor and status='active') then return null; end if;
  if p_quantity is null or p_quantity not between 1 and 99 or length(btrim(coalesce(p_reason,''))) not between 5 and 500 or p_key is null
    then raise exception 'invalid_kit_return' using errcode='22023'; end if;
  select * into r from private.representative_kit_returns where order_id=p_order and request_key=p_key;
  if found then
    if r.quantity is distinct from p_quantity or r.reason is distinct from btrim(p_reason)
      then raise exception 'kit_return_idempotency_conflict' using errcode='23505'; end if;
    return private.representative_kit_return_summary(r);
  end if;
  if o.state not in ('paid','manual_review') or o.stock_state <> 'sold'
    or not exists(select 1 from private.representative_kit_fulfillment f where f.order_id=p_order
      and f.shipment_status in ('delivered','returned') and f.invoice_access_key is not null and f.invoice_cancellation_confirmed_at is null)
    or p_quantity + coalesce((select sum(quantity) from private.representative_kit_returns
      where order_id=p_order and state <> 'rejected'),0) > o.quantity then
      raise exception 'kit_return_unavailable' using errcode='23514';
  end if;
  insert into private.representative_kit_returns(order_id,request_key,quantity,reason) values(p_order,p_key,p_quantity,btrim(p_reason))
    returning * into r;
  return private.representative_kit_return_summary(r);
end;
$$;

create function public.list_representative_kit_returns(p_actor uuid,p_order uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(private.representative_kit_return_summary(r) order by r.created_at desc),'[]'::jsonb)
  from private.representative_kit_returns r join private.representative_kit_orders o on o.id=r.order_id
  where o.id=p_order and o.actor_id=p_actor;
$$;

create function public.list_representative_kit_return_work()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_permission('returns.read');
  return (select coalesce(jsonb_agg(pending.summary),'[]'::jsonb) from (
    select private.representative_kit_return_summary(r) || jsonb_build_object('reason',r.reason,'sku',o.sku,
      'productName',o.product_name,'originalInvoiceKey',f.invoice_access_key,'refundInCents',r.refund_cents,
      'invoiceKey',r.invoice_key) as summary
    from private.representative_kit_returns r join private.representative_kit_orders o on o.id=r.order_id
    join private.representative_kit_fulfillment f on f.order_id=o.id
    order by r.created_at desc, r.id limit 50
  ) pending);
end;
$$;

create function public.manage_representative_kit_return(p_return uuid,p_action text,p_details jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r private.representative_kit_returns;
  o private.representative_kit_orders;
  f private.representative_kit_fulfillment;
  amount bigint;
begin
  perform private.require_permission(case p_action when 'receive' then 'returns.inspect' when 'refund' then 'returns.refund'
    else 'returns.approve' end);
  select order_id into r.order_id from private.representative_kit_returns where id=p_return;
  if not found then return null; end if;
  select * into o from private.representative_kit_orders where id=r.order_id for update;
  select * into r from private.representative_kit_returns where id=p_return for update;
  select * into f from private.representative_kit_fulfillment where order_id=o.id for update;
  if not found or f.invoice_access_key is null or f.invoice_cancellation_confirmed_at is not null then return null; end if;
  if p_action='approve' and r.state='requested' then
    if length(btrim(coalesce(p_details->>'instructions',''))) not between 5 and 500 then return null; end if;
    update private.representative_kit_returns set state='approved',instructions=btrim(p_details->>'instructions'),reviewed_by=auth.uid() where id=p_return;
  elsif p_action='reject' and r.state='requested' then
    if length(btrim(coalesce(p_details->>'instructions',''))) not between 5 and 500 then return null; end if;
    update private.representative_kit_returns set state='rejected',instructions=btrim(p_details->>'instructions'),reviewed_by=auth.uid() where id=p_return;
  elsif p_action='receive' and r.state='approved' then
    if coalesce(p_details->>'invoiceId','') !~ '^[1-9][0-9]{0,15}$'
      or coalesce(p_details->>'refundInCents','') !~ '^[1-9][0-9]{0,14}$'
      or coalesce(p_details->>'restockQuantity','') !~ '^[0-9]{1,2}$'
      or coalesce(p_details->>'invoiceKey','') !~ '^31[0-9]{42}$'
      or coalesce(p_details->>'documentOrigin','') not in ('buyer_outflow','own_inflow')
      or length(btrim(coalesce(p_details->>'inspectionReference',''))) not between 10 and 200 then return null; end if;
    amount := (p_details->>'refundInCents')::bigint;
    if (p_details->>'restockQuantity')::integer > r.quantity or amount > o.unit_price_cents*o.quantity+o.shipping_cents
      or p_details->>'invoiceKey'=f.invoice_access_key then return null; end if;
    update private.representative_kit_returns set state='received',inspected_by=auth.uid(),
      inspection_reference=btrim(p_details->>'inspectionReference'),restock_quantity=(p_details->>'restockQuantity')::integer,
      bling_invoice_id=(p_details->>'invoiceId')::bigint,invoice_key=p_details->>'invoiceKey',document_origin=p_details->>'documentOrigin',
      refund_cents=amount where id=p_return;
  elsif p_action='refund' and r.state='verified' then
    if r.invoice_protocol is null or r.invoice_sha256 is null or r.inspected_by is null or o.stock_state<>'sold'
      or r.refund_cents + coalesce((select sum(amount_cents) from private.representative_kit_provider_refunds
        where order_id=o.id),0) > o.unit_price_cents*o.quantity+o.shipping_cents then return null; end if;
    if exists(select 1 from private.representative_kit_refund_requests x where x.order_id=o.id and x.provider_refund_id is null)
      then return null; end if;
    insert into private.representative_kit_refund_requests(order_id,kit_return_id,amount_cents,reason,operational_evidence,fiscal_evidence,
      original_invoice_key,return_invoice_key)
      values(o.id,r.id,r.refund_cents,'accepted_return',r.inspection_reference,'Protocolo NF-e '||r.invoice_protocol,f.invoice_access_key,r.invoice_key);
    update private.representative_kit_returns set state='refund_pending' where id=p_return;
  else
    return null;
  end if;
  select * into r from private.representative_kit_returns where id=p_return;
  return private.representative_kit_return_summary(r);
end;
$$;

create function public.due_representative_kit_return_invoices()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(due)),'[]'::jsonb) from (
    select r.id as "returnId",r.quantity as "returnQuantity",r.document_origin as "documentOrigin",
      r.bling_invoice_id as "invoiceId",r.invoice_key as "invoiceKey",r.refund_cents as "refundInCents",
      o.quantity as "originalQuantity",o.buyer_snapshot ->> 'document' as "buyerDocument",
      rule.fiscal_parameters ->> 'issuerDocument' as "issuerDocument",
      rule.fiscal_parameters -> 'returnRules' -> r.document_origin as "returnRule",
      f.invoice_access_key as "originalKey",f.invoice_xml_sha256 as "originalHash",f.bling_invoice_id as "originalInvoiceId"
    from private.representative_kit_returns r join private.representative_kit_orders o on o.id=r.order_id
    join private.representative_kit_fulfillment f on f.order_id=o.id
    join private.representative_resale_fiscal_rule_versions rule on rule.id=o.rule_version_id
    where r.state='received' and f.invoice_cancellation_confirmed_at is null
      and (r.checked_at is null or r.checked_at<now()-interval '15 minutes')
    order by r.checked_at nulls first,r.id limit 3
  ) due;
$$;

create function public.record_representative_kit_return_invoice(p_return uuid,p_key text,p_protocol text,p_hash text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update private.representative_kit_returns set state='verified',invoice_protocol=p_protocol,invoice_sha256=p_hash,checked_at=now()
    where id=p_return and invoice_key=p_key and p_protocol ~ '^[0-9]{15}$' and p_hash ~ '^[0-9a-f]{64}$' and state='received';
  return found;
end;
$$;
create function public.defer_representative_kit_return_invoice(p_return uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update private.representative_kit_returns set checked_at=clock_timestamp() where id=p_return and state='received';
  return found;
end;
$$;

create function private.finalize_representative_kit_return()
returns trigger language plpgsql set search_path = '' as $$
declare
  r private.representative_kit_returns;
  o private.representative_kit_orders;
  restored integer;
begin
  if new.reason <> 'accepted_return' then return new; end if;
  if tg_when='BEFORE' then
    if old.started_at is null and new.started_at is not null and not exists(
      select 1 from private.representative_kit_returns q where q.id=new.kit_return_id and q.order_id=new.order_id
        and q.state='refund_pending' and q.invoice_key=new.return_invoice_key and q.refund_cents=new.amount_cents
        and q.invoice_protocol is not null and q.invoice_sha256 is not null
    ) then raise exception 'kit_return_verification_required' using errcode='23514'; end if;
    return new;
  end if;
  if old.provider_refund_id is not null or new.provider_refund_id is null then return new; end if;
  select * into o from private.representative_kit_orders where id=new.order_id for update;
  select * into r from private.representative_kit_returns where id=new.kit_return_id for update;
  if not found or r.state<>'refund_pending' or r.order_id<>o.id or o.returned_kit_count+r.quantity>o.quantity
    then raise exception 'kit_return_stock_mismatch' using errcode='23514'; end if;
  update private.representative_kit_orders set returned_kit_count=returned_kit_count+r.quantity,
    stock_state=case when returned_kit_count+r.quantity=quantity then 'released' else stock_state end where id=o.id;
  if r.restock_quantity>0 then
    update public.inventory set available_quantity=available_quantity+r.restock_quantity,version=version+1,updated_at=now()
      where variant_id=o.variant_id returning available_quantity into restored;
    if not found then raise exception 'kit_stock_inconsistent' using errcode='23514'; end if;
    insert into public.inventory_movements(variant_id,movement_type,quantity,previous_quantity,new_quantity,reason,reference_type,reference_id,performed_by)
      values(o.variant_id,'return',r.restock_quantity,restored-r.restock_quantity,restored,
        'Devolução inspecionada de kit de revenda MG','representative_kit_return',r.id,r.inspected_by);
  end if;
  update private.representative_kit_returns set state='completed' where id=r.id;
  return new;
end;
$$;
revoke all on function private.finalize_representative_kit_return() from public,anon,authenticated,service_role;
create trigger guard_representative_kit_return_refund before update of started_at on private.representative_kit_refund_requests
  for each row execute function private.finalize_representative_kit_return();
create trigger finalize_representative_kit_return after update of provider_refund_id on private.representative_kit_refund_requests
  for each row execute function private.finalize_representative_kit_return();

revoke all on function public.request_representative_kit_return(uuid,uuid,integer,text,uuid),public.list_representative_kit_returns(uuid,uuid),
  public.due_representative_kit_return_invoices(),public.record_representative_kit_return_invoice(uuid,text,text,text),
  public.defer_representative_kit_return_invoice(uuid) from public,anon,authenticated;
grant execute on function public.request_representative_kit_return(uuid,uuid,integer,text,uuid),public.list_representative_kit_returns(uuid,uuid),
  public.due_representative_kit_return_invoices(),public.record_representative_kit_return_invoice(uuid,text,text,text),
  public.defer_representative_kit_return_invoice(uuid) to service_role;
revoke all on function public.list_representative_kit_return_work(),public.manage_representative_kit_return(uuid,text,jsonb)
  from public,anon,service_role;
grant execute on function public.list_representative_kit_return_work(),public.manage_representative_kit_return(uuid,text,jsonb) to authenticated;
;

-- 20261118174000_representative_kit_fiscal_operations.sql
create function public.list_representative_kit_fiscal_work()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not (private.has_permission('orders.update_operational_status') or private.has_permission('technical.integrations.manage'))
    then raise exception 'permission_denied' using errcode='42501'; end if;
  return (select coalesce(jsonb_agg(work.summary),'[]'::jsonb) from (
    select jsonb_build_object('orderId',o.id,'state',o.state,'sku',o.sku,'quantity',o.quantity,'productName',o.product_name,
      'invoiceId',f.bling_invoice_id,'saleId',f.bling_sale_id,'draftHash',f.invoice_draft_hash,
      'draftApproved',f.reviewed_draft_hash is not null and f.reviewed_draft_hash=f.invoice_draft_hash,
      'invoiceAuthorized',f.invoice_confirmed_at is not null,'shipmentStatus',f.shipment_status,
      'cancellationRequested',o.cancellation_requested_at is not null) as summary
    from private.representative_kit_orders o join private.representative_kit_fulfillment f on f.order_id=o.id
    order by o.created_at desc,o.id limit 50
  ) work);
end;
$$;

create function public.approve_representative_kit_bling_draft(p_order uuid,p_hash text,p_evidence text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not (private.has_permission('orders.update_operational_status') or private.has_permission('technical.integrations.manage'))
    then raise exception 'permission_denied' using errcode='42501'; end if;
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$'
    or length(btrim(coalesce(p_evidence,''))) not between 10 and 200 then return false; end if;
  perform 1 from private.representative_kit_orders where id=p_order for update;
  if not found or public.read_representative_kit_bling_order(p_order) is null then return false; end if;
  update private.representative_kit_fulfillment set reviewed_draft_hash=p_hash,reviewed_draft_evidence=btrim(p_evidence),checked_at=null
    where order_id=p_order and bling_invoice_id is not null and invoice_access_key is null and invoice_draft_hash=p_hash
      and not exists(select 1 from private.representative_kit_fulfillment_writes w
        where w.order_id=p_order and w.operation='bling_invoice_send');
  if not found then return false; end if;
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
    values(auth.uid(),private.current_app_role(),'integration.bling.kit_draft_approved','representative_kit_order',p_order,
      jsonb_build_object('draftHash',p_hash));
  return true;
end;
$$;

revoke all on function public.list_representative_kit_fiscal_work(),public.approve_representative_kit_bling_draft(uuid,text,text)
  from public,anon,service_role;
grant execute on function public.list_representative_kit_fiscal_work(),public.approve_representative_kit_bling_draft(uuid,text,text)
  to authenticated;
;

-- 20261118175000_representative_kit_shipping_label.sql
create function public.read_representative_kit_printable_label(p_order uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare label text;
begin
  perform private.require_permission('representatives.kits.fulfill');
  select f.shipment_id into label
    from private.representative_kit_fulfillment f join private.representative_kit_orders o on o.id=f.order_id
    where o.id=p_order and o.state='paid' and o.stock_state='sold' and o.cancellation_requested_at is null
      and f.invoice_access_key is not null and f.invoice_cancellation_confirmed_at is null
      and f.invoice_confirmed_at > statement_timestamp()-interval '20 minutes'
      and f.shipment_status in ('label_created','dispatched','in_transit','delayed')
      and private.representative_kit_payment_allowed(o)
      and not exists (select 1 from private.representative_kit_refund_requests r where r.order_id=o.id);
  return label;
end;
$$;
revoke all on function public.read_representative_kit_printable_label(uuid) from public,anon,service_role;
grant execute on function public.read_representative_kit_printable_label(uuid) to authenticated;
;

-- 20261119130000_representative_admin_kit_removal.sql
alter table public.kits
  add column deleted_at timestamptz,
  add constraint kits_deleted_are_inactive check (deleted_at is null or not active);

create function public.remove_representative_admin_kit(p_kit uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.kits;
begin
  if auth.uid() is null or not private.has_permission('representatives.rules.manage') then
    raise exception 'kit_management_forbidden' using errcode = '42501';
  end if;

  -- The same row protects legacy kit creation and the foreign keys that refer to it.
  select * into target from public.kits where id = p_kit for update;
  if not found then return true; end if;
  if target.deleted_at is not null then return false; end if;

  if target.required_for_activation
    or exists (select 1 from public.kit_orders where kit_id = p_kit)
    or exists (select 1 from public.kit_level_rules where kit_id = p_kit) then
    update public.kits set active = false, deleted_at = clock_timestamp() where id = p_kit;
    return false;
  end if;

  delete from public.kits where id = p_kit;
  return true;
end;
$$;

revoke all on function public.remove_representative_admin_kit(uuid) from public, anon;
grant execute on function public.remove_representative_admin_kit(uuid) to authenticated;
;

-- 20261119133000_representative_kit_grade_templates.sql
alter table public.kits
  add column grade_product_id uuid references public.products(id),
  add column grade_color text,
  add constraint kits_grade_source_complete
    check ((grade_product_id is null and grade_color is null)
      or (grade_product_id is not null and nullif(btrim(grade_color), '') is not null));

create index kits_grade_product on public.kits (grade_product_id) where grade_product_id is not null;

create function private.representative_kit_grade_templates()
returns table (code text, label text, sort_order integer, size text, pairs integer)
language sql immutable set search_path = ''
as $$
  values
    ('standard', 'Ficha padrão', 1, '34', 1),
    ('standard', 'Ficha padrão', 1, '35', 2),
    ('standard', 'Ficha padrão', 1, '36', 3),
    ('standard', 'Ficha padrão', 1, '37', 3),
    ('standard', 'Ficha padrão', 1, '38', 2),
    ('standard', 'Ficha padrão', 1, '39', 1),
    ('lower_restock', 'Ficha reposição baixa', 2, '34', 1),
    ('lower_restock', 'Ficha reposição baixa', 2, '35', 3),
    ('lower_restock', 'Ficha reposição baixa', 2, '36', 4),
    ('lower_restock', 'Ficha reposição baixa', 2, '37', 4),
    ('upper_restock', 'Ficha reposição alta', 3, '37', 4),
    ('upper_restock', 'Ficha reposição alta', 3, '38', 4),
    ('upper_restock', 'Ficha reposição alta', 3, '39', 4);
$$;
revoke all on function private.representative_kit_grade_templates() from public, anon, authenticated, service_role;

create function private.representative_kit_grade_sources()
returns table (product_id uuid, product_name text, color text)
language sql stable set search_path = ''
as $$
  select p.id, p.name, v.color_name
  from public.products p
  join private.bling_catalog_metadata m on m.product_id = p.id and m.pairs_per_sku = 1
  join public.product_variants v on v.product_id = p.id and v.active
  where p.status = 'active' and nullif(btrim(v.color_name), '') is not null
    and v.size in ('34', '35', '36', '37', '38', '39')
  group by p.id, p.name, v.color_name
  having count(*) = 6 and count(distinct v.size) = 6;
$$;
revoke all on function private.representative_kit_grade_sources() from public, anon, authenticated, service_role;

create function public.list_representative_kit_grade_sources()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not private.has_permission('representatives.rules.manage') then
    raise exception 'kit_management_forbidden' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object('productId', s.product_id, 'name', s.product_name, 'color', s.color)
      order by s.product_name, s.color, s.product_id)
    from private.representative_kit_grade_sources() s
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.list_representative_kit_grade_sources() from public, anon;
grant execute on function public.list_representative_kit_grade_sources() to authenticated;

create function private.validate_representative_kit_grade_source()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (old.grade_product_id, old.grade_color)
    is not distinct from (new.grade_product_id, new.grade_color) then
    return new;
  end if;
  if new.grade_product_id is not null and not exists (
    select 1 from private.representative_kit_grade_sources() s
    where (s.product_id, s.color) = (new.grade_product_id, new.grade_color)
  ) then
    raise exception 'invalid_kit_grade_source' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_representative_kit_grade_source() from public, anon, authenticated, service_role;

create trigger validate_representative_kit_grade_source
before insert or update of grade_product_id, grade_color on public.kits
for each row execute function private.validate_representative_kit_grade_source();

create function private.representative_kit_grade_components(p_kit uuid, p_template text)
returns table (size text, pairs integer, variant_id uuid, available integer)
language sql stable set search_path = ''
as $$
  select t.size, t.pairs, v.id, coalesce(i.available_quantity, 0)
  from public.kits k
  cross join private.representative_kit_grade_templates() t
  join private.representative_kit_grade_sources() s
    on (s.product_id, s.color) = (k.grade_product_id, k.grade_color)
  join public.product_variants v on v.product_id = s.product_id
    and v.color_name = s.color and v.size = t.size and v.active
  left join public.inventory i on i.variant_id = v.id
  where k.id = p_kit and k.active and k.deleted_at is null and t.code = p_template
  order by t.size;
$$;
revoke all on function private.representative_kit_grade_components(uuid, text) from public, anon, authenticated, service_role;

create function public.list_representative_kit_grade_offers()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'kitId', k.id, 'name', k.name, 'description', k.description, 'color', k.grade_color,
    'unitPriceInCents', k.price_in_cents, 'templates', offers.templates
  ) order by k.name, k.id), '[]'::jsonb)
  from public.kits k
  join private.representative_kit_grade_sources() s
    on (s.product_id, s.color) = (k.grade_product_id, k.grade_color)
  cross join lateral (
    select jsonb_agg(jsonb_build_object(
      'code', t.code, 'label', t.label, 'available', stock.available, 'sizes', stock.sizes
    ) order by t.sort_order) as templates
    from (select distinct code, label, sort_order from private.representative_kit_grade_templates()) t
    cross join lateral (
      select min(c.available / c.pairs) as available,
        jsonb_agg(jsonb_build_object('size', c.size, 'pairs', c.pairs) order by c.size) as sizes
      from private.representative_kit_grade_components(k.id, t.code) c
    ) stock
  ) offers
  where k.active and k.deleted_at is null and k.price_in_cents > 0
    and private.representative_catalog_access();
$$;
revoke all on function public.list_representative_kit_grade_offers() from public, anon, service_role;
grant execute on function public.list_representative_kit_grade_offers() to authenticated;
;

-- 20261119140000_representative_kit_grade_checkout.sql
alter table private.representative_kit_shipping_checkout_quotes
  add column grade_kit_id uuid references public.kits(id),
  add column grade_template text,
  add column grade_catalog_hash text check (grade_catalog_hash ~ '^[a-f0-9]{64}$'),
  add constraint representative_kit_quote_grade_complete
    check (num_nonnulls(grade_kit_id, grade_template, grade_catalog_hash) in (0, 3));

create index representative_kit_shipping_quotes_grade_kit
  on private.representative_kit_shipping_checkout_quotes (grade_kit_id) where grade_kit_id is not null;

alter table private.representative_kit_orders
  add column grade_kit_id uuid references public.kits(id),
  add column grade_template text,
  add column grade_fiscal_fingerprint text check (grade_fiscal_fingerprint ~ '^[a-f0-9]{64}$'),
  add column grade_lines jsonb check (jsonb_typeof(grade_lines) = 'array' and jsonb_array_length(grade_lines) between 3 and 6),
  add constraint representative_kit_order_grade_complete
    check (num_nonnulls(grade_kit_id, grade_template, grade_fiscal_fingerprint, grade_lines) in (0, 4));

create index representative_kit_orders_grade_kit
  on private.representative_kit_orders (grade_kit_id) where grade_kit_id is not null;

create function private.representative_kit_grade_snapshot(p_kit uuid, p_template text)
returns jsonb
language sql stable set search_path = ''
as $$
  with components as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'variantId', c.variant_id, 'productId', v.product_id, 'size', c.size, 'pairs', c.pairs,
      'sku', v.sku, 'name', p.name, 'priceCents', inputs.price_cents, 'dimensions', inputs.dimensions,
      'fiscalHash', private.bling_kit_source_hash(v.id)
    ) order by c.variant_id), '[]'::jsonb) as lines,
    coalesce(sum(c.pairs), 0) as pairs
    from private.representative_kit_grade_components(p_kit, p_template) c
    join public.product_variants v on v.id = c.variant_id
    join public.products p on p.id = v.product_id
    join lateral private.representative_kit_shipping_inputs(v.id) inputs on inputs.price_cents > 0
  )
  select jsonb_build_object(
    'kitName', k.name, 'priceCents', k.price_in_cents, 'lines', components.lines,
    'catalogHash', encode(sha256(convert_to(jsonb_build_array(k.id, k.name, p_template,
      k.price_in_cents, components.lines)::text, 'UTF8')), 'hex'),
    'fiscalFingerprint', encode(sha256(convert_to(jsonb_build_array(k.id, p_template, (
      select jsonb_agg(jsonb_build_array(line -> 'variantId', line -> 'pairs', line -> 'fiscalHash') order by line ->> 'variantId')
      from jsonb_array_elements(components.lines) line
    ))::text, 'UTF8')), 'hex')
  )
  from public.kits k cross join components
  where k.id = p_kit and k.price_in_cents > 0 and components.pairs = 12;
$$;
revoke all on function private.representative_kit_grade_snapshot(uuid, text) from public, anon, authenticated, service_role;

create function private.find_representative_kit_approval_by_fingerprint(p_actor uuid, p_fingerprint text, p_origin text)
returns uuid language sql stable set search_path = ''
as $$
  select case when count(*) = 1 then (array_agg(r.id))[1] end
  from private.representative_kit_checkout_approvals a
  join private.representative_resale_fiscal_rule_versions r on r.id = a.rule_version_id
  join private.representative_resale_fiscal_rule_approvals e on e.rule_version_id = r.id
  left join private.representative_resale_fiscal_rule_revocations v on v.rule_version_id = r.id
  where a.actor_id = p_actor and a.revoked_at is null and a.valid_until > statement_timestamp()
    and a.origin_postal_code = p_origin and a.buyer_fiscal_state = 'MG'
    and e.approved_at <= statement_timestamp() and v.rule_version_id is null
    and r.origin_state = 'MG' and r.destination_state = 'MG' and r.person_type = 'business'
    and r.icms_status = 'taxpayer' and r.purpose = 'resale' and not r.final_consumer
    and r.fiscal_parameters ->> 'buyerProfile' = a.buyer_profile
    and statement_timestamp() >= r.valid_from and statement_timestamp() < r.valid_until
    and r.product_fingerprint = p_fingerprint;
$$;
revoke all on function private.find_representative_kit_approval_by_fingerprint(uuid, text, text) from public, anon, authenticated, service_role;

create or replace function private.find_representative_kit_checkout_approval(p_actor uuid, p_variant uuid, p_origin text)
returns uuid language sql stable set search_path = ''
as $$
  select private.find_representative_kit_approval_by_fingerprint(
    p_actor, public.read_representative_resale_product_fingerprint(p_variant), p_origin
  );
$$;

create function public.read_representative_kit_grade_fingerprint(p_kit uuid, p_template text)
returns text language sql stable security definer set search_path = ''
as $$
  select private.representative_kit_grade_snapshot(p_kit, p_template) ->> 'fiscalFingerprint';
$$;
revoke all on function public.read_representative_kit_grade_fingerprint(uuid, text) from public, anon, authenticated;
grant execute on function public.read_representative_kit_grade_fingerprint(uuid, text) to service_role;

create function public.read_representative_kit_grade_shipping(
  p_actor uuid, p_kit uuid, p_template text, p_quantity integer, p_address uuid, p_origin text
) returns jsonb language sql stable security definer set search_path = ''
as $$
  select listing.snapshot || jsonb_build_object(
    'postalCode', regexp_replace(a.postal_code, '[^0-9]', '', 'g'), 'addressVersion', a.updated_at,
    'purchaseAvailable', coalesce(rule.id is not null and private.representative_kit_commercial_configuration(p_actor,rule.id)
      and approval.buyer_fiscal_address ->> 'state' = 'MG', false)
  )
  from public.profiles p
  join public.representatives r on r.user_id = p.id and r.status in ('approved_waiting_kit', 'active', 'unqualified')
  join public.addresses a on a.user_id = p.id and a.id = p_address
  cross join lateral (select private.representative_kit_grade_snapshot(p_kit, p_template) as snapshot) listing
  cross join lateral (select private.find_representative_kit_approval_by_fingerprint(
    p_actor, listing.snapshot ->> 'fiscalFingerprint', p_origin) as id) rule
  left join private.representative_kit_checkout_approvals approval on approval.actor_id = p_actor and approval.rule_version_id = rule.id
  where p.id = p_actor and p.status = 'active' and a.state = 'MG' and a.country = 'BR'
    and regexp_replace(a.postal_code, '[^0-9]', '', 'g') ~ '^3[0-9]{7}$' and p_origin ~ '^3[0-9]{7}$'
    and p_quantity between 1 and 99 and listing.snapshot is not null
    and not exists (
      select 1 from private.representative_kit_grade_components(p_kit, p_template) c
      where c.available < c.pairs * p_quantity
    );
$$;
revoke all on function public.read_representative_kit_grade_shipping(uuid,uuid,text,integer,uuid,text) from public, anon, authenticated;
grant execute on function public.read_representative_kit_grade_shipping(uuid,uuid,text,integer,uuid,text) to service_role;

create function public.confirm_representative_kit_grade_shipping(
  p_actor uuid, p_kit uuid, p_template text, p_quantity integer, p_address uuid, p_origin text,
  p_catalog_hash text, p_address_version timestamptz, p_cart_fingerprint text, p_service_id text, p_service text,
  p_carrier text, p_amount_in_cents integer, p_cost_in_cents integer, p_estimated_days integer,
  p_packages jsonb, p_expires_at timestamptz
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  shipping jsonb;
  issued private.representative_kit_shipping_checkout_quotes;
begin
  shipping := public.read_representative_kit_grade_shipping(p_actor,p_kit,p_template,p_quantity,p_address,p_origin);
  if shipping is null or shipping ->> 'catalogHash' is distinct from p_catalog_hash
    or (shipping ->> 'addressVersion')::timestamptz is distinct from p_address_version
    or p_expires_at <= clock_timestamp() then
    raise exception 'kit_grade_quote_changed' using errcode = '23514';
  end if;

  insert into private.representative_kit_shipping_checkout_quotes (
    actor_id,variant_id,quantity,address_id,address_updated_at,postal_code,cart_fingerprint,
    service_id,service,carrier,amount_in_cents,cost_in_cents,estimated_days,
    packages,expires_at,origin_postal_code,merchandise_unit_cents,grade_kit_id,grade_template,grade_catalog_hash
  ) values (
    p_actor,(shipping -> 'lines' -> 0 ->> 'variantId')::uuid,p_quantity,p_address,p_address_version,
    shipping ->> 'postalCode',p_cart_fingerprint,p_service_id,p_service,p_carrier,p_amount_in_cents,p_cost_in_cents,
    p_estimated_days,p_packages,least(p_expires_at,clock_timestamp()+interval '30 minutes'),
    p_origin,(shipping ->> 'priceCents')::bigint,p_kit,p_template,p_catalog_hash
  ) returning * into issued;
  return jsonb_build_object('id',issued.id,'shippingInCents',issued.amount_in_cents,
    'amountInCents',issued.merchandise_unit_cents*p_quantity+issued.amount_in_cents,
    'purchaseAvailable',shipping -> 'purchaseAvailable');
end;
$$;
revoke all on function public.confirm_representative_kit_grade_shipping(
  uuid,uuid,text,integer,uuid,text,text,timestamptz,text,text,text,text,integer,integer,integer,jsonb,timestamptz
) from public, anon, authenticated;
grant execute on function public.confirm_representative_kit_grade_shipping(
  uuid,uuid,text,integer,uuid,text,text,timestamptz,text,text,text,text,integer,integer,integer,jsonb,timestamptz
) to service_role;

create function public.reserve_representative_kit_grade_order(
  p_actor uuid,p_kit uuid,p_template text,p_quantity integer,p_quote uuid,p_address uuid,p_key uuid,p_origin text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  shipping jsonb;
  quote private.representative_kit_shipping_checkout_quotes;
  placed private.representative_kit_orders;
  delivery public.addresses;
  rule_id uuid;
  component record;
begin
  if p_actor is null or p_key is null or p_kit is null or p_template is null
    or p_quantity is null or p_quantity not between 1 and 99 or p_origin is null or p_origin !~ '^3[0-9]{7}$' then
    raise exception 'invalid_kit_request' using errcode = '22023';
  end if;

  perform 1 from public.profiles p join public.representatives r on r.user_id = p.id
    where p.id = p_actor and p.status = 'active' and r.status in ('approved_waiting_kit','active','unqualified')
    for share of p, r;
  if not found then raise exception 'kit_access_denied' using errcode = '42501'; end if;

  perform pg_advisory_xact_lock(hashtextextended('representative-kit:'||p_actor::text||':'||p_key::text,0));
  select * into placed from private.representative_kit_orders where actor_id=p_actor and idempotency_key=p_key;
  if found then
    if (placed.grade_kit_id,placed.grade_template,placed.quantity,placed.quote_id,placed.address_id)
       is distinct from (p_kit,p_template,p_quantity,p_quote,p_address) then
      raise exception 'kit_idempotency_conflict' using errcode = '23505';
    end if;
    return private.representative_kit_order_summary(placed);
  end if;

  perform 1 from public.kits k where k.id=p_kit and k.active and k.deleted_at is null for share;
  if not found then raise exception 'kit_grade_unavailable' using errcode = '23514'; end if;
  perform 1 from public.kits k join public.products p on p.id=k.grade_product_id
    join private.bling_catalog_metadata m on m.product_id=p.id
    join public.product_variants v on v.product_id=p.id and v.color_name=k.grade_color
    where k.id=p_kit order by v.id for share of v,p,m;

  select * into delivery from public.addresses a
    where a.id=p_address and a.user_id=p_actor and a.country='BR' and a.state='MG'
    for share;
  if not found then raise exception 'kit_access_denied' using errcode = '42501'; end if;

  select * into quote from private.representative_kit_shipping_checkout_quotes q
    where q.id=p_quote and q.actor_id=p_actor and q.grade_kit_id=p_kit and q.grade_template=p_template
      and q.quantity=p_quantity and q.address_id=p_address and q.address_updated_at=delivery.updated_at
      and q.origin_postal_code=p_origin and q.used_at is null and q.expires_at>clock_timestamp()
    for update;
  if not found then raise exception 'kit_quote_unavailable' using errcode = '23514'; end if;
  shipping := public.read_representative_kit_grade_shipping(p_actor,p_kit,p_template,p_quantity,p_address,p_origin);
  if shipping is null or shipping ->> 'catalogHash' is distinct from quote.grade_catalog_hash
    or shipping ->> 'postalCode' is distinct from quote.postal_code then
    raise exception 'kit_grade_quote_changed' using errcode = '23514';
  end if;
  rule_id := private.find_representative_kit_approval_by_fingerprint(p_actor,shipping ->> 'fiscalFingerprint',p_origin);
  if rule_id is null then raise exception 'resale_not_homologated' using errcode = '23514'; end if;

  for component in
    select (line ->> 'variantId')::uuid as variant, (line ->> 'pairs')::integer*p_quantity as units
    from jsonb_array_elements(shipping -> 'lines') line order by (line ->> 'variantId')::uuid
  loop
    update public.inventory set available_quantity=available_quantity-component.units,
      reserved_quantity=reserved_quantity+component.units,version=version+1,updated_at=now()
      where variant_id=component.variant and available_quantity>=component.units;
    if not found then raise exception 'kit_stock_unavailable' using errcode = '23514'; end if;
  end loop;

  update private.representative_kit_shipping_checkout_quotes set used_at=now() where id=quote.id;
  insert into private.representative_kit_orders (
    actor_id,variant_id,quantity,quote_id,address_id,idempotency_key,rule_version_id,
    sku,product_name,unit_price_cents,shipping_cents,shipping_snapshot,reserved_until,
    grade_kit_id,grade_template,grade_fiscal_fingerprint,grade_lines
  ) values (
    p_actor,quote.variant_id,p_quantity,p_quote,p_address,p_key,rule_id,
    shipping -> 'lines' -> 0 ->> 'sku',shipping ->> 'kitName',quote.merchandise_unit_cents,quote.amount_in_cents,
    jsonb_build_object('provider','melhorenvio','originPostalCode',p_origin,
      'serviceId',quote.service_id,'service',quote.service,'carrier',quote.carrier,'packages',quote.packages,
      'costInCents',quote.cost_in_cents,'estimatedDays',quote.estimated_days,
      'address',jsonb_build_object('state','MG','postalCode',quote.postal_code,'version',delivery.updated_at)),
    least(quote.expires_at,clock_timestamp()+interval '15 minutes'),
    p_kit,p_template,shipping ->> 'fiscalFingerprint',shipping -> 'lines'
  ) returning * into placed;
  return private.representative_kit_order_summary(placed);
end;
$$;
revoke all on function public.reserve_representative_kit_grade_order(uuid,uuid,text,integer,uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.reserve_representative_kit_grade_order(uuid,uuid,text,integer,uuid,uuid,uuid,text) to service_role;

create or replace function public.remove_representative_admin_kit(p_kit uuid)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  target public.kits;
begin
  if auth.uid() is null or not private.has_permission('representatives.rules.manage') then
    raise exception 'kit_management_forbidden' using errcode='42501';
  end if;
  select * into target from public.kits where id=p_kit for update;
  if not found then return true; end if;
  if target.deleted_at is not null then return false; end if;
  if target.required_for_activation
    or exists (select 1 from public.kit_orders where kit_id=p_kit)
    or exists (select 1 from public.kit_level_rules where kit_id=p_kit)
    or exists (select 1 from private.representative_kit_shipping_checkout_quotes where grade_kit_id=p_kit)
    or exists (select 1 from private.representative_kit_orders where grade_kit_id=p_kit) then
    update public.kits set active=false,deleted_at=clock_timestamp() where id=p_kit;
    return false;
  end if;
  delete from public.kits where id=p_kit;
  return true;
end;
$$;
;

-- 20261119143000_representative_kit_grade_inventory.sql
create function private.transfer_representative_kit_inventory(
  o private.representative_kit_orders, p_count integer, p_operation text,
  p_reason text, p_reference_type text, p_reference_id uuid, p_operator uuid
) returns void language plpgsql set search_path = ''
as $$
declare
  line record;
  available integer;
  reserved integer;
begin
  if p_count is null or p_count not between 1 and o.quantity
    or p_operation is null or p_operation not in ('release','sell','restock') then
    raise exception 'kit_stock_operation_invalid' using errcode='23514';
  end if;

  for line in
    select stock.variant_id, stock.pairs*p_count as units
    from (
      select o.variant_id as variant_id, 1 as pairs where o.grade_lines is null
      union all
      select (item ->> 'variantId')::uuid, (item ->> 'pairs')::integer
      from jsonb_array_elements(o.grade_lines) item
    ) stock
    order by stock.variant_id
  loop
    update public.inventory
      set reserved_quantity=reserved_quantity-case when p_operation='restock' then 0 else line.units end,
        available_quantity=available_quantity+case when p_operation='sell' then 0 else line.units end,
        version=version+1,updated_at=now()
      where variant_id=line.variant_id and (p_operation='restock' or reserved_quantity>=line.units)
      returning available_quantity,reserved_quantity into available,reserved;
    if not found then raise exception 'kit_stock_inconsistent' using errcode='23514'; end if;
    if p_operation='sell' then
      insert into public.inventory_movements(variant_id,movement_type,quantity,previous_quantity,new_quantity,
        reason,reference_type,reference_id,performed_by)
      values(line.variant_id,'sale',-line.units,available+reserved+line.units,available+reserved,
        p_reason,p_reference_type,p_reference_id,p_operator);
    elsif p_operation='restock' then
      insert into public.inventory_movements(variant_id,movement_type,quantity,previous_quantity,new_quantity,
        reason,reference_type,reference_id,performed_by)
      values(line.variant_id,'return',line.units,available-line.units,available,
        p_reason,p_reference_type,p_reference_id,p_operator);
    end if;
  end loop;
end;
$$;
revoke all on function private.transfer_representative_kit_inventory(
  private.representative_kit_orders,integer,text,text,text,uuid,uuid
) from public, anon, authenticated, service_role;

create or replace function public.cancel_unstarted_representative_kit_order(p_actor uuid, p_order uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  order_row private.representative_kit_orders;
begin
  select * into order_row from private.representative_kit_orders where id = p_order for update;
  if not found or (p_actor is not null and order_row.actor_id <> p_actor) then return false; end if;
  if order_row.state = 'cancelled' then return true; end if;
  if order_row.state <> 'reserved' or order_row.stock_state <> 'reserved'
    or order_row.payment_started_at is not null
    or (p_actor is null and order_row.reserved_until > clock_timestamp()) then return false; end if;

  perform private.transfer_representative_kit_inventory(order_row,order_row.quantity,'release',null,null,null,null);
  update private.representative_kit_orders set state = 'cancelled', stock_state = 'released' where id = p_order;
  return true;
end;
$$;

create or replace function public.settle_representative_kit_payment(
  p_order uuid, p_payment_id text, p_reference text, p_amount bigint, p_currency text,
  p_status text, p_paid_at timestamptz, p_refunds jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  o private.representative_kit_orders;
  refund jsonb;
  refund_total bigint;
  refunded_now bigint;
  next_state text;
  next_stock text;
begin
  select * into o from private.representative_kit_orders where id = p_order for update;
  if not found or o.payment_started_at is null or p_reference is distinct from ('KITMG-' || p_order::text)
    or p_amount is distinct from (o.unit_price_cents * o.quantity + o.shipping_cents)
    or p_currency is distinct from 'BRL' or p_payment_id is null or p_payment_id !~ '^[0-9]{1,30}$'
    or (o.provider_payment_id is not null and o.provider_payment_id <> p_payment_id)
    or p_status is null or jsonb_typeof(p_refunds) is distinct from 'array' or jsonb_array_length(p_refunds) > 100 then
    raise exception 'kit_payment_identity_mismatch' using errcode = '23514';
  end if;

  for refund in select value from jsonb_array_elements(p_refunds) loop
    if coalesce(refund ->> 'id', '') !~ '^[0-9]{1,30}$' or coalesce(refund ->> 'amountInCents','') !~ '^[0-9]{1,15}$' then
      raise exception 'kit_refund_identity_mismatch' using errcode = '23514';
    end if;
    refunded_now := (refund ->> 'amountInCents')::bigint;
    insert into private.representative_kit_provider_refunds(provider_refund_id,order_id,amount_cents)
      values (refund ->> 'id',p_order,refunded_now) on conflict do nothing;
    if not exists (select 1 from private.representative_kit_provider_refunds r
      where r.provider_refund_id = refund ->> 'id' and r.order_id = p_order and r.amount_cents = refunded_now) then
      raise exception 'kit_refund_identity_mismatch' using errcode = '23514';
    end if;
  end loop;
  select coalesce(sum(amount_cents),0) into refund_total from private.representative_kit_provider_refunds where order_id = p_order;
  if refund_total > p_amount then raise exception 'kit_refund_amount_mismatch' using errcode = '23514'; end if;

  next_state := o.state;
  next_stock := o.stock_state;
  if refund_total = p_amount then
    next_state := 'refunded';
    if o.stock_state = 'reserved' then next_stock := 'released'; end if;
  elsif o.state in ('reserved','payment_pending') then
    if p_status = 'approved' and refund_total = 0 and p_paid_at is not null and private.representative_kit_payment_allowed(o) then
      next_state := 'paid';
      next_stock := 'sold';
    elsif p_status in ('cancelled','expired','rejected') and refund_total = 0 then
      next_state := 'cancelled';
      next_stock := 'released';
    elsif p_status in ('pending','in_process') and refund_total = 0 then
      next_state := 'payment_pending';
    else
      next_state := 'manual_review';
    end if;
  elsif (o.state = 'cancelled' and p_status in ('approved','refunded','charged_back'))
    or (o.state = 'paid' and (p_status in ('cancelled','refunded','charged_back','in_mediation') or refund_total > 0)) then
    next_state := 'manual_review';
  end if;

  if o.stock_state = 'reserved' and next_stock <> 'reserved' then
    perform private.transfer_representative_kit_inventory(o,o.quantity,
      case when next_stock='sold' then 'sell' else 'release' end,
      'Pagamento confirmado de kit de revenda MG','representative_kit_order',p_order,o.actor_id);
  end if;

  update private.representative_kit_orders set state = next_state, stock_state = next_stock,
    provider_payment_id = p_payment_id, payment_checked_at = clock_timestamp(),
    paid_at = coalesce(paid_at, case when p_status = 'approved' then p_paid_at end)
    where id = p_order returning * into o;
  return private.representative_kit_order_summary(o) || jsonb_build_object('refundedInCents',refund_total);
end;
$$;

create or replace function private.restore_cancelled_representative_kit_stock()
returns trigger language plpgsql set search_path = '' as $$
declare
  o private.representative_kit_orders;
begin
  if old.provider_refund_id is not null or new.provider_refund_id is null or new.reason <> 'undispatched_cancellation' then return new; end if;
  select * into o from private.representative_kit_orders where id=new.order_id for update;
  if not found or o.state <> 'refunded' or o.stock_state <> 'sold' or o.returned_kit_count <> 0 then return new; end if;
  perform private.transfer_representative_kit_inventory(o,o.quantity,'restock',
    'Estorno confirmado antes da expedição de kit de revenda MG','representative_kit_refund',new.id,o.actor_id);
  update private.representative_kit_orders set stock_state='released',returned_kit_count=o.quantity where id=o.id;
  return new;
end;
$$;

create or replace function private.finalize_representative_kit_return()
returns trigger language plpgsql set search_path = '' as $$
declare
  r private.representative_kit_returns;
  o private.representative_kit_orders;
begin
  if new.reason <> 'accepted_return' then return new; end if;
  if tg_when='BEFORE' then
    if old.started_at is null and new.started_at is not null and not exists(
      select 1 from private.representative_kit_returns q where q.id=new.kit_return_id and q.order_id=new.order_id
        and q.state='refund_pending' and q.invoice_key=new.return_invoice_key and q.refund_cents=new.amount_cents
        and q.invoice_protocol is not null and q.invoice_sha256 is not null
    ) then raise exception 'kit_return_verification_required' using errcode='23514'; end if;
    return new;
  end if;
  if old.provider_refund_id is not null or new.provider_refund_id is null then return new; end if;
  select * into o from private.representative_kit_orders where id=new.order_id for update;
  select * into r from private.representative_kit_returns where id=new.kit_return_id for update;
  if not found or r.state<>'refund_pending' or r.order_id<>o.id or o.returned_kit_count+r.quantity>o.quantity
    then raise exception 'kit_return_stock_mismatch' using errcode='23514'; end if;
  update private.representative_kit_orders set returned_kit_count=returned_kit_count+r.quantity,
    stock_state=case when returned_kit_count+r.quantity=quantity then 'released' else stock_state end where id=o.id;
  if r.restock_quantity>0 then
    perform private.transfer_representative_kit_inventory(o,r.restock_quantity,'restock',
      'Devolução inspecionada de kit de revenda MG','representative_kit_return',r.id,r.inspected_by);
  end if;
  update private.representative_kit_returns set state='completed' where id=r.id;
  return new;
end;
$$;

create or replace function private.representative_kit_payment_allowed(o private.representative_kit_orders)
returns boolean language sql stable set search_path = '' as $$
  select coalesce(private.find_representative_kit_approval_by_fingerprint(o.actor_id,
    coalesce(o.grade_fiscal_fingerprint,public.read_representative_resale_product_fingerprint(o.variant_id)),
    o.shipping_snapshot ->> 'originPostalCode')=o.rule_version_id,false)
  and exists (
    select 1 from public.profiles p join public.representatives r on r.user_id=p.id
    join public.addresses a on a.user_id=p.id
    join private.representative_kit_checkout_approvals buyer on buyer.actor_id=p.id and buyer.rule_version_id=o.rule_version_id
    where p.id=o.actor_id and p.status='active' and r.status in ('approved_waiting_kit','active','unqualified')
      and a.id=o.address_id and a.state='MG' and a.country='BR'
      and a.updated_at=(o.shipping_snapshot -> 'address' ->> 'version')::timestamptz
      and regexp_replace(a.postal_code,'[^0-9]','','g')=o.shipping_snapshot -> 'address' ->> 'postalCode'
      and o.buyer_snapshot=jsonb_build_object('name',buyer.buyer_legal_name,'document',buyer.buyer_document,
        'registration',buyer.buyer_state_registration,'address',buyer.buyer_fiscal_address)
  );
$$;
;

-- 20261119150000_representative_kit_grade_fiscal.sql
create or replace function public.due_representative_kit_fulfillment()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(due)),'[]'::jsonb) from (
    select f.order_id as "orderId", f.bling_sale_id as "saleId", f.bling_invoice_id as "invoiceId",
      f.shipment_id as "shipmentId", f.shipment_status as "shipmentStatus", o.variant_id as "variantId",
      o.sku, o.product_name as "productName", o.quantity, o.paid_at as "paidAt", o.grade_lines as "gradeLines",
      o.unit_price_cents as "unitPriceInCents", o.shipping_cents as "shippingInCents",
      o.unit_price_cents * o.quantity + o.shipping_cents as "amountInCents",
      o.shipping_snapshot ->> 'serviceId' as "serviceId",
      o.shipping_snapshot ->> 'originPostalCode' as "originPostalCode",
      o.shipping_snapshot -> 'address' ->> 'postalCode' as "postalCode",
      a.buyer_profile as "buyerProfile", a.buyer_document as "buyerDocument", a.buyer_state_registration as "buyerStateRegistration",
      r.fiscal_parameters as "fiscalParameters"
    from private.representative_kit_fulfillment f
    join private.representative_kit_orders o on o.id = f.order_id
    join private.representative_kit_checkout_approvals a on a.actor_id = o.actor_id and a.rule_version_id = o.rule_version_id
    join private.representative_resale_fiscal_rule_versions r on r.id = o.rule_version_id
    where o.state = 'paid' and o.stock_state = 'sold' and private.representative_kit_payment_allowed(o)
      and not exists (
        select 1 from jsonb_array_elements(o.grade_lines) item
        where private.bling_kit_source_hash((item ->> 'variantId')::uuid) is distinct from item ->> 'fiscalHash'
      )
      and coalesce(f.shipment_status,'pending') not in ('returned','cancelled','delivered')
      and (f.checked_at is null or f.checked_at < now() - interval '15 minutes')
      and not exists(select 1 from private.bling_order_links b
        where b.invoice_id = f.bling_invoice_id or b.external_order_id = f.bling_sale_id)
    order by f.checked_at nulls first, f.order_id limit 3
  ) due;
$$;
;

-- 20261119153000_representative_kit_collection.sql
create table private.representative_kit_collection_routes (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 3 and 100),
  origin_postal_code text not null check (origin_postal_code ~ '^3[0-9]{7}$'),
  destination_from text not null check (destination_from ~ '^3[0-9]{7}$'),
  destination_through text not null check (destination_through ~ '^3[0-9]{7}$'),
  delivery_cents integer not null check (delivery_cents >= 0),
  estimated_days integer not null check (estimated_days between 0 and 60),
  bling_method_ids jsonb not null check (
    jsonb_typeof(bling_method_ids)='object'
    and (bling_method_ids ->> 'cash') ~ '^[1-9][0-9]{0,14}$'
    and (bling_method_ids ->> 'pix') ~ '^[1-9][0-9]{0,14}$'
    and (bling_method_ids ->> 'debit_card') ~ '^[1-9][0-9]{0,14}$'
    and (bling_method_ids ->> 'credit_card') ~ '^[1-9][0-9]{0,14}$'
    and bling_method_ids ?& array['cash','pix','debit_card','credit_card']
  ),
  point_terminal_id text not null check (point_terminal_id ~ '^[A-Za-z0-9_]{4,80}$'),
  verified_evidence text not null check (length(btrim(verified_evidence)) between 10 and 500),
  valid_until timestamptz not null,
  closed_at timestamptz,
  check (destination_from <= destination_through)
);
alter table private.representative_kit_collection_routes enable row level security;
alter table private.representative_kit_collection_routes force row level security;
revoke all on private.representative_kit_collection_routes from public, anon, authenticated, service_role;

alter table private.representative_kit_shipping_checkout_quotes
  add column collection_route_id uuid references private.representative_kit_collection_routes(id);
create index representative_kit_quotes_collection_route
  on private.representative_kit_shipping_checkout_quotes(collection_route_id) where collection_route_id is not null;

alter table private.representative_kit_orders
  drop constraint representative_kit_orders_state_check,
  add constraint representative_kit_orders_state_check
    check (state in ('reserved','payment_pending','paid','cancelled','refunded','manual_review','awaiting_receipt')),
  add column collection_route_id uuid references private.representative_kit_collection_routes(id),
  add column collection_method text check (collection_method in ('cash','pix','debit_card','credit_card')),
  add column collection_bling_method bigint check (collection_bling_method > 0),
  add column collection_point_terminal text,
  add column cash_tendered_cents bigint,
  add column cash_change_cents bigint generated always as (cash_tendered_cents-unit_price_cents*quantity-shipping_cents) stored,
  add constraint representative_kit_order_collection_complete check (
    num_nonnulls(collection_route_id,collection_method,collection_bling_method,collection_point_terminal) in (0,4)
    and ((collection_method is not distinct from 'cash') = (cash_tendered_cents is not null))
    and (cash_tendered_cents is null or cash_tendered_cents >= unit_price_cents*quantity+shipping_cents)
    and (state <> 'awaiting_receipt' or collection_route_id is not null)
  );
create index representative_kit_orders_collection_route
  on private.representative_kit_orders(collection_route_id) where collection_route_id is not null;

create function public.quote_representative_kit_collection(
  p_actor uuid,p_selection uuid,p_template text,p_quantity integer,p_address uuid,p_origin text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  route private.representative_kit_collection_routes;
  address_row public.addresses;
  postal text;
  grade_shipping jsonb;
  inserted jsonb;
  price bigint;
  dimensions jsonb;
  expiry timestamptz := clock_timestamp()+interval '15 minutes';
begin
  if p_quantity is null or p_quantity not between 1 and 99 then return null; end if;
  select * into address_row from public.addresses a where a.user_id=p_actor
    and a.id=p_address and a.state='MG' and a.country='BR' for share;
  if not found then return null; end if;
  postal:=regexp_replace(address_row.postal_code,'[^0-9]','','g');
  if postal !~ '^3[0-9]{7}$' then return null; end if;
  select q.* into route from private.representative_kit_collection_routes q
    where q.origin_postal_code=p_origin and postal between q.destination_from and q.destination_through
      and q.valid_until>expiry and q.closed_at is null
      and 1=(select count(*) from private.representative_kit_collection_routes t
        where t.origin_postal_code=p_origin and postal between t.destination_from and t.destination_through
          and t.valid_until>expiry and t.closed_at is null)
    for share;
  if not found then return null; end if;
  if p_template is null then
    if not public.representative_kit_purchase_available(p_actor,p_selection,p_origin) then return null; end if;
    select inputs.price_cents,inputs.dimensions into price,dimensions
      from private.representative_kit_shipping_inputs(p_selection) inputs
      join private.bling_catalog_metadata m on m.product_id=(select product_id from public.product_variants where id=p_selection)
      join public.inventory i on i.variant_id=p_selection
      where m.pairs_per_sku>1 and i.available_quantity>=p_quantity;
    if not found or price<=0 then return null; end if;
    inserted:=public.confirm_representative_kit_shipping_quote(
      p_actor,p_selection,p_quantity,p_address,postal,repeat('0',64),'recebimento',route.name,route.name,
      route.delivery_cents,route.delivery_cents,route.estimated_days,'[]'::jsonb,expiry,p_origin,price,dimensions);
  else
    grade_shipping:=public.read_representative_kit_grade_shipping(p_actor,p_selection,p_template,p_quantity,p_address,p_origin);
    if grade_shipping -> 'purchaseAvailable' is distinct from 'true'::jsonb then return null; end if;
    price:=(grade_shipping ->> 'priceCents')::bigint;
    inserted:=public.confirm_representative_kit_grade_shipping(
      p_actor,p_selection,p_template,p_quantity,p_address,p_origin,grade_shipping ->> 'catalogHash',
      address_row.updated_at,repeat('0',64),'recebimento',route.name,route.name,route.delivery_cents,
      route.delivery_cents,route.estimated_days,'[]'::jsonb,expiry);
  end if;
  if inserted ->> 'id' is null then return null; end if;
  update private.representative_kit_shipping_checkout_quotes set collection_route_id=route.id
    where id=(inserted ->> 'id')::uuid;
  return jsonb_build_object('id',inserted -> 'id','shippingInCents',route.delivery_cents,
    'amountInCents',price*p_quantity+route.delivery_cents,'estimatedDays',route.estimated_days,'service',route.name);
end;
$$;
revoke all on function public.quote_representative_kit_collection(uuid,uuid,text,integer,uuid,text) from public, anon, authenticated;
grant execute on function public.quote_representative_kit_collection(uuid,uuid,text,integer,uuid,text) to service_role;

alter function public.reserve_representative_kit_order(uuid,uuid,integer,uuid,uuid,uuid,text) set schema private;
alter function public.reserve_representative_kit_grade_order(uuid,uuid,text,integer,uuid,uuid,uuid,text) set schema private;
revoke all on function private.reserve_representative_kit_order(uuid,uuid,integer,uuid,uuid,uuid,text),
  private.reserve_representative_kit_grade_order(uuid,uuid,text,integer,uuid,uuid,uuid,text)
  from public, anon, authenticated, service_role;

create function public.reserve_representative_kit_order(
  p_actor uuid,p_variant uuid,p_quantity integer,p_quote uuid,p_address uuid,p_key uuid,p_origin_postal_code text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from private.representative_kit_shipping_checkout_quotes
    where id=p_quote and collection_route_id is not null)
    or exists(select 1 from private.representative_kit_orders
      where actor_id=p_actor and idempotency_key=p_key and collection_route_id is not null) then
    raise exception 'kit_collection_selection_required' using errcode='23514';
  end if;
  return private.reserve_representative_kit_order(p_actor,p_variant,p_quantity,p_quote,p_address,p_key,p_origin_postal_code);
end;
$$;

create function public.reserve_representative_kit_grade_order(
  p_actor uuid,p_kit uuid,p_template text,p_quantity integer,p_quote uuid,p_address uuid,p_key uuid,p_origin text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from private.representative_kit_shipping_checkout_quotes
    where id=p_quote and collection_route_id is not null)
    or exists(select 1 from private.representative_kit_orders
      where actor_id=p_actor and idempotency_key=p_key and collection_route_id is not null) then
    raise exception 'kit_collection_selection_required' using errcode='23514';
  end if;
  return private.reserve_representative_kit_grade_order(p_actor,p_kit,p_template,p_quantity,p_quote,p_address,p_key,p_origin);
end;
$$;
revoke all on function public.reserve_representative_kit_order(uuid,uuid,integer,uuid,uuid,uuid,text),
  public.reserve_representative_kit_grade_order(uuid,uuid,text,integer,uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.reserve_representative_kit_order(uuid,uuid,integer,uuid,uuid,uuid,text),
  public.reserve_representative_kit_grade_order(uuid,uuid,text,integer,uuid,uuid,uuid,text) to service_role;

create or replace function private.representative_kit_order_summary(o private.representative_kit_orders)
returns jsonb language sql stable set search_path = ''
as $$
  select jsonb_build_object('orderId',o.id,'state',o.state,'variantId',o.variant_id,
    'quantity',o.quantity,'amountInCents',o.unit_price_cents*o.quantity+o.shipping_cents,
    'shippingInCents',o.shipping_cents,'reservedUntil',o.reserved_until,
    'collectionMethod',o.collection_method,'cashTenderedInCents',o.cash_tendered_cents,'cashChangeInCents',o.cash_change_cents);
$$;

create function public.reserve_representative_kit_collection_order(
  p_actor uuid,p_selection uuid,p_template text,p_quantity integer,p_quote uuid,p_address uuid,
  p_key uuid,p_origin text,p_method text,p_cash_tendered bigint
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  route private.representative_kit_collection_routes;
  reserved jsonb;
  o private.representative_kit_orders;
  total bigint;
begin
  if p_actor is null or p_key is null or p_method is null
    or p_method not in ('cash','pix','debit_card','credit_card') or (p_method='cash')<>(p_cash_tendered is not null) then
    raise exception 'invalid_kit_collection' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('representative-kit:'||p_actor::text||':'||p_key::text,0));
  select * into o from private.representative_kit_orders where actor_id=p_actor and idempotency_key=p_key;
  if found then
    if (coalesce(o.grade_kit_id,o.variant_id),o.grade_template,o.quantity,o.quote_id,o.address_id,o.collection_method,o.cash_tendered_cents)
      is distinct from (p_selection,p_template,p_quantity,p_quote,p_address,p_method,p_cash_tendered) then
      raise exception 'kit_idempotency_conflict' using errcode='23505';
    end if;
    return private.representative_kit_order_summary(o);
  end if;

  select cr.* into route from private.representative_kit_shipping_checkout_quotes q
    join private.representative_kit_collection_routes cr on cr.id=q.collection_route_id
    where q.id=p_quote and q.actor_id=p_actor and q.address_id=p_address and q.origin_postal_code=p_origin
      and cr.origin_postal_code=p_origin and q.postal_code between cr.destination_from and cr.destination_through
      and cr.delivery_cents=q.amount_in_cents and cr.estimated_days=q.estimated_days
      and cr.valid_until>clock_timestamp() and cr.closed_at is null for share of cr;
  if not found then raise exception 'kit_collection_unavailable' using errcode='23514'; end if;

  if p_template is null then
    reserved:=private.reserve_representative_kit_order(p_actor,p_selection,p_quantity,p_quote,p_address,p_key,p_origin);
  else
    reserved:=private.reserve_representative_kit_grade_order(p_actor,p_selection,p_template,p_quantity,p_quote,p_address,p_key,p_origin);
  end if;
  total:=(reserved ->> 'amountInCents')::bigint;
  if p_method='cash' and (p_cash_tendered<total or p_cash_tendered>9007199254740991) then
    raise exception 'kit_cash_tender_invalid' using errcode='23514';
  end if;
  update private.representative_kit_orders set state='awaiting_receipt',collection_route_id=route.id,
    collection_method=p_method,collection_bling_method=(route.bling_method_ids ->> p_method)::bigint,
    collection_point_terminal=route.point_terminal_id,cash_tendered_cents=p_cash_tendered,
    shipping_snapshot=jsonb_set(shipping_snapshot,'{provider}','"own_delivery"')
    where id=(reserved ->> 'orderId')::uuid returning * into o;
  insert into private.representative_kit_fulfillment(order_id) values (o.id) on conflict do nothing;
  return private.representative_kit_order_summary(o);
end;
$$;
revoke all on function public.reserve_representative_kit_collection_order(uuid,uuid,text,integer,uuid,uuid,uuid,text,text,bigint)
  from public, anon, authenticated;
grant execute on function public.reserve_representative_kit_collection_order(uuid,uuid,text,integer,uuid,uuid,uuid,text,text,bigint)
  to service_role;
;

-- 20261119160000_representative_kit_collection_operations.sql
alter table private.representative_kit_collection_routes
  add constraint representative_kit_collection_method_ids_present check (coalesce(
    (bling_method_ids ->> 'cash') ~ '^[1-9][0-9]{0,14}$'
    and (bling_method_ids ->> 'pix') ~ '^[1-9][0-9]{0,14}$'
    and (bling_method_ids ->> 'debit_card') ~ '^[1-9][0-9]{0,14}$'
    and (bling_method_ids ->> 'credit_card') ~ '^[1-9][0-9]{0,14}$', false));

create table private.representative_kit_collection_payments (
  order_id uuid primary key references private.representative_kit_orders(id),
  point_key uuid unique,
  point_order_id text unique check (point_order_id ~ '^ORD[A-Za-z0-9]{12,62}$'),
  point_status text check (point_status in ('created','at_terminal','processed','failed','expired','canceled','action_required','refunded')),
  opened_at timestamptz not null default clock_timestamp(),
  opened_by uuid not null references public.profiles(id),
  receipt_reference text check (length(btrim(receipt_reference)) between 10 and 200),
  confirmed_at timestamptz,
  check ((receipt_reference is not null) = (confirmed_at is not null))
);
alter table private.representative_kit_collection_payments enable row level security;
alter table private.representative_kit_collection_payments force row level security;
revoke all on private.representative_kit_collection_payments from public, anon, authenticated, service_role;

create function private.representative_kit_fiscal_ready(o private.representative_kit_orders)
returns boolean language sql stable set search_path = ''
as $$
  select (o.state='paid' and o.stock_state='sold'
      or o.state='awaiting_receipt' and o.stock_state='reserved' and o.collection_route_id is not null)
    and private.representative_kit_payment_allowed(o);
$$;
revoke all on function private.representative_kit_fiscal_ready(private.representative_kit_orders)
  from public, anon, authenticated, service_role;

create function private.can_cancel_unshipped_kit_collection(o private.representative_kit_orders)
returns boolean language sql stable set search_path = ''
as $$
  select o.state='awaiting_receipt' and o.stock_state='reserved' and o.collection_route_id is not null
    and not exists (select 1 from private.representative_kit_fulfillment f where f.order_id=o.id
      and (f.bling_sale_id is not null or f.bling_invoice_id is not null or f.shipment_rank>=4))
    and not exists (select 1 from private.representative_kit_fulfillment_writes w where w.order_id=o.id);
$$;
revoke all on function private.can_cancel_unshipped_kit_collection(private.representative_kit_orders)
  from public, anon, authenticated, service_role;

create function public.list_representative_kit_collection_work()
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not private.has_permission('orders.update_operational_status') then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  return (select coalesce(jsonb_agg(rows.summary),'[]'::jsonb) from (
    select private.representative_kit_order_summary(o) || jsonb_build_object(
      'productName',o.product_name,'invoiceAuthorized',f.invoice_confirmed_at is not null,
      'shipmentStatus',f.shipment_status,'pointStarted',p.point_key is not null,'pointLinked',p.point_order_id is not null,
      'pointStatus',p.point_status,
      'receiptConfirmed',p.confirmed_at is not null,'cancellationRequested',o.cancellation_requested_at is not null,
      'invoiceCancelled',f.invoice_cancellation_confirmed_at is not null) as summary
    from private.representative_kit_orders o join private.representative_kit_fulfillment f on f.order_id=o.id
    left join private.representative_kit_collection_payments p on p.order_id=o.id
    where o.collection_route_id is not null
    order by o.created_at desc,o.id limit 50
  ) rows);
end;
$$;
revoke all on function public.list_representative_kit_collection_work() from public, anon;
grant execute on function public.list_representative_kit_collection_work() to authenticated;

create function private.confirm_representative_kit_collection_receipt(
  o private.representative_kit_orders, p_reference text, p_operator uuid
) returns boolean language plpgsql set search_path = ''
as $$
begin
  if o.state='paid' and exists (select 1 from private.representative_kit_collection_payments p
    where p.order_id=o.id and p.receipt_reference=p_reference and p.confirmed_at is not null) then return true; end if;
  if o.state<>'awaiting_receipt' or o.stock_state<>'reserved' or o.cancellation_requested_at is not null
    or not exists (select 1 from private.representative_kit_fulfillment f
      where f.order_id=o.id and f.shipment_status='dispatched' and f.invoice_access_key is not null
        and f.invoice_cancellation_confirmed_at is null) then return false; end if;

  perform private.transfer_representative_kit_inventory(o,o.quantity,'sell',
    'Pagamento no recebimento de kit de revenda MG','representative_kit_order',o.id,p_operator);
  update private.representative_kit_collection_payments set receipt_reference=p_reference,confirmed_at=clock_timestamp()
    where order_id=o.id and confirmed_at is null;
  if not found then raise exception 'kit_collection_receipt_unavailable' using errcode='23514'; end if;
  update private.representative_kit_orders set state='paid',stock_state='sold',paid_at=clock_timestamp() where id=o.id;
  update private.representative_kit_fulfillment set shipment_status='delivered',shipment_rank=7 where order_id=o.id;
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
    values(p_operator,private.current_app_role(),'representative.kit.collection.confirmed','representative_kit_order',o.id,
      jsonb_build_object('method',o.collection_method,'amountInCents',o.unit_price_cents*o.quantity+o.shipping_cents));
  return true;
end;
$$;
revoke all on function private.confirm_representative_kit_collection_receipt(private.representative_kit_orders,text,uuid)
  from public, anon, authenticated, service_role;

create function public.manage_representative_kit_collection(p_order uuid,p_action text,p_evidence text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  o private.representative_kit_orders;
  f private.representative_kit_fulfillment;
begin
  if auth.uid() is null or not private.has_permission('orders.update_operational_status') then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  if length(btrim(coalesce(p_evidence,''))) not between 10 and 200 then return null; end if;
  select * into o from private.representative_kit_orders where id=p_order and collection_route_id is not null for update;
  if not found or o.actor_id=auth.uid() then return null; end if;
  select * into f from private.representative_kit_fulfillment where order_id=p_order for update;
  if not found then return null; end if;
  if p_action='cash_received' and o.collection_method='cash' and (
    o.state='paid' or o.state='awaiting_receipt' and f.shipment_status='dispatched' and o.cancellation_requested_at is null
  ) then
    insert into private.representative_kit_collection_payments(order_id,opened_by) values(o.id,auth.uid()) on conflict do nothing;
    if not private.confirm_representative_kit_collection_receipt(o,btrim(p_evidence),auth.uid()) then return null; end if;
  elsif p_action='dispatch' and o.state='awaiting_receipt' and o.cancellation_requested_at is null
    and private.representative_kit_fiscal_ready(o) and f.shipment_rank<4 and f.invoice_access_key is not null
    and f.invoice_confirmed_at>clock_timestamp()-interval '30 minutes' then
    update private.representative_kit_fulfillment set shipment_status='dispatched',shipment_rank=4 where order_id=o.id;
  elsif p_action='cancel_before_dispatch' and o.state='awaiting_receipt' and o.cancellation_requested_at is null
    and f.shipment_rank<4 and f.bling_invoice_id is not null then
    update private.representative_kit_orders set cancellation_requested_at=clock_timestamp() where id=o.id;
    update private.representative_kit_fulfillment set shipment_status='delayed',shipment_rank=5,checked_at=null where order_id=o.id;
  elsif p_action='delivery_failed' and o.state='awaiting_receipt' and f.shipment_status='dispatched'
    and not exists (select 1 from private.representative_kit_collection_payments p where p.order_id=o.id
      and (p.point_status is null or p.point_status not in ('failed','expired','canceled') or p.confirmed_at is not null)) then
    update private.representative_kit_orders set cancellation_requested_at=clock_timestamp() where id=o.id;
    update private.representative_kit_fulfillment set shipment_status='delayed',shipment_rank=5,checked_at=null where order_id=o.id;
  elsif p_action='returned_unpaid' and o.state='awaiting_receipt' and o.cancellation_requested_at is not null
    and f.shipment_status='delayed' and f.invoice_cancellation_confirmed_at is not null
    and not exists (select 1 from private.representative_kit_collection_payments p where p.order_id=o.id
      and (p.point_status is null or p.point_status not in ('failed','expired','canceled') or p.confirmed_at is not null)) then
    perform private.transfer_representative_kit_inventory(o,o.quantity,'release',null,null,null,null);
    update private.representative_kit_orders set state='cancelled',stock_state='released' where id=o.id;
    update private.representative_kit_fulfillment set shipment_status='returned',shipment_rank=8 where order_id=o.id;
  else
    return null;
  end if;
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
    values(auth.uid(),private.current_app_role(),'representative.kit.collection.'||p_action,'representative_kit_order',o.id,
      jsonb_build_object('evidence',btrim(p_evidence)));
  return jsonb_build_object('ok',true);
end;
$$;
revoke all on function public.manage_representative_kit_collection(uuid,text,text) from public, anon;
grant execute on function public.manage_representative_kit_collection(uuid,text,text) to authenticated;

create function public.open_representative_kit_point(p_order uuid,p_begin boolean)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  o private.representative_kit_orders;
  payment private.representative_kit_collection_payments;
begin
  if auth.uid() is null or not private.has_permission('orders.update_operational_status') then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  select * into o from private.representative_kit_orders where id=p_order and collection_method in ('pix','debit_card','credit_card') for update;
  if not found or o.actor_id=auth.uid() or o.cancellation_requested_at is not null or o.state not in ('awaiting_receipt','paid')
    or not exists (select 1 from private.representative_kit_fulfillment f where f.order_id=o.id
      and f.shipment_status in ('dispatched','delivered') and f.invoice_access_key is not null
      and f.invoice_cancellation_confirmed_at is null) then return null; end if;
  if p_begin then
    insert into private.representative_kit_collection_payments(order_id,point_key,opened_by)
      values(o.id,gen_random_uuid(),auth.uid()) on conflict(order_id) do nothing;
  end if;
  select * into payment from private.representative_kit_collection_payments where order_id=o.id for update;
  if not found then return null; end if;
  if p_begin and payment.point_status in ('failed','expired','canceled') and payment.confirmed_at is null then
    insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
      values(auth.uid(),private.current_app_role(),'representative.kit.point.retry','representative_kit_order',o.id,
        jsonb_build_object('previousPointOrder',payment.point_order_id,'previousPointStatus',payment.point_status));
    update private.representative_kit_collection_payments set point_key=gen_random_uuid(),
      point_order_id=null,point_status=null,opened_by=auth.uid(),opened_at=clock_timestamp()
      where order_id=o.id returning * into payment;
  end if;
  if payment.point_order_id is null and payment.opened_at<=clock_timestamp()-interval '20 hours' then return null; end if;
  return jsonb_build_object('pointOrderId',payment.point_order_id,'pointKey',payment.point_key,
    'method',o.collection_method,'terminal',o.collection_point_terminal,'amountInCents',o.unit_price_cents*o.quantity+o.shipping_cents,
    'confirmed',payment.confirmed_at is not null);
end;
$$;
revoke all on function public.open_representative_kit_point(uuid,boolean) from public, anon;
grant execute on function public.open_representative_kit_point(uuid,boolean) to authenticated;

create function public.record_representative_kit_point(
  p_order uuid,p_key uuid,p_point_order text,p_status text,p_receipt text
) returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  o private.representative_kit_orders;
  payment private.representative_kit_collection_payments;
begin
  select * into o from private.representative_kit_orders where id=p_order for update;
  if not found or o.collection_method not in ('pix','debit_card','credit_card')
    or p_status is null or ((p_status='processed')<>(p_receipt is not null)) then return false; end if;
  update private.representative_kit_collection_payments set point_order_id=p_point_order,point_status=p_status
    where order_id=p_order and point_key=p_key and (point_order_id is null or point_order_id=p_point_order)
      and (point_status is null or point_status not in ('processed','failed','expired','canceled','refunded')
        or point_status=p_status or (point_status='processed' and p_status='refunded'))
    returning * into payment;
  if not found then return false; end if;
  if p_receipt is null then return true; end if;
  return private.confirm_representative_kit_collection_receipt(o,p_receipt,payment.opened_by);
end;
$$;
revoke all on function public.record_representative_kit_point(uuid,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.record_representative_kit_point(uuid,uuid,text,text,text) to service_role;
;

-- 20261119163000_representative_kit_collection_fiscal.sql
create or replace function public.due_representative_kit_fulfillment()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(due)),'[]'::jsonb) from (
    select f.order_id as "orderId", f.bling_sale_id as "saleId", f.bling_invoice_id as "invoiceId",
      f.shipment_id as "shipmentId", f.shipment_status as "shipmentStatus", o.variant_id as "variantId",
      o.sku, o.product_name as "productName", o.quantity, coalesce(o.paid_at,o.created_at) as "paidAt", o.grade_lines as "gradeLines",
      o.collection_method as "collectionMethod", o.collection_bling_method as "collectionBlingMethod", o.created_at as "createdAt",
      o.shipping_snapshot ->> 'estimatedDays' as "deliveryDays",
      o.unit_price_cents as "unitPriceInCents", o.shipping_cents as "shippingInCents",
      o.unit_price_cents * o.quantity + o.shipping_cents as "amountInCents",
      o.shipping_snapshot ->> 'serviceId' as "serviceId",
      o.shipping_snapshot ->> 'originPostalCode' as "originPostalCode",
      o.shipping_snapshot -> 'address' ->> 'postalCode' as "postalCode",
      a.buyer_profile as "buyerProfile", a.buyer_document as "buyerDocument", a.buyer_state_registration as "buyerStateRegistration",
      r.fiscal_parameters as "fiscalParameters"
    from private.representative_kit_fulfillment f
    join private.representative_kit_orders o on o.id = f.order_id
    join private.representative_kit_checkout_approvals a on a.actor_id = o.actor_id and a.rule_version_id = o.rule_version_id
    join private.representative_resale_fiscal_rule_versions r on r.id = o.rule_version_id
    where private.representative_kit_fiscal_ready(o)
      and not exists (
        select 1 from jsonb_array_elements(o.grade_lines) item
        where private.bling_kit_source_hash((item ->> 'variantId')::uuid) is distinct from item ->> 'fiscalHash'
      )
      and coalesce(f.shipment_status,'pending') not in ('returned','cancelled','delivered')
      and (f.checked_at is null or f.checked_at < now() - interval '15 minutes')
      and not exists(select 1 from private.bling_order_links b
        where b.invoice_id = f.bling_invoice_id or b.external_order_id = f.bling_sale_id)
    order by f.checked_at nulls first, f.order_id limit 3
  ) due;
$$;

create or replace function public.record_representative_kit_authorized_invoice(
  p_order uuid, p_sale bigint, p_invoice bigint, p_key text, p_protocol text, p_sha256 text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  o private.representative_kit_orders;
begin
  select * into o from private.representative_kit_orders where id = p_order for update;
  if not found or not private.representative_kit_fiscal_ready(o)
    or p_key is null or p_key !~ '^31[0-9]{42}$' or substr(p_key,21,5) <> '55002'
    or p_protocol is null or p_protocol !~ '^[0-9]{15}$'
    or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then return false; end if;
  update private.representative_kit_fulfillment set invoice_access_key = p_key, invoice_protocol = p_protocol,
    invoice_xml_sha256 = p_sha256, invoice_confirmed_at = clock_timestamp()
    where order_id = p_order and bling_sale_id = p_sale and bling_invoice_id = p_invoice
      and (invoice_access_key is null or (invoice_access_key = p_key and invoice_protocol = p_protocol and invoice_xml_sha256 = p_sha256))
      and not exists (select 1 from private.bling_order_links b
        where b.invoice_id = p_invoice or b.external_order_id = p_sale or b.invoice_access_key = p_key);
  return found;
end;
$$;

create or replace function public.read_representative_kit_bling_order(p_order uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('saleId',f.bling_sale_id,'invoiceId',f.bling_invoice_id,
    'buyerName',o.buyer_snapshot -> 'name','buyerDocument',o.buyer_snapshot -> 'document',
    'buyerRegistration',o.buyer_snapshot -> 'registration','fiscalAddress',o.buyer_snapshot -> 'address',
    'reviewedDraftHash',f.reviewed_draft_hash,'draftHash',f.invoice_draft_hash,
    'address',jsonb_build_object('street',d.street,'number',d.number,'district',d.district,'city',d.city,
      'complement',d.complement,'state',d.state,'postal_code',o.shipping_snapshot -> 'address' ->> 'postalCode'))
  from private.representative_kit_orders o
  join private.representative_kit_fulfillment f on f.order_id=o.id
  join public.addresses d on d.id=o.address_id and d.user_id=o.actor_id
  where o.id=p_order and private.representative_kit_fiscal_ready(o)
    and o.cancellation_requested_at is null
    and private.representative_kit_commercial_configuration(o.actor_id,o.rule_version_id)
    and not exists(select 1 from private.representative_kit_refund_requests r where r.order_id=o.id);
$$;

create or replace function public.read_representative_kit_payment(p_actor uuid, p_order uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select private.representative_kit_order_summary(o) ||
    jsonb_build_object('providerPaymentId',o.provider_payment_id,'startedAt',o.payment_started_at,
      'cancellationRequested',o.cancellation_requested_at is not null,
      'customerCanPay',o.state='payment_pending' and private.representative_kit_payment_allowed(o),
      'canCancelPaid',o.cancellation_requested_at is null and private.can_cancel_unshipped_representative_kit(o),
      'canCancelCollection',o.cancellation_requested_at is null and private.can_cancel_unshipped_kit_collection(o))
  from private.representative_kit_orders o where o.id=p_order and o.actor_id=p_actor;
$$;

create or replace function public.request_representative_kit_payment_cancellation(p_actor uuid, p_order uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  o private.representative_kit_orders;
begin
  select * into o from private.representative_kit_orders where actor_id=p_actor and id=p_order for update;
  if not found then return null; end if;
  if o.state='awaiting_receipt' then
    if not private.can_cancel_unshipped_kit_collection(o) then
      raise exception 'kit_requires_cancellation_review' using errcode='23514';
    end if;
    perform private.transfer_representative_kit_inventory(o,o.quantity,'release',null,null,null,null);
    update private.representative_kit_orders set state='cancelled',stock_state='released' where id=o.id;
    update private.representative_kit_fulfillment set shipment_status='cancelled',shipment_rank=8 where order_id=o.id;
    return public.read_representative_kit_payment(p_actor,p_order);
  end if;
  if o.state='paid' and o.cancellation_requested_at is null and not private.can_cancel_unshipped_representative_kit(o) then
    raise exception 'kit_requires_cancellation_review' using errcode='23514';
  end if;
  if o.payment_started_at is null then
    perform public.cancel_unstarted_representative_kit_order(p_actor,p_order);
  elsif o.state in ('reserved','payment_pending','paid') then
    update private.representative_kit_orders set cancellation_requested_at=coalesce(cancellation_requested_at,now()) where id=p_order;
    if o.state = 'paid' then perform private.queue_unshipped_representative_kit_refund(p_order); end if;
  end if;
  return public.read_representative_kit_payment(p_actor,p_order);
end;
$$;
;

-- 20261119170000_representative_kit_collection_refunds.sql
create function public.prepare_representative_kit_collection_refund(p_return uuid,p_cash_evidence text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  o private.representative_kit_orders;
  r private.representative_kit_refund_requests;
  receipt private.representative_kit_collection_payments;
  confirmed_total bigint;
  baseline text[];
  refund_reference text;
begin
  perform private.require_permission('returns.refund');
  select order_id into r.order_id from private.representative_kit_refund_requests where kit_return_id=p_return;
  if not found then return null; end if;
  select * into o from private.representative_kit_orders where id=r.order_id and collection_route_id is not null for update;
  if not found or o.actor_id=auth.uid() or o.state not in ('paid','manual_review','refunded') then return null; end if;
  select * into r from private.representative_kit_refund_requests where kit_return_id=p_return for update;
  select * into receipt from private.representative_kit_collection_payments where order_id=o.id and confirmed_at is not null for share;
  if not found then return null; end if;
  if r.provider_refund_id is not null then return jsonb_build_object('confirmed',true); end if;
  select coalesce(sum(amount_cents),0),coalesce(array_agg(provider_refund_id order by provider_refund_id),'{}') into confirmed_total,baseline
    from private.representative_kit_provider_refunds where order_id=o.id;
  if confirmed_total+r.amount_cents>o.unit_price_cents*o.quantity+o.shipping_cents or r.reason<>'accepted_return' then return null; end if;
  if o.collection_method='cash' then
    if length(btrim(coalesce(p_cash_evidence,''))) not between 10 and 200 then return null; end if;
    refund_reference:='CASH-'||encode(sha256(convert_to(btrim(p_cash_evidence),'UTF8')),'hex');
    update private.representative_kit_refund_requests set started_at=clock_timestamp(),baseline_refund_ids=baseline where id=r.id;
    insert into private.representative_kit_provider_refunds(provider_refund_id,order_id,amount_cents)
      values(refund_reference,o.id,r.amount_cents);
    update private.representative_kit_refund_requests set provider_refund_id=refund_reference,checked_at=clock_timestamp() where id=r.id;
    if confirmed_total+r.amount_cents=o.unit_price_cents*o.quantity+o.shipping_cents then
      update private.representative_kit_orders set state='refunded' where id=o.id;
    end if;
    insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
      values(auth.uid(),private.current_app_role(),'representative.kit.cash_refund.confirmed','representative_kit_order',o.id,
        jsonb_build_object('refundId',r.id,'evidence',btrim(p_cash_evidence)));
    return jsonb_build_object('confirmed',true);
  end if;
  if p_cash_evidence is not null or receipt.point_order_id is null or receipt.point_key is null then return null; end if;
  if r.started_at is null then
    update private.representative_kit_refund_requests set started_at=clock_timestamp(),
      baseline_refund_ids=baseline where id=r.id returning * into r;
  end if;
  if baseline is distinct from r.baseline_refund_ids then return null; end if;
  return jsonb_build_object('confirmed',false,'refundId',r.id,'refundCents',r.amount_cents,'previousRefundIds',baseline,
    'pointOrderId',receipt.point_order_id,'pointKey',receipt.point_key,'receipt',receipt.receipt_reference,
    'method',o.collection_method,'terminal',o.collection_point_terminal,'amountInCents',o.unit_price_cents*o.quantity+o.shipping_cents,
    'maySend',r.started_at>clock_timestamp()-interval '20 hours');
end;
$$;
revoke all on function public.prepare_representative_kit_collection_refund(uuid,text) from public,anon;
grant execute on function public.prepare_representative_kit_collection_refund(uuid,text) to authenticated;

create function public.record_representative_kit_collection_refund(p_refund uuid,p_provider_refund text)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  o private.representative_kit_orders;
  r private.representative_kit_refund_requests;
  prior bigint;
begin
  if p_provider_refund is null or p_provider_refund !~ '^REF[A-Za-z0-9]{12,62}$' then return false; end if;
  select order_id into r.order_id from private.representative_kit_refund_requests where id=p_refund;
  if not found then return false; end if;
  select * into o from private.representative_kit_orders where id=r.order_id
    and collection_method in ('pix','credit_card','debit_card') for update;
  if not found then return false; end if;
  select * into r from private.representative_kit_refund_requests where id=p_refund for update;
  if r.provider_refund_id is not null then return r.provider_refund_id=p_provider_refund; end if;
  if r.started_at is null or r.reason<>'accepted_return' then return false; end if;
  select coalesce(sum(amount_cents),0) into prior from private.representative_kit_provider_refunds where order_id=o.id;
  if prior+r.amount_cents>o.unit_price_cents*o.quantity+o.shipping_cents then return false; end if;
  insert into private.representative_kit_provider_refunds(provider_refund_id,order_id,amount_cents)
    values(p_provider_refund,o.id,r.amount_cents);
  update private.representative_kit_refund_requests set provider_refund_id=p_provider_refund,
    checked_at=clock_timestamp() where id=r.id;
  if prior+r.amount_cents=o.unit_price_cents*o.quantity+o.shipping_cents then
    update private.representative_kit_orders set state='refunded' where id=o.id;
  end if;
  return true;
end;
$$;
revoke all on function public.record_representative_kit_collection_refund(uuid,text) from public,anon,authenticated;
grant execute on function public.record_representative_kit_collection_refund(uuid,text) to service_role;

create or replace function public.list_representative_kit_return_work()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_permission('returns.read');
  return (select coalesce(jsonb_agg(pending.summary),'[]'::jsonb) from (
    select private.representative_kit_return_summary(r) || jsonb_build_object('reason',r.reason,'sku',o.sku,
      'productName',o.product_name,'originalInvoiceKey',f.invoice_access_key,'refundInCents',r.refund_cents,
      'invoiceKey',r.invoice_key,'collectionMethod',o.collection_method) as summary
    from private.representative_kit_returns r join private.representative_kit_orders o on o.id=r.order_id
    join private.representative_kit_fulfillment f on f.order_id=o.id
    order by r.created_at desc, r.id limit 50
  ) pending);
end;
$$;

create or replace function public.list_representative_kit_fiscal_work()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not (private.has_permission('orders.update_operational_status') or private.has_permission('technical.integrations.manage'))
    then raise exception 'permission_denied' using errcode='42501'; end if;
  return (select coalesce(jsonb_agg(work.summary),'[]'::jsonb) from (
    select jsonb_build_object('orderId',o.id,'state',o.state,'sku',o.sku,'quantity',o.quantity,'productName',o.product_name,
      'invoiceId',f.bling_invoice_id,'saleId',f.bling_sale_id,'draftHash',f.invoice_draft_hash,
      'draftApproved',f.reviewed_draft_hash is not null and f.reviewed_draft_hash=f.invoice_draft_hash,
      'invoiceAuthorized',f.invoice_confirmed_at is not null,'shipmentStatus',f.shipment_status,
      'cancellationRequested',o.cancellation_requested_at is not null,'collectionMethod',o.collection_method) as summary
    from private.representative_kit_orders o join private.representative_kit_fulfillment f on f.order_id=o.id
    order by o.created_at desc,o.id limit 50
  ) work);
end;
$$;
;

-- 20261119173000_representative_kit_collection_reconciliation.sql
alter table private.representative_kit_collection_payments add column checked_at timestamptz;

create function public.due_representative_kit_collection_payments()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(work)),'[]'::jsonb) from (
    select o.id as "orderId",p.point_order_id as "pointOrderId",p.point_key as "pointKey",
      o.collection_point_terminal as terminal,o.collection_method as method,false as confirmed,
      o.unit_price_cents*o.quantity+o.shipping_cents as "amountInCents"
    from private.representative_kit_collection_payments p join private.representative_kit_orders o on o.id=p.order_id
    where o.state='awaiting_receipt' and o.cancellation_requested_at is null
      and p.confirmed_at is null and p.point_order_id is not null and p.point_key is not null
      and p.point_status in ('created','at_terminal','processed')
      and (p.checked_at is null or p.checked_at<now()-interval '5 minutes')
    order by p.checked_at nulls first,p.order_id limit 3
  ) work;
$$;

create function public.defer_representative_kit_collection_payment(p_order uuid,p_point_key uuid)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  update private.representative_kit_collection_payments set checked_at=clock_timestamp()
    where order_id=p_order and point_key=p_point_key and confirmed_at is null;
  return found;
end;
$$;

create function public.due_representative_kit_collection_refunds()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(work)),'[]'::jsonb) from (
    select r.id as "refundId",r.amount_cents as "refundCents",r.baseline_refund_ids as "previousRefundIds",
      p.point_order_id as "pointOrderId",p.point_key as "pointKey",p.receipt_reference as receipt,
      o.collection_method as method,o.collection_point_terminal as terminal,false as confirmed,false as "maySend",
      o.unit_price_cents*o.quantity+o.shipping_cents as "amountInCents"
    from private.representative_kit_refund_requests r join private.representative_kit_orders o on o.id=r.order_id
    join private.representative_kit_collection_payments p on p.order_id=o.id
    where r.provider_refund_id is null and r.started_at is not null and r.baseline_refund_ids is not null
      and o.collection_method in ('pix','debit_card','credit_card') and p.confirmed_at is not null
      and p.point_key is not null and p.point_order_id is not null
      and (r.checked_at is null or r.checked_at<now()-interval '5 minutes')
    order by r.checked_at nulls first,r.id limit 3
  ) work;
$$;
revoke all on function public.due_representative_kit_collection_payments(),
  public.defer_representative_kit_collection_payment(uuid,uuid),public.due_representative_kit_collection_refunds()
  from public,anon,authenticated;
grant execute on function public.due_representative_kit_collection_payments(),
  public.defer_representative_kit_collection_payment(uuid,uuid),public.due_representative_kit_collection_refunds()
  to service_role;
;

-- 20261119180000_representative_kit_grade_prices.sql
alter table public.kits
  add column grade_standard_price_cents bigint check (grade_standard_price_cents between 12 and 9999999999),
  add column grade_lower_restock_price_cents bigint check (grade_lower_restock_price_cents between 12 and 9999999999),
  add column grade_upper_restock_price_cents bigint check (grade_upper_restock_price_cents between 12 and 9999999999),
  add constraint kit_grade_prices_complete check (
    num_nonnulls(grade_standard_price_cents, grade_lower_restock_price_cents, grade_upper_restock_price_cents) = 0
    or (grade_product_id is not null
      and num_nonnulls(grade_standard_price_cents, grade_lower_restock_price_cents, grade_upper_restock_price_cents) = 3)
  );

create function private.representative_kit_grade_price(p_kit public.kits, p_template text)
returns bigint language sql immutable set search_path = ''
as $$
  select case p_template
    when 'standard' then coalesce(p_kit.grade_standard_price_cents, p_kit.price_in_cents)
    when 'lower_restock' then coalesce(p_kit.grade_lower_restock_price_cents, p_kit.price_in_cents)
    when 'upper_restock' then coalesce(p_kit.grade_upper_restock_price_cents, p_kit.price_in_cents)
  end;
$$;
revoke all on function private.representative_kit_grade_price(public.kits, text) from public, anon, authenticated, service_role;

create or replace function public.list_representative_kit_grade_offers()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'kitId', k.id, 'name', k.name, 'description', k.description, 'color', k.grade_color,
    'unitPriceInCents', private.representative_kit_grade_price(k, 'standard'), 'templates', offers.templates
  ) order by k.name, k.id), '[]'::jsonb)
  from public.kits k
  join private.representative_kit_grade_sources() s
    on (s.product_id, s.color) = (k.grade_product_id, k.grade_color)
  cross join lateral (
    select jsonb_agg(jsonb_build_object(
      'code', t.code, 'label', t.label, 'available', stock.available, 'sizes', stock.sizes,
      'unitPriceInCents', private.representative_kit_grade_price(k, t.code)
    ) order by t.sort_order) as templates
    from (select distinct code, label, sort_order from private.representative_kit_grade_templates()) t
    cross join lateral (
      select min(c.available / c.pairs) as available,
        jsonb_agg(jsonb_build_object('size', c.size, 'pairs', c.pairs) order by c.size) as sizes
      from private.representative_kit_grade_components(k.id, t.code) c
    ) stock
  ) offers
  where k.active and k.deleted_at is null and private.representative_kit_grade_price(k, 'standard') >= 12
    and private.representative_catalog_access();
$$;

create or replace function private.representative_kit_grade_snapshot(p_kit uuid, p_template text)
returns jsonb
language sql stable set search_path = ''
as $$
  with components as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'variantId', c.variant_id, 'productId', v.product_id, 'size', c.size, 'pairs', c.pairs,
      'sku', v.sku, 'name', p.name, 'priceCents', inputs.price_cents, 'dimensions', inputs.dimensions,
      'fiscalHash', private.bling_kit_source_hash(v.id)
    ) order by c.variant_id), '[]'::jsonb) as lines,
    coalesce(sum(c.pairs), 0) as pairs
    from private.representative_kit_grade_components(p_kit, p_template) c
    join public.product_variants v on v.id = c.variant_id
    join public.products p on p.id = v.product_id
    join lateral private.representative_kit_shipping_inputs(v.id) inputs on inputs.price_cents > 0
  )
  select jsonb_build_object(
    'kitName', k.name, 'priceCents', price.cents, 'lines', components.lines,
    'catalogHash', encode(sha256(convert_to(jsonb_build_array(k.id, k.name, p_template,
      price.cents, components.lines)::text, 'UTF8')), 'hex'),
    'fiscalFingerprint', encode(sha256(convert_to(jsonb_build_array(k.id, p_template, (
      select jsonb_agg(jsonb_build_array(line -> 'variantId', line -> 'pairs', line -> 'fiscalHash') order by line ->> 'variantId')
      from jsonb_array_elements(components.lines) line
    ))::text, 'UTF8')), 'hex')
  )
  from public.kits k cross join components
  cross join lateral (select private.representative_kit_grade_price(k, p_template) as cents) price
  where k.id = p_kit and price.cents >= 12 and components.pairs = 12;
$$;
;

-- 20261119191000_representative_kit_own_delivery.sql
-- Record physical delivery separately from collection of payment.
create or replace function private.confirm_representative_kit_collection_receipt(
  o private.representative_kit_orders, p_reference text, p_operator uuid
) returns boolean language plpgsql set search_path = ''
as $$
begin
  if o.state='paid' and exists (select 1 from private.representative_kit_collection_payments p
    where p.order_id=o.id and p.receipt_reference=p_reference and p.confirmed_at is not null) then return true; end if;
  if o.state<>'awaiting_receipt' or o.stock_state<>'reserved' or o.cancellation_requested_at is not null
    or not exists (select 1 from private.representative_kit_fulfillment f
      where f.order_id=o.id and f.shipment_status in ('dispatched','delivered') and f.invoice_access_key is not null
        and f.invoice_cancellation_confirmed_at is null) then return false; end if;

  perform private.transfer_representative_kit_inventory(o,o.quantity,'sell',
    'Pagamento no recebimento de kit de revenda MG','representative_kit_order',o.id,p_operator);
  update private.representative_kit_collection_payments set receipt_reference=p_reference,confirmed_at=clock_timestamp()
    where order_id=o.id and confirmed_at is null;
  if not found then raise exception 'kit_collection_receipt_unavailable' using errcode='23514'; end if;
  update private.representative_kit_orders set state='paid',stock_state='sold',paid_at=clock_timestamp() where id=o.id;
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
    values(p_operator,private.current_app_role(),'representative.kit.collection.confirmed','representative_kit_order',o.id,
      jsonb_build_object('method',o.collection_method,'amountInCents',o.unit_price_cents*o.quantity+o.shipping_cents));
  return true;
end;
$$;
revoke all on function private.confirm_representative_kit_collection_receipt(private.representative_kit_orders,text,uuid)
  from public, anon, authenticated, service_role;

alter table private.representative_kit_shipping_checkout_quotes
  add column own_delivery_route_id uuid references private.representative_kit_collection_routes(id);
alter table private.representative_kit_orders
  add column own_delivery_route_id uuid references private.representative_kit_collection_routes(id);
create index representative_kit_quotes_own_route on private.representative_kit_shipping_checkout_quotes(own_delivery_route_id);
create index representative_kit_orders_own_route on private.representative_kit_orders(own_delivery_route_id);

create function private.record_representative_kit_own_delivery()
returns trigger language plpgsql set search_path = ''
as $$
declare
  quote private.representative_kit_shipping_checkout_quotes;
  route private.representative_kit_collection_routes;
  delivery public.addresses;
begin
  select * into quote from private.representative_kit_shipping_checkout_quotes where id=new.quote_id;
  if quote.own_delivery_route_id is null then return new; end if;
  select * into route from private.representative_kit_collection_routes
    where id=quote.own_delivery_route_id for share;
  if not found or route.closed_at is not null or route.valid_until <= clock_timestamp()
    or quote.origin_postal_code <> route.origin_postal_code
    or quote.postal_code not between route.destination_from and route.destination_through
    or route.delivery_cents <> quote.amount_in_cents or route.name <> quote.service
    or route.estimated_days <> quote.estimated_days
    or 1 <> (select count(*) from private.representative_kit_collection_routes r
      where r.origin_postal_code=quote.origin_postal_code and quote.postal_code between r.destination_from and r.destination_through
        and r.closed_at is null and r.valid_until>clock_timestamp()) then
    raise exception 'kit_own_delivery_quote_changed' using errcode='23514';
  end if;
  select * into strict delivery from public.addresses where id=quote.address_id and user_id=new.actor_id;
  new.own_delivery_route_id := route.id;
  new.shipping_snapshot := new.shipping_snapshot || jsonb_build_object(
    'provider','own_delivery','routeId',route.id,'estimatedDays',route.estimated_days,
    'deliveryAddress',jsonb_build_object('name',delivery.recipient_name,'street',delivery.street,
      'number',delivery.number,'complement',delivery.complement,'district',delivery.district,
      'city',delivery.city,'state',delivery.state,'postalCode',quote.postal_code));
  return new;
end;
$$;
revoke all on function private.record_representative_kit_own_delivery() from public,anon,authenticated,service_role;
create trigger kit_own_delivery_before_reservation
  before insert on private.representative_kit_orders for each row execute function private.record_representative_kit_own_delivery();

create function public.reserve_representative_kit_own_delivery(
  p_actor uuid,p_selection uuid,p_template text,p_quantity integer,p_quote uuid,p_address uuid,p_key uuid,p_origin text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  origin text;
begin
  select q.origin_postal_code into origin from private.representative_kit_shipping_checkout_quotes q
    where q.id=p_quote and q.actor_id=p_actor and q.own_delivery_route_id is not null and q.collection_route_id is null;
  if not found or (p_origin is not null and p_origin <> origin)
    then raise exception 'kit_quote_unavailable' using errcode='23514'; end if;
  if p_template is null then
    return public.reserve_representative_kit_order(p_actor,p_selection,p_quantity,p_quote,p_address,p_key,origin);
  end if;
  return public.reserve_representative_kit_grade_order(p_actor,p_selection,p_template,p_quantity,p_quote,p_address,p_key,origin);
end;
$$;
revoke all on function public.reserve_representative_kit_own_delivery(uuid,uuid,text,integer,uuid,uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.reserve_representative_kit_own_delivery(uuid,uuid,text,integer,uuid,uuid,uuid,text)
  to service_role;

create function public.reserve_representative_kit_own_collection(
  p_actor uuid,p_selection uuid,p_template text,p_quantity integer,p_quote uuid,p_address uuid,
  p_key uuid,p_origin text,p_method text,p_cash_tendered bigint
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  origin text;
begin
  select q.origin_postal_code into origin from private.representative_kit_shipping_checkout_quotes q
    where q.id=p_quote and q.actor_id=p_actor and q.own_delivery_route_id is not null and q.collection_route_id is not null;
  if not found or (p_origin is not null and p_origin <> origin)
    then raise exception 'kit_quote_unavailable' using errcode='23514'; end if;
  return public.reserve_representative_kit_collection_order(p_actor,p_selection,p_template,p_quantity,p_quote,
    p_address,p_key,origin,p_method,p_cash_tendered);
end;
$$;
revoke all on function public.reserve_representative_kit_own_collection(uuid,uuid,text,integer,uuid,uuid,uuid,text,text,bigint)
  from public,anon,authenticated;
grant execute on function public.reserve_representative_kit_own_collection(uuid,uuid,text,integer,uuid,uuid,uuid,text,text,bigint)
  to service_role;

create function public.quote_representative_kit_own_delivery(
  p_actor uuid,p_selection uuid,p_template text,p_quantity integer,p_address uuid,p_origin text,p_at_receipt boolean
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  route private.representative_kit_collection_routes;
  address_row public.addresses;
  postal text;
  grade_shipping jsonb;
  inserted jsonb;
  price bigint;
  dimensions jsonb;
  expiry timestamptz := clock_timestamp()+interval '15 minutes';
begin
  if p_quantity is null or p_quantity not between 1 and 99 then return null; end if;
  select * into address_row from public.addresses a where a.user_id=p_actor
    and a.id=p_address and a.state='MG' and a.country='BR' for share;
  if not found then return null; end if;
  postal:=regexp_replace(address_row.postal_code,'[^0-9]','','g');
  if postal !~ '^3[0-9]{7}$' then return null; end if;
  select q.* into route from private.representative_kit_collection_routes q
    where (p_origin is null or q.origin_postal_code=p_origin) and postal between q.destination_from and q.destination_through
      and q.valid_until>expiry and q.closed_at is null
      and 1=(select count(*) from private.representative_kit_collection_routes t
        where (p_origin is null or t.origin_postal_code=p_origin) and postal between t.destination_from and t.destination_through
          and t.valid_until>expiry and t.closed_at is null)
    for share;
  if not found then return null; end if;
  p_origin := route.origin_postal_code;
  if p_template is null then
    if not public.representative_kit_purchase_available(p_actor,p_selection,p_origin) then return null; end if;
    select inputs.price_cents,inputs.dimensions into price,dimensions
      from private.representative_kit_shipping_inputs(p_selection) inputs
      join private.bling_catalog_metadata m on m.product_id=(select product_id from public.product_variants where id=p_selection)
      join public.inventory i on i.variant_id=p_selection
      where m.pairs_per_sku>1 and i.available_quantity>=p_quantity;
    if not found or price<=0 then return null; end if;
    inserted:=public.confirm_representative_kit_shipping_quote(
      p_actor,p_selection,p_quantity,p_address,postal,repeat('0',64),case when p_at_receipt then 'recebimento' else 'entrega_propria' end,route.name,route.name,
      route.delivery_cents,route.delivery_cents,route.estimated_days,'[]'::jsonb,expiry,p_origin,price,dimensions);
  else
    grade_shipping:=public.read_representative_kit_grade_shipping(p_actor,p_selection,p_template,p_quantity,p_address,p_origin);
    if grade_shipping -> 'purchaseAvailable' is distinct from 'true'::jsonb then return null; end if;
    price:=(grade_shipping ->> 'priceCents')::bigint;
    inserted:=public.confirm_representative_kit_grade_shipping(
      p_actor,p_selection,p_template,p_quantity,p_address,p_origin,grade_shipping ->> 'catalogHash',
      address_row.updated_at,repeat('0',64),case when p_at_receipt then 'recebimento' else 'entrega_propria' end,route.name,route.name,route.delivery_cents,
      route.delivery_cents,route.estimated_days,'[]'::jsonb,expiry);
  end if;
  if inserted ->> 'id' is null then return null; end if;
  update private.representative_kit_shipping_checkout_quotes set own_delivery_route_id=route.id, collection_route_id=case when p_at_receipt then route.id end
    where id=(inserted ->> 'id')::uuid;
  return jsonb_build_object('id',inserted -> 'id','shippingInCents',route.delivery_cents,
    'amountInCents',price*p_quantity+route.delivery_cents,'estimatedDays',route.estimated_days,'service',route.name);
end;
$$;
revoke all on function public.quote_representative_kit_own_delivery(uuid,uuid,text,integer,uuid,text,boolean) from public, anon, authenticated;
grant execute on function public.quote_representative_kit_own_delivery(uuid,uuid,text,integer,uuid,text,boolean) to service_role;


create or replace function public.list_representative_kit_collection_work()
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not private.has_permission('orders.update_operational_status') then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  return (select coalesce(jsonb_agg(rows.summary),'[]'::jsonb) from (
    select private.representative_kit_order_summary(o) || jsonb_build_object(
      'productName',o.product_name,'invoiceAuthorized',f.invoice_confirmed_at is not null,
      'shipmentStatus',f.shipment_status,'pointStarted',p.point_key is not null,'pointLinked',p.point_order_id is not null,
      'deliveryAddress',o.shipping_snapshot -> 'deliveryAddress',
      'pointStatus',p.point_status,
      'receiptConfirmed',p.confirmed_at is not null,'cancellationRequested',o.cancellation_requested_at is not null,
      'invoiceCancelled',f.invoice_cancellation_confirmed_at is not null) as summary
    from private.representative_kit_orders o join private.representative_kit_fulfillment f on f.order_id=o.id
    left join private.representative_kit_collection_payments p on p.order_id=o.id
    where o.collection_route_id is not null or o.own_delivery_route_id is not null
    order by o.created_at desc,o.id limit 50
  ) rows);
end;
$$;
revoke all on function public.list_representative_kit_collection_work() from public, anon;
grant execute on function public.list_representative_kit_collection_work() to authenticated;


create or replace function public.manage_representative_kit_collection(p_order uuid,p_action text,p_evidence text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  o private.representative_kit_orders;
  f private.representative_kit_fulfillment;
begin
  if auth.uid() is null or not private.has_permission('orders.update_operational_status') then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  if length(btrim(coalesce(p_evidence,''))) not between 10 and 200 then return null; end if;
  select * into o from private.representative_kit_orders where id=p_order and (collection_route_id is not null or own_delivery_route_id is not null) for update;
  if not found or o.actor_id=auth.uid() then return null; end if;
  select * into f from private.representative_kit_fulfillment where order_id=p_order for update;
  if not found then return null; end if;
  if p_action='cash_received' and o.collection_method='cash' and (
    o.state='paid' or o.state='awaiting_receipt' and f.shipment_status in ('dispatched','delivered') and o.cancellation_requested_at is null
  ) then
    insert into private.representative_kit_collection_payments(order_id,opened_by) values(o.id,auth.uid()) on conflict do nothing;
    if not private.confirm_representative_kit_collection_receipt(o,btrim(p_evidence),auth.uid()) then return null; end if;
  elsif p_action='confirm_delivery' and f.shipment_status in ('dispatched','delivered')
    and o.state in ('awaiting_receipt','paid') and o.cancellation_requested_at is null
    and f.invoice_access_key is not null and f.invoice_cancellation_confirmed_at is null then
    if f.shipment_status='delivered' then return jsonb_build_object('ok',true); end if;
    update private.representative_kit_fulfillment set shipment_status='delivered',shipment_rank=7 where order_id=o.id;
  elsif p_action='dispatch' and o.state in ('awaiting_receipt','paid') and o.cancellation_requested_at is null
    and private.representative_kit_fiscal_ready(o) and (f.shipment_rank<4 or f.shipment_status='delayed' and o.collection_route_id is null) and f.invoice_access_key is not null
    and f.invoice_confirmed_at>clock_timestamp()-interval '30 minutes' then
    update private.representative_kit_fulfillment set shipment_status='dispatched',shipment_rank=4 where order_id=o.id;
  elsif p_action='cancel_before_dispatch' and o.state='awaiting_receipt' and o.cancellation_requested_at is null
    and f.shipment_rank<4 and f.bling_invoice_id is not null then
    update private.representative_kit_orders set cancellation_requested_at=clock_timestamp() where id=o.id;
    update private.representative_kit_fulfillment set shipment_status='delayed',shipment_rank=5,checked_at=null where order_id=o.id;
  elsif p_action='delivery_failed' and o.state='paid' and o.collection_route_id is null
    and f.shipment_status='dispatched' and o.cancellation_requested_at is null then
    update private.representative_kit_fulfillment set shipment_status='delayed',shipment_rank=5 where order_id=o.id;
  elsif p_action='delivery_failed' and o.state='awaiting_receipt' and f.shipment_status='dispatched'
    and not exists (select 1 from private.representative_kit_collection_payments p where p.order_id=o.id
      and (p.point_status is null or p.point_status not in ('failed','expired','canceled') or p.confirmed_at is not null)) then
    update private.representative_kit_orders set cancellation_requested_at=clock_timestamp() where id=o.id;
    update private.representative_kit_fulfillment set shipment_status='delayed',shipment_rank=5,checked_at=null where order_id=o.id;
  elsif p_action='returned_unpaid' and o.state='awaiting_receipt' and o.cancellation_requested_at is not null
    and f.shipment_status='delayed' and f.invoice_cancellation_confirmed_at is not null
    and not exists (select 1 from private.representative_kit_collection_payments p where p.order_id=o.id
      and (p.point_status is null or p.point_status not in ('failed','expired','canceled') or p.confirmed_at is not null)) then
    perform private.transfer_representative_kit_inventory(o,o.quantity,'release',null,null,null,null);
    update private.representative_kit_orders set state='cancelled',stock_state='released' where id=o.id;
    update private.representative_kit_fulfillment set shipment_status='returned',shipment_rank=8 where order_id=o.id;
  else
    return null;
  end if;
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
    values(auth.uid(),private.current_app_role(),'representative.kit.collection.'||p_action,'representative_kit_order',o.id,
      jsonb_build_object('evidence',btrim(p_evidence)));
  return jsonb_build_object('ok',true);
end;
$$;
revoke all on function public.manage_representative_kit_collection(uuid,text,text) from public, anon;
grant execute on function public.manage_representative_kit_collection(uuid,text,text) to authenticated;

create or replace function public.due_representative_kit_fulfillment()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(due)),'[]'::jsonb) from (
    select f.order_id as "orderId", f.bling_sale_id as "saleId", f.bling_invoice_id as "invoiceId",
      f.shipment_id as "shipmentId", f.shipment_status as "shipmentStatus", o.variant_id as "variantId",
      o.sku, o.product_name as "productName", o.quantity, coalesce(o.paid_at,o.created_at) as "paidAt", o.grade_lines as "gradeLines",
      o.own_delivery_route_id is not null as "ownDelivery", o.collection_method as "collectionMethod", o.collection_bling_method as "collectionBlingMethod", o.created_at as "createdAt",
      o.shipping_snapshot ->> 'estimatedDays' as "deliveryDays",
      o.unit_price_cents as "unitPriceInCents", o.shipping_cents as "shippingInCents",
      o.unit_price_cents * o.quantity + o.shipping_cents as "amountInCents",
      o.shipping_snapshot ->> 'serviceId' as "serviceId",
      o.shipping_snapshot ->> 'originPostalCode' as "originPostalCode",
      o.shipping_snapshot -> 'address' ->> 'postalCode' as "postalCode",
      a.buyer_profile as "buyerProfile", a.buyer_document as "buyerDocument", a.buyer_state_registration as "buyerStateRegistration",
      r.fiscal_parameters as "fiscalParameters"
    from private.representative_kit_fulfillment f
    join private.representative_kit_orders o on o.id = f.order_id
    join private.representative_kit_checkout_approvals a on a.actor_id = o.actor_id and a.rule_version_id = o.rule_version_id
    join private.representative_resale_fiscal_rule_versions r on r.id = o.rule_version_id
    where private.representative_kit_fiscal_ready(o)
      and not exists (
        select 1 from jsonb_array_elements(o.grade_lines) item
        where private.bling_kit_source_hash((item ->> 'variantId')::uuid) is distinct from item ->> 'fiscalHash'
      )
      and coalesce(f.shipment_status,'pending') not in ('returned','cancelled','delivered')
      and (f.checked_at is null or f.checked_at < now() - interval '15 minutes')
      and not exists(select 1 from private.bling_order_links b
        where b.invoice_id = f.bling_invoice_id or b.external_order_id = f.bling_sale_id)
    order by f.checked_at nulls first, f.order_id limit 3
  ) due;
$$;
;

-- 20261119192000_representative_kit_pickup_refund.sql
alter table private.representative_kit_returns
  add column pickup_on date,
  add column picked_up_at timestamptz,
  add column picked_up_by uuid references public.profiles(id),
  add column pickup_reference text,
  add column refund_prepared_by uuid references public.profiles(id),
  add column refund_confirmed_by uuid references public.profiles(id),
  add constraint kit_return_pickup_record check (
    num_nonnulls(picked_up_at,picked_up_by,pickup_reference) in (0,3)
    and (picked_up_at is null or pickup_on is not null)
  ),
  add constraint kit_return_refund_reviewers check (
    refund_confirmed_by is null or (refund_prepared_by is not null and refund_confirmed_by <> refund_prepared_by)
  );

create or replace function private.representative_kit_return_summary(r private.representative_kit_returns)
returns jsonb language sql stable set search_path = ''
as $$
  select jsonb_build_object('id',r.id,'orderId',r.order_id,'quantity',r.quantity,'state',r.state,
    'instructions',r.instructions,'createdAt',r.created_at,'pickupOn',r.pickup_on,
    'pickedUp',r.picked_up_at is not null,'refundPrepared',r.refund_prepared_by is not null);
$$;

alter function public.manage_representative_kit_return(uuid,text,jsonb) set schema private;
revoke all on function private.manage_representative_kit_return(uuid,text,jsonb) from public,anon,authenticated,service_role;

create function public.manage_representative_kit_return(p_return uuid,p_action text,p_details jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  r private.representative_kit_returns;
  o private.representative_kit_orders;
  result jsonb;
  pickup_date date;
  evidence text;
  staff_id uuid := auth.uid();
  own_delivery boolean;
begin
  perform private.require_permission(case
    when p_action in ('receive','schedule_pickup','confirm_pickup') then 'returns.inspect'
    when p_action in ('prepare_refund','refund') then 'returns.refund'
    else 'returns.approve' end);
  select order_id into r.order_id from private.representative_kit_returns where id=p_return;
  if not found then return null; end if;
  select * into o from private.representative_kit_orders where id=r.order_id for update;
  select * into r from private.representative_kit_returns where id=p_return for update;
  if not found or staff_id is null or staff_id=o.actor_id then return null; end if;
  own_delivery := o.own_delivery_route_id is not null or o.collection_route_id is not null;

  if p_action='schedule_pickup' then
    if not own_delivery or r.state<>'approved' or r.picked_up_at is not null
      or coalesce(p_details->>'pickupDate','') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' then return null; end if;
    pickup_date := (p_details->>'pickupDate')::date;
    if pickup_date < (statement_timestamp() at time zone 'America/Sao_Paulo')::date then return null; end if;
    update private.representative_kit_returns set pickup_on=pickup_date where id=p_return returning * into r;
  elsif p_action='confirm_pickup' then
    evidence := btrim(coalesce(p_details->>'pickupReference',''));
    if not own_delivery or r.state<>'approved' or r.pickup_on is null
      or length(evidence) not between 10 and 200 then return null; end if;
    if r.picked_up_at is not null then return private.representative_kit_return_summary(r); end if;
    update private.representative_kit_returns set picked_up_at=clock_timestamp(),
      picked_up_by=staff_id,pickup_reference=evidence where id=p_return returning * into r;
  elsif own_delivery and p_action='receive' and r.picked_up_at is null then
    return null;
  elsif p_action='prepare_refund' then
    if r.state<>'verified' or o.collection_method is not distinct from 'cash'
      or r.refund_cents is null or r.invoice_protocol is null or r.invoice_sha256 is null then return null; end if;
    if r.refund_prepared_by is not null then
      return case when r.refund_prepared_by=staff_id then private.representative_kit_return_summary(r) end;
    end if;
    update private.representative_kit_returns set refund_prepared_by=staff_id where id=p_return returning * into r;
  elsif p_action='refund' and o.collection_method is distinct from 'cash' then
    if r.state='refund_pending' and r.refund_confirmed_by=staff_id then return private.representative_kit_return_summary(r); end if;
    if r.refund_prepared_by is null or r.refund_prepared_by=staff_id or r.state<>'verified' then return null; end if;
    result := private.manage_representative_kit_return(p_return,p_action,p_details);
    if result is null then return null; end if;
    update private.representative_kit_returns set refund_confirmed_by=staff_id where id=p_return returning * into r;
  else
    return private.manage_representative_kit_return(p_return,p_action,p_details);
  end if;
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
    values(staff_id,private.current_app_role(),'representative.kit.return.'||p_action,'representative_kit_return',r.id,
      jsonb_build_object('orderId',r.order_id,'pickupOn',r.pickup_on,'refundInCents',r.refund_cents));
  return private.representative_kit_return_summary(r);
end;
$$;
revoke all on function public.manage_representative_kit_return(uuid,text,jsonb) from public,anon,service_role;
grant execute on function public.manage_representative_kit_return(uuid,text,jsonb) to authenticated;

create or replace function public.list_representative_kit_return_work()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_permission('returns.read');
  return (select coalesce(jsonb_agg(pending.summary),'[]'::jsonb) from (
    select private.representative_kit_return_summary(r) || jsonb_build_object('reason',r.reason,'sku',o.sku,
      'productName',o.product_name,'originalInvoiceKey',f.invoice_access_key,'refundInCents',r.refund_cents,
      'invoiceKey',r.invoice_key,'collectionMethod',o.collection_method,
      'ownDelivery',o.own_delivery_route_id is not null or o.collection_route_id is not null,
      'deliveryAddress',o.shipping_snapshot -> 'deliveryAddress',
      'canConfirmRefund',r.refund_prepared_by is not null and r.refund_prepared_by <> auth.uid()) as summary
    from private.representative_kit_returns r join private.representative_kit_orders o on o.id=r.order_id
    join private.representative_kit_fulfillment f on f.order_id=o.id
    order by r.created_at desc, r.id limit 50
  ) pending);
end;
$$;

create or replace function public.list_representative_kit_fiscal_work()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not (private.has_permission('orders.update_operational_status') or private.has_permission('technical.integrations.manage'))
    then raise exception 'permission_denied' using errcode='42501'; end if;
  return (select coalesce(jsonb_agg(work.summary),'[]'::jsonb) from (
    select jsonb_build_object('orderId',o.id,'state',o.state,'sku',o.sku,'quantity',o.quantity,'productName',o.product_name,
      'invoiceId',f.bling_invoice_id,'saleId',f.bling_sale_id,'draftHash',f.invoice_draft_hash,
      'draftApproved',f.reviewed_draft_hash is not null and f.reviewed_draft_hash=f.invoice_draft_hash,
      'invoiceAuthorized',f.invoice_confirmed_at is not null,'shipmentStatus',f.shipment_status,
      'cancellationRequested',o.cancellation_requested_at is not null,'collectionMethod',o.collection_method,
      'ownDelivery',o.own_delivery_route_id is not null or o.collection_route_id is not null) as summary
    from private.representative_kit_orders o join private.representative_kit_fulfillment f on f.order_id=o.id
    order by o.created_at desc,o.id limit 50
  ) work);
end;
$$;
;

-- 20261119193000_representative_kit_delivery_routes_admin.sql
create function public.list_representative_kit_delivery_routes()
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_permission('representatives.rules.manage');
  return (select coalesce(jsonb_agg(to_jsonb(routes)), '[]'::jsonb) from (
    select id,name,origin_postal_code,destination_from,destination_through,delivery_cents,estimated_days,valid_until,closed_at
    from private.representative_kit_collection_routes order by closed_at nulls first,valid_until desc,id limit 100
  ) routes);
end;
$$;

create function public.manage_representative_kit_delivery_route(p_close uuid,p_route jsonb)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  route private.representative_kit_collection_routes;
begin
  perform private.require_permission('representatives.rules.manage');
  if p_close is not null then
    update private.representative_kit_collection_routes set closed_at=clock_timestamp()
      where id=p_close and closed_at is null returning * into route;
    if not found then return false; end if;
  else
    select * into route from jsonb_populate_record(null::private.representative_kit_collection_routes,p_route);
    if route.origin_postal_code is null or route.valid_until is null or route.valid_until <= clock_timestamp()
      or route.delivery_cents not between 0 and 100000000 then return false; end if;
    perform pg_advisory_xact_lock(hashtextextended('kit_route:'||route.origin_postal_code,0));
    if exists (select 1 from private.representative_kit_collection_routes r
      where r.origin_postal_code=route.origin_postal_code and r.closed_at is null and r.valid_until>clock_timestamp()
        and route.destination_from<=r.destination_through and route.destination_through>=r.destination_from)
      then return false; end if;
    insert into private.representative_kit_collection_routes(name,origin_postal_code,destination_from,destination_through,
      delivery_cents,estimated_days,bling_method_ids,point_terminal_id,verified_evidence,valid_until)
    values(route.name,route.origin_postal_code,route.destination_from,route.destination_through,route.delivery_cents,
      route.estimated_days,route.bling_method_ids,route.point_terminal_id,route.verified_evidence,route.valid_until)
    returning id into route.id;
  end if;
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
    values(auth.uid(),private.current_app_role(),
      case when p_close is null then 'representative.kit.route.created' else 'representative.kit.route.closed' end,
      'representative_kit_delivery_route',route.id,jsonb_build_object('origin',route.origin_postal_code));
  return true;
end;
$$;
revoke all on function public.list_representative_kit_delivery_routes(),public.manage_representative_kit_delivery_route(uuid,jsonb)
  from public,anon,service_role;
grant execute on function public.list_representative_kit_delivery_routes(),public.manage_representative_kit_delivery_route(uuid,jsonb)
  to authenticated;
;

-- 20261120000432_representative_kit_accounting_rules.sql
-- Fiscal parameters for the MG wholesale channel. Keep existing function grants.
create or replace function private.representative_kit_commercial_configuration(p_actor uuid, p_rule uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1 from private.representative_kit_checkout_approvals a
    join private.representative_resale_fiscal_rule_versions r on r.id = a.rule_version_id
    cross join lateral (select r.fiscal_parameters as config, r.fiscal_parameters -> 'blingRule' as bling) as fiscal
    where a.actor_id = p_actor and a.rule_version_id = p_rule and a.revoked_at is null
      and a.valid_until > statement_timestamp()
      and a.buyer_document is not null and a.buyer_legal_name is not null and a.buyer_state_registration is not null
      and config ->> 'issuerDocument' ~ '^[0-9]{14}$'
      and config ->> 'classification' = 'third_party_no_st'
      and jsonb_typeof(config -> 'creditEligible') = 'boolean'
      and bling ->> 'issuer_state' = 'MG' and bling ->> 'series' = '3' and bling ->> 'document_model' = '55'
      and bling ->> 'cfop' = '5102' and bling ->> 'icms_rate' ~ '^0([.]0+)?$'
      and bling ->> 'pis_cst' = '49' and bling ->> 'cofins_cst' = '49'
      and bling ->> 'ipi_cst' = '99' and bling ->> 'ipi_cenq' = '999'
      and bling ->> 'pis_rate' ~ '^0([.]0+)?$' and bling ->> 'cofins_rate' ~ '^0([.]0+)?$'
      and bling ->> 'ipi_rate' ~ '^0([.]0+)?$'
      and exists (
        select 1 from jsonb_each(case when jsonb_typeof(config -> 'returnRules')='object'
          then config -> 'returnRules' else '{}'::jsonb end) as returns(route,rule)
        where ((route='buyer_outflow' and rule ->> 'cfop' = '5202')
            or (route='own_inflow' and rule ->> 'cfop' = '1202'))
          and ((rule ->> 'taxCodeKind'='CST' and rule ->> 'taxCode' ~ '^[0-9]{2}$')
            or (rule ->> 'taxCodeKind'='CSOSN' and rule ->> 'taxCode' ~ '^[0-9]{3}$'))
          and length(btrim(rule ->> 'homologationEvidence')) >= 10
      )
      and 1 = (select count(*) from jsonb_array_elements(
        case when jsonb_typeof(bling -> 'natures') = 'array' then bling -> 'natures' else '[]'::jsonb end
      ) nature where nature -> 'final_consumer' = 'false'::jsonb and nature ->> 'external_nature_id' ~ '^[1-9][0-9]{0,15}$')
      and (
        (config -> 'creditEligible' = 'false'::jsonb and bling ->> 'csosn' = '102'
          and bling ->> 'scenario' = 'resale_in_state_no_credit')
        or (a.buyer_profile = 'MG01' and config -> 'creditEligible' = 'true'::jsonb
          and config ->> 'creditBase' in ('merchandise','merchandise_with_shipping')
          and bling ->> 'csosn' = '101' and bling ->> 'scenario' = 'resale_in_state_credit'
          and 1 = (
            select count(*) from jsonb_array_elements(
              case when jsonb_typeof(bling -> 'credit_periods') = 'array' then bling -> 'credit_periods' else '[]'::jsonb end
            ) credit
            where credit ->> 'application_month' = to_char(statement_timestamp() at time zone 'America/Sao_Paulo','YYYY-MM-01')
              and credit ->> 'reference_month' = to_char((statement_timestamp() at time zone 'America/Sao_Paulo') - interval '1 month','YYYY-MM-01')
              and credit ->> 'rate' ~ '^([1-9][0-9]?|0)([.][0-9]{1,4})?$'
              and credit ->> 'rate' !~ '^0([.]0+)?$' and length(credit ->> 'evidence_reference') >= 10
              and credit ->> 'revision' ~ '^[1-9][0-9]{0,7}$'
              and credit ->> 'approved_by' ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
              and credit ->> 'approved_at' is not null
          ))
      )
  );
$$;

create or replace function public.manage_representative_kit_delivery_route(p_close uuid,p_route jsonb)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  route private.representative_kit_collection_routes;
begin
  perform private.require_permission('representatives.rules.manage');
  if p_close is not null then
    update private.representative_kit_collection_routes set closed_at=clock_timestamp()
      where id=p_close and closed_at is null returning * into route;
    if not found then return false; end if;
  else
    select * into route from jsonb_populate_record(null::private.representative_kit_collection_routes,p_route);
    if route.origin_postal_code is null or route.valid_until is null or route.valid_until <= clock_timestamp()
      or route.delivery_cents is distinct from 0 then return false; end if;
    perform pg_advisory_xact_lock(hashtextextended('kit_route:'||route.origin_postal_code,0));
    if exists (select 1 from private.representative_kit_collection_routes r
      where r.origin_postal_code=route.origin_postal_code and r.closed_at is null and r.valid_until>clock_timestamp()
        and route.destination_from<=r.destination_through and route.destination_through>=r.destination_from)
      then return false; end if;
    insert into private.representative_kit_collection_routes(name,origin_postal_code,destination_from,destination_through,
      delivery_cents,estimated_days,bling_method_ids,point_terminal_id,verified_evidence,valid_until)
    values(route.name,route.origin_postal_code,route.destination_from,route.destination_through,route.delivery_cents,
      route.estimated_days,route.bling_method_ids,route.point_terminal_id,route.verified_evidence,route.valid_until)
    returning id into route.id;
  end if;
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
    values(auth.uid(),private.current_app_role(),
      case when p_close is null then 'representative.kit.route.created' else 'representative.kit.route.closed' end,
      'representative_kit_delivery_route',route.id,jsonb_build_object('origin',route.origin_postal_code));
  return true;
end;
$$;

create or replace function public.manage_representative_kit_collection(p_order uuid,p_action text,p_evidence text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  o private.representative_kit_orders;
  f private.representative_kit_fulfillment;
begin
  if auth.uid() is null or not private.has_permission('orders.update_operational_status') then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  if length(btrim(coalesce(p_evidence,''))) not between 10 and 200 then return null; end if;
  select * into o from private.representative_kit_orders where id=p_order and (collection_route_id is not null or own_delivery_route_id is not null) for update;
  if not found or o.actor_id=auth.uid() then return null; end if;
  select * into f from private.representative_kit_fulfillment where order_id=p_order for update;
  if not found then return null; end if;
  if p_action='cash_received' and o.collection_method='cash' and (
    o.state='paid' or o.state='awaiting_receipt' and f.shipment_status in ('dispatched','delivered') and o.cancellation_requested_at is null
  ) then
    insert into private.representative_kit_collection_payments(order_id,opened_by) values(o.id,auth.uid()) on conflict do nothing;
    if not private.confirm_representative_kit_collection_receipt(o,btrim(p_evidence),auth.uid()) then return null; end if;
  elsif p_action='confirm_delivery' and f.shipment_status in ('dispatched','delivered')
    and o.state in ('awaiting_receipt','paid') and o.cancellation_requested_at is null
    and f.invoice_access_key is not null and f.invoice_cancellation_confirmed_at is null then
    if f.shipment_status='delivered' then return jsonb_build_object('ok',true); end if;
    update private.representative_kit_fulfillment set shipment_status='delivered',shipment_rank=7 where order_id=o.id;
  elsif p_action='dispatch' and o.state in ('awaiting_receipt','paid') and o.cancellation_requested_at is null
    and private.representative_kit_fiscal_ready(o) and (f.shipment_rank<4 or f.shipment_status='delayed' and o.collection_route_id is null) and f.invoice_access_key is not null
    and f.invoice_confirmed_at>clock_timestamp()-interval '30 minutes' then
    update private.representative_kit_fulfillment set shipment_status='dispatched',shipment_rank=4 where order_id=o.id;
  elsif p_action='cancel_before_dispatch' and o.state='awaiting_receipt' and o.cancellation_requested_at is null
    and f.shipment_rank<4 and f.bling_invoice_id is not null then
    update private.representative_kit_orders set cancellation_requested_at=clock_timestamp() where id=o.id;
    update private.representative_kit_fulfillment set shipment_status='delayed',shipment_rank=5,checked_at=null where order_id=o.id;
  elsif p_action='delivery_failed' and o.state='paid' and o.collection_route_id is null
    and f.shipment_status='dispatched' and o.cancellation_requested_at is null then
    update private.representative_kit_fulfillment set shipment_status='delayed',shipment_rank=5 where order_id=o.id;
  elsif p_action='delivery_failed' and o.state='awaiting_receipt' and f.shipment_status='dispatched'
    and not exists (select 1 from private.representative_kit_collection_payments p where p.order_id=o.id
      and (p.point_status is null or p.point_status not in ('failed','expired','canceled') or p.confirmed_at is not null)) then
    -- Circulated goods require a verified fiscal return before stock or finance can change.
    update private.representative_kit_fulfillment set shipment_status='delayed',shipment_rank=5,checked_at=null where order_id=o.id;
  elsif p_action='returned_unpaid' and o.state='awaiting_receipt' and o.cancellation_requested_at is not null
    and f.shipment_status='delayed' and f.invoice_cancellation_confirmed_at is not null
    and not exists (select 1 from private.representative_kit_collection_payments p where p.order_id=o.id
      and (p.point_status is null or p.point_status not in ('failed','expired','canceled') or p.confirmed_at is not null)) then
    perform private.transfer_representative_kit_inventory(o,o.quantity,'release',null,null,null,null);
    update private.representative_kit_orders set state='cancelled',stock_state='released' where id=o.id;
    update private.representative_kit_fulfillment set shipment_status='returned',shipment_rank=8 where order_id=o.id;
  else
    return null;
  end if;
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
    values(auth.uid(),private.current_app_role(),'representative.kit.collection.'||p_action,'representative_kit_order',o.id,
      jsonb_build_object('evidence',btrim(p_evidence)));
  return jsonb_build_object('ok',true);
end;
$$;
;

-- 20261120001812_representative_kit_mdfe_dispatch.sql
create table private.representative_kit_mdfe_checks (
  order_id uuid not null references private.representative_kit_orders(id),
  access_key text not null check (access_key ~ '^31[0-9]{18}58[0-9]{22}$'),
  invoice_access_key text not null check (invoice_access_key ~ '^31[0-9]{42}$'),
  protocol text not null check (protocol ~ '^[0-9]{15}$' and protocol <> repeat('0',15)),
  evidence text not null check (length(btrim(evidence)) between 10 and 200),
  verified_by uuid not null references auth.users(id),
  verified_at timestamptz not null default clock_timestamp(),
  used_at timestamptz,
  primary key (order_id,access_key)
);
alter table private.representative_kit_mdfe_checks enable row level security;
alter table private.representative_kit_mdfe_checks force row level security;
revoke all on private.representative_kit_mdfe_checks from public,anon,authenticated,service_role;

create function private.representative_kit_requires_mdfe(p_shipping jsonb)
returns boolean language sql immutable set search_path = '' as $$
  -- Only exempt a delivery when both CEPs and the delivery municipality
  -- identify the documented Nova Serrana route. Unknown locations require proof.
  -- https://www.novaserrana.mg.gov.br/portal/noticias/0/3/3120/novos-ceps-ja-estao-valendo-em-nova-serrana/novaserrana.mg.gov.br
  select not coalesce(
    (p_shipping ->> 'originPostalCode' between '35520000' and '35528999'
      or p_shipping ->> 'originPostalCode' = '35529000')
    and p_shipping ->> 'originPostalCode' ~ '^[0-9]{8}$'
    and (p_shipping #>> '{address,postalCode}' between '35520000' and '35528999'
      or p_shipping #>> '{address,postalCode}' = '35529000')
    and p_shipping #>> '{address,postalCode}' ~ '^[0-9]{8}$'
    and p_shipping #>> '{deliveryAddress,postalCode}' = p_shipping #>> '{address,postalCode}'
    and p_shipping #>> '{deliveryAddress,state}' = 'MG'
    and lower(btrim(p_shipping #>> '{deliveryAddress,city}')) = 'nova serrana', false);
$$;

create function private.representative_kit_pending_mdfe(p_order uuid,p_invoice_key text)
returns text language sql stable set search_path = '' as $$
  select c.access_key
  from private.representative_kit_mdfe_checks c
  where c.order_id=p_order and c.invoice_access_key=p_invoice_key and c.used_at is null
    and not exists (select 1 from private.representative_kit_mdfe_checks sent
      where sent.order_id=c.order_id and sent.used_at>=c.verified_at)
  order by c.verified_at desc,c.access_key limit 1;
$$;
revoke all on function private.representative_kit_requires_mdfe(jsonb),
  private.representative_kit_pending_mdfe(uuid,text) from public,anon,authenticated,service_role;

create function public.confirm_representative_kit_mdfe(p_order uuid,p_key text,p_protocol text,p_evidence text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  o private.representative_kit_orders;
  f private.representative_kit_fulfillment;
  remainder integer;
begin
  if auth.uid() is null or not private.has_permission('orders.update_operational_status') then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  if coalesce(p_key,'') !~ '^31[0-9]{18}58[0-9]{22}$'
    or coalesce(p_protocol,'') !~ '^[0-9]{15}$' or p_protocol=repeat('0',15)
    or length(btrim(coalesce(p_evidence,''))) not between 10 and 200 then return false; end if;
  select sum(substr(p_key,i,1)::integer * (2+(43-i)%8)) % 11 into remainder
    from generate_series(1,43) as digits(i);
  if right(p_key,1)::integer <> (case when remainder<2 then 0 else 11-remainder end) then return false; end if;

  select * into o from private.representative_kit_orders where id=p_order
    and (collection_route_id is not null or own_delivery_route_id is not null) for update;
  if not found or o.actor_id=auth.uid() or o.state not in ('awaiting_receipt','paid')
    or o.cancellation_requested_at is not null or not private.representative_kit_requires_mdfe(o.shipping_snapshot) then return false; end if;
  select * into f from private.representative_kit_fulfillment where order_id=p_order for update;
  if not found or f.invoice_access_key is null or f.invoice_confirmed_at is null
    or f.invoice_cancellation_confirmed_at is not null
    or substr(p_key,7,14) <> substr(f.invoice_access_key,7,14)
    or not (f.shipment_rank<4 or f.shipment_status='delayed' and o.collection_route_id is null) then return false; end if;

  insert into private.representative_kit_mdfe_checks as prior
    (order_id,access_key,invoice_access_key,protocol,evidence,verified_by)
    values(p_order,p_key,f.invoice_access_key,p_protocol,btrim(p_evidence),auth.uid())
  on conflict (order_id,access_key) do update set
    evidence=excluded.evidence,verified_by=excluded.verified_by,verified_at=excluded.verified_at
    where prior.used_at is null and prior.invoice_access_key=excluded.invoice_access_key and prior.protocol=excluded.protocol;
  if not found then return false; end if;
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
    values(auth.uid(),private.current_app_role(),'representative.kit.mdfe.verified','representative_kit_order',p_order,
      jsonb_build_object('manifestKeySuffix',right(p_key,8)));
  return true;
end;
$$;
revoke all on function public.confirm_representative_kit_mdfe(uuid,text,text,text) from public,anon,service_role;
grant execute on function public.confirm_representative_kit_mdfe(uuid,text,text,text) to authenticated;

create or replace function public.list_representative_kit_collection_work()
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not private.has_permission('orders.update_operational_status') then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  return (select coalesce(jsonb_agg(rows.summary),'[]'::jsonb) from (
    select private.representative_kit_order_summary(o) || jsonb_build_object(
      'productName',o.product_name,'invoiceAuthorized',f.invoice_confirmed_at is not null,
      'mdfeRequired',private.representative_kit_requires_mdfe(o.shipping_snapshot),
      'mdfeVerified',private.representative_kit_pending_mdfe(o.id,f.invoice_access_key) is not null,
      'shipmentStatus',f.shipment_status,'pointStarted',p.point_key is not null,'pointLinked',p.point_order_id is not null,
      'deliveryAddress',o.shipping_snapshot -> 'deliveryAddress',
      'pointStatus',p.point_status,
      'receiptConfirmed',p.confirmed_at is not null,'cancellationRequested',o.cancellation_requested_at is not null,
      'invoiceCancelled',f.invoice_cancellation_confirmed_at is not null) as summary
    from private.representative_kit_orders o join private.representative_kit_fulfillment f on f.order_id=o.id
    left join private.representative_kit_collection_payments p on p.order_id=o.id
    where o.collection_route_id is not null or o.own_delivery_route_id is not null
    order by o.created_at desc,o.id limit 50
  ) rows);
end;
$$;

create or replace function public.manage_representative_kit_collection(p_order uuid,p_action text,p_evidence text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  o private.representative_kit_orders;
  f private.representative_kit_fulfillment;
  mdfe_key text;
begin
  if auth.uid() is null or not private.has_permission('orders.update_operational_status') then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  if length(btrim(coalesce(p_evidence,''))) not between 10 and 200 then return null; end if;
  select * into o from private.representative_kit_orders where id=p_order and (collection_route_id is not null or own_delivery_route_id is not null) for update;
  if not found or o.actor_id=auth.uid() then return null; end if;
  select * into f from private.representative_kit_fulfillment where order_id=p_order for update;
  if not found then return null; end if;
  if p_action='cash_received' and o.collection_method='cash' and (
    o.state='paid' or o.state='awaiting_receipt' and f.shipment_status in ('dispatched','delivered') and o.cancellation_requested_at is null
  ) then
    insert into private.representative_kit_collection_payments(order_id,opened_by) values(o.id,auth.uid()) on conflict do nothing;
    if not private.confirm_representative_kit_collection_receipt(o,btrim(p_evidence),auth.uid()) then return null; end if;
  elsif p_action='confirm_delivery' and f.shipment_status in ('dispatched','delivered')
    and o.state in ('awaiting_receipt','paid') and o.cancellation_requested_at is null
    and f.invoice_access_key is not null and f.invoice_cancellation_confirmed_at is null then
    if f.shipment_status='delivered' then return jsonb_build_object('ok',true); end if;
    update private.representative_kit_fulfillment set shipment_status='delivered',shipment_rank=7 where order_id=o.id;
  elsif p_action='dispatch' and o.state in ('awaiting_receipt','paid') and o.cancellation_requested_at is null
    and private.representative_kit_fiscal_ready(o) and (f.shipment_rank<4 or f.shipment_status='delayed' and o.collection_route_id is null) and f.invoice_access_key is not null
    and f.invoice_confirmed_at>clock_timestamp()-interval '30 minutes' then
    if private.representative_kit_requires_mdfe(o.shipping_snapshot) then
      mdfe_key := private.representative_kit_pending_mdfe(o.id,f.invoice_access_key);
      if mdfe_key is null then raise exception 'kit_mdfe_required' using errcode='23514'; end if;
      update private.representative_kit_mdfe_checks set used_at=clock_timestamp()
        where order_id=o.id and access_key=mdfe_key;
    end if;
    update private.representative_kit_fulfillment set shipment_status='dispatched',shipment_rank=4 where order_id=o.id;
  elsif p_action='cancel_before_dispatch' and o.state='awaiting_receipt' and o.cancellation_requested_at is null
    and f.shipment_rank<4 and f.bling_invoice_id is not null then
    update private.representative_kit_orders set cancellation_requested_at=clock_timestamp() where id=o.id;
    update private.representative_kit_fulfillment set shipment_status='delayed',shipment_rank=5,checked_at=null where order_id=o.id;
  elsif p_action='delivery_failed' and o.state='paid' and o.collection_route_id is null
    and f.shipment_status='dispatched' and o.cancellation_requested_at is null then
    update private.representative_kit_fulfillment set shipment_status='delayed',shipment_rank=5 where order_id=o.id;
  elsif p_action='delivery_failed' and o.state='awaiting_receipt' and f.shipment_status='dispatched'
    and not exists (select 1 from private.representative_kit_collection_payments p where p.order_id=o.id
      and (p.point_status is null or p.point_status not in ('failed','expired','canceled') or p.confirmed_at is not null)) then
    -- Circulated goods require a verified fiscal return before stock or finance can change.
    update private.representative_kit_fulfillment set shipment_status='delayed',shipment_rank=5,checked_at=null where order_id=o.id;
  elsif p_action='returned_unpaid' and o.state='awaiting_receipt' and o.cancellation_requested_at is not null
    and f.shipment_status='delayed' and f.invoice_cancellation_confirmed_at is not null
    and not exists (select 1 from private.representative_kit_collection_payments p where p.order_id=o.id
      and (p.point_status is null or p.point_status not in ('failed','expired','canceled') or p.confirmed_at is not null)) then
    perform private.transfer_representative_kit_inventory(o,o.quantity,'release',null,null,null,null);
    update private.representative_kit_orders set state='cancelled',stock_state='released' where id=o.id;
    update private.representative_kit_fulfillment set shipment_status='returned',shipment_rank=8 where order_id=o.id;
  else
    return null;
  end if;
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
    values(auth.uid(),private.current_app_role(),'representative.kit.collection.'||p_action,'representative_kit_order',o.id,
      jsonb_build_object('evidence',btrim(p_evidence)));
  return jsonb_build_object('ok',true);
end;
$$;

create or replace function public.record_representative_kit_tracking(
  p_order uuid, p_shipment text, p_invoice_key text, p_status text, p_tracking text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  o private.representative_kit_orders;
  next_rank integer;
begin
  select * into o from private.representative_kit_orders where id = p_order for update;
  if not found or o.state <> 'paid' or o.stock_state <> 'sold' or not private.representative_kit_payment_allowed(o)
    or o.own_delivery_route_id is not null or o.collection_route_id is not null
    or p_invoice_key is null then return false; end if;
  next_rank := case p_status when 'pending' then 0 when 'ready' then 1 when 'label_created' then 2
    when 'dispatched' then 4 when 'in_transit' then 5 when 'delayed' then 5 when 'delivered' then 7
    when 'returned' then 8 when 'cancelled' then 8 else null end;
  if next_rank is null then return false; end if;
  update private.representative_kit_fulfillment set shipment_status = p_status, shipment_rank = next_rank,
    tracking_code = coalesce(nullif(p_tracking,''),tracking_code), checked_at = clock_timestamp()
    where order_id = p_order and shipment_id = p_shipment and invoice_access_key = p_invoice_key
      and invoice_confirmed_at > clock_timestamp() - interval '15 minutes'
      and shipment_rank <= next_rank and (shipment_rank < 8 or shipment_status = p_status);
  return found;
end;
$$;
;

-- 20261120003545_representative_kit_undelivered_return.sql
alter table private.representative_kit_returns
  add column return_kind text not null default 'delivered' check (return_kind in ('delivered','undelivered'));

create function public.register_representative_kit_undelivered_return(p_order uuid,p_invoice bigint,p_key text,
  p_restock_quantity integer,p_evidence text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  o private.representative_kit_orders;
  f private.representative_kit_fulfillment;
  r private.representative_kit_returns;
  rule jsonb;
begin
  perform private.require_permission('returns.inspect');
  if p_invoice is null or p_invoice<=0 or coalesce(p_key,'') !~ '^31[0-9]{20}004[0-9]{19}$'
    or p_restock_quantity is null or length(btrim(coalesce(p_evidence,''))) not between 10 and 200 then return false; end if;
  select * into o from private.representative_kit_orders where id=p_order
    and (own_delivery_route_id is not null or collection_route_id is not null) for update;
  if not found or o.actor_id=auth.uid() then return false; end if;
  select * into r from private.representative_kit_returns where order_id=p_order and return_kind='undelivered' and state<>'rejected';
  if found then return r.bling_invoice_id=p_invoice and r.invoice_key=p_key
    and r.restock_quantity=p_restock_quantity and r.inspection_reference=btrim(p_evidence); end if;
  if o.cancellation_requested_at is not null or o.returned_kit_count<>0 or p_restock_quantity not between 0 and o.quantity
    or exists (select 1 from private.representative_kit_returns where order_id=p_order and state<>'rejected') then return false; end if;
  select * into f from private.representative_kit_fulfillment where order_id=p_order for update;
  if not found or f.shipment_status is distinct from 'delayed' or f.invoice_access_key is null
    or substr(f.invoice_access_key,23,3)<>'003' or f.invoice_xml_sha256 is null
    or f.invoice_cancellation_confirmed_at is not null or f.bling_invoice_id=p_invoice then return false; end if;
  if not coalesce(o.state='paid' and o.stock_state='sold' or
    o.state='awaiting_receipt' and o.stock_state='reserved' and o.quantity=p_restock_quantity
      and not exists (select 1 from private.representative_kit_collection_payments p where p.order_id=o.id
        and (p.confirmed_at is not null or p.point_status is null or p.point_status not in ('failed','expired','canceled'))),false)
    then return false; end if;
  select fiscal_parameters #> '{returnRules,undelivered_return}' into rule
    from private.representative_resale_fiscal_rule_versions where id=o.rule_version_id;
  if not coalesce(rule->>'cfop'='1202' and rule->>'taxCodeKind'='CSOSN'
    and rule->>'taxCode' ~ '^[0-9]{3}$' and length(btrim(rule->>'homologationEvidence'))>=10,false) then return false; end if;

  insert into private.representative_kit_returns(order_id,request_key,return_kind,quantity,reason,state,inspected_by,
    inspection_reference,restock_quantity,bling_invoice_id,document_origin,invoice_key,refund_cents)
  values(o.id,gen_random_uuid(),'undelivered',o.quantity,'Retorno integral de mercadoria não entregue','received',auth.uid(),
    btrim(p_evidence),p_restock_quantity,p_invoice,'own_inflow',p_key,
    case when o.state='paid' then o.unit_price_cents*o.quantity+o.shipping_cents end);
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
    values(auth.uid(),private.current_app_role(),'representative.kit.undelivered.inspected','representative_kit_order',o.id,
      jsonb_build_object('restockQuantity',p_restock_quantity));
  return true;
end;
$$;
revoke all on function public.register_representative_kit_undelivered_return(uuid,bigint,text,integer,text) from public,anon,service_role;
grant execute on function public.register_representative_kit_undelivered_return(uuid,bigint,text,integer,text) to authenticated;

create or replace function public.record_representative_kit_return_invoice(p_return uuid,p_key text,p_protocol text,p_hash text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  r private.representative_kit_returns;
  o private.representative_kit_orders;
  f private.representative_kit_fulfillment;
begin
  if coalesce(p_protocol,'') !~ '^[0-9]{15}$' or coalesce(p_hash,'') !~ '^[0-9a-f]{64}$' then return false; end if;
  select order_id into r.order_id from private.representative_kit_returns where id=p_return;
  if not found then return false; end if;
  select * into o from private.representative_kit_orders where id=r.order_id for update;
  select * into r from private.representative_kit_returns where id=p_return for update;
  if not found or r.invoice_key is distinct from p_key then return false; end if;
  if r.state<>'received' then return r.invoice_protocol is not distinct from p_protocol
    and r.invoice_sha256 is not distinct from p_hash; end if;

  if r.return_kind='undelivered' then
    select * into f from private.representative_kit_fulfillment where order_id=o.id for update;
    if not found or f.shipment_status is distinct from 'delayed' or f.invoice_cancellation_confirmed_at is not null
      or o.cancellation_requested_at is not null or r.inspected_by is null or r.quantity<>o.quantity then return false; end if;
    if o.state='awaiting_receipt' and o.stock_state='reserved' and r.refund_cents is null and r.restock_quantity=o.quantity
      and not exists (select 1 from private.representative_kit_collection_payments p where p.order_id=o.id
        and (p.confirmed_at is not null or p.point_status is null or p.point_status not in ('failed','expired','canceled'))) then
      perform private.transfer_representative_kit_inventory(o,o.quantity,'release',null,null,null,null);
      update private.representative_kit_orders set state='cancelled',stock_state='released',returned_kit_count=o.quantity where id=o.id;
      r.state:='completed';
    elsif o.state='paid' and o.stock_state='sold' and r.refund_cents is not null then
      r.state:='verified';
    else return false;
    end if;
    update private.representative_kit_fulfillment set shipment_status='returned',shipment_rank=8 where order_id=o.id;
  else
    r.state:='verified';
  end if;
  update private.representative_kit_returns set state=r.state,invoice_protocol=p_protocol,invoice_sha256=p_hash,checked_at=clock_timestamp()
    where id=p_return;
  return found;
end;
$$;

create or replace function public.due_representative_kit_return_invoices()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(due)),'[]'::jsonb) from (
    select r.id as "returnId",r.quantity as "returnQuantity",r.document_origin as "documentOrigin",
      r.bling_invoice_id as "invoiceId",r.invoice_key as "invoiceKey",coalesce(r.refund_cents,o.unit_price_cents*o.quantity+o.shipping_cents) as "fiscalTotalInCents",
      o.quantity as "originalQuantity",o.buyer_snapshot ->> 'document' as "buyerDocument",
      rule.fiscal_parameters ->> 'issuerDocument' as "issuerDocument",
      rule.fiscal_parameters -> 'returnRules' -> case when r.return_kind='undelivered' then 'undelivered_return' else r.document_origin end as "returnRule",
      f.invoice_access_key as "originalKey",f.invoice_xml_sha256 as "originalHash",f.bling_invoice_id as "originalInvoiceId"
    from private.representative_kit_returns r join private.representative_kit_orders o on o.id=r.order_id
    join private.representative_kit_fulfillment f on f.order_id=o.id
    join private.representative_resale_fiscal_rule_versions rule on rule.id=o.rule_version_id
    where r.state='received' and f.invoice_cancellation_confirmed_at is null
      and (r.checked_at is null or r.checked_at<now()-interval '15 minutes')
    order by r.checked_at nulls first,r.id limit 3
  ) due;
$$;

create or replace function public.list_representative_kit_collection_work()
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not private.has_permission('orders.update_operational_status') then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  return (select coalesce(jsonb_agg(rows.summary),'[]'::jsonb) from (
    select private.representative_kit_order_summary(o) || jsonb_build_object(
      'productName',o.product_name,'invoiceAuthorized',f.invoice_confirmed_at is not null,
      'undeliveredReturnRecorded',exists(select 1 from private.representative_kit_returns r
        where r.order_id=o.id and r.return_kind='undelivered' and r.state<>'rejected'),
      'mdfeRequired',private.representative_kit_requires_mdfe(o.shipping_snapshot),
      'mdfeVerified',private.representative_kit_pending_mdfe(o.id,f.invoice_access_key) is not null,
      'shipmentStatus',f.shipment_status,'pointStarted',p.point_key is not null,'pointLinked',p.point_order_id is not null,
      'deliveryAddress',o.shipping_snapshot -> 'deliveryAddress',
      'pointStatus',p.point_status,
      'receiptConfirmed',p.confirmed_at is not null,'cancellationRequested',o.cancellation_requested_at is not null,
      'invoiceCancelled',f.invoice_cancellation_confirmed_at is not null) as summary
    from private.representative_kit_orders o join private.representative_kit_fulfillment f on f.order_id=o.id
    left join private.representative_kit_collection_payments p on p.order_id=o.id
    where o.collection_route_id is not null or o.own_delivery_route_id is not null
    order by o.created_at desc,o.id limit 50
  ) rows);
end;
$$;

create or replace function public.manage_representative_kit_collection(p_order uuid,p_action text,p_evidence text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  o private.representative_kit_orders;
  f private.representative_kit_fulfillment;
  mdfe_key text;
begin
  if auth.uid() is null or not private.has_permission('orders.update_operational_status') then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  if length(btrim(coalesce(p_evidence,''))) not between 10 and 200 then return null; end if;
  select * into o from private.representative_kit_orders where id=p_order and (collection_route_id is not null or own_delivery_route_id is not null) for update;
  if not found or o.actor_id=auth.uid() then return null; end if;
  select * into f from private.representative_kit_fulfillment where order_id=p_order for update;
  if not found then return null; end if;
  if p_action='cash_received' and o.collection_method='cash' and (
    o.state='paid' or o.state='awaiting_receipt' and f.shipment_status in ('dispatched','delivered') and o.cancellation_requested_at is null
  ) then
    insert into private.representative_kit_collection_payments(order_id,opened_by) values(o.id,auth.uid()) on conflict do nothing;
    if not private.confirm_representative_kit_collection_receipt(o,btrim(p_evidence),auth.uid()) then return null; end if;
  elsif p_action='confirm_delivery' and f.shipment_status in ('dispatched','delivered')
    and o.state in ('awaiting_receipt','paid') and o.cancellation_requested_at is null
    and f.invoice_access_key is not null and f.invoice_cancellation_confirmed_at is null then
    if f.shipment_status='delivered' then return jsonb_build_object('ok',true); end if;
    update private.representative_kit_fulfillment set shipment_status='delivered',shipment_rank=7 where order_id=o.id;
  elsif p_action='dispatch' and o.state in ('awaiting_receipt','paid') and o.cancellation_requested_at is null
    and not exists(select 1 from private.representative_kit_returns r
      where r.order_id=o.id and r.return_kind='undelivered' and r.state<>'rejected')
    and private.representative_kit_fiscal_ready(o) and (f.shipment_rank<4 or f.shipment_status='delayed' and o.collection_route_id is null) and f.invoice_access_key is not null
    and f.invoice_confirmed_at>clock_timestamp()-interval '30 minutes' then
    if private.representative_kit_requires_mdfe(o.shipping_snapshot) then
      mdfe_key := private.representative_kit_pending_mdfe(o.id,f.invoice_access_key);
      if mdfe_key is null then raise exception 'kit_mdfe_required' using errcode='23514'; end if;
      update private.representative_kit_mdfe_checks set used_at=clock_timestamp()
        where order_id=o.id and access_key=mdfe_key;
    end if;
    update private.representative_kit_fulfillment set shipment_status='dispatched',shipment_rank=4 where order_id=o.id;
  elsif p_action='cancel_before_dispatch' and o.state='awaiting_receipt' and o.cancellation_requested_at is null
    and f.shipment_rank<4 and f.bling_invoice_id is not null then
    update private.representative_kit_orders set cancellation_requested_at=clock_timestamp() where id=o.id;
    update private.representative_kit_fulfillment set shipment_status='delayed',shipment_rank=5,checked_at=null where order_id=o.id;
  elsif p_action='delivery_failed' and o.state='paid' and o.collection_route_id is null
    and f.shipment_status='dispatched' and o.cancellation_requested_at is null then
    update private.representative_kit_fulfillment set shipment_status='delayed',shipment_rank=5 where order_id=o.id;
  elsif p_action='delivery_failed' and o.state='awaiting_receipt' and f.shipment_status='dispatched'
    and not exists (select 1 from private.representative_kit_collection_payments p where p.order_id=o.id
      and (p.point_status is null or p.point_status not in ('failed','expired','canceled') or p.confirmed_at is not null)) then
    -- Circulated goods require a verified fiscal return before stock or finance can change.
    update private.representative_kit_fulfillment set shipment_status='delayed',shipment_rank=5,checked_at=null where order_id=o.id;
  elsif p_action='returned_unpaid' and o.state='awaiting_receipt' and o.cancellation_requested_at is not null
    and f.shipment_status='delayed' and f.invoice_cancellation_confirmed_at is not null
    and not exists (select 1 from private.representative_kit_collection_payments p where p.order_id=o.id
      and (p.point_status is null or p.point_status not in ('failed','expired','canceled') or p.confirmed_at is not null)) then
    perform private.transfer_representative_kit_inventory(o,o.quantity,'release',null,null,null,null);
    update private.representative_kit_orders set state='cancelled',stock_state='released' where id=o.id;
    update private.representative_kit_fulfillment set shipment_status='returned',shipment_rank=8 where order_id=o.id;
  else
    return null;
  end if;
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
    values(auth.uid(),private.current_app_role(),'representative.kit.collection.'||p_action,'representative_kit_order',o.id,
      jsonb_build_object('evidence',btrim(p_evidence)));
  return jsonb_build_object('ok',true);
end;
$$;
;

-- 20261120004205_representative_kit_verified_payment_methods.sql
create function private.representative_kit_route_methods_valid(p_methods jsonb,p_terminal text)
returns boolean language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(p_methods)='object' then
    not exists(select 1 from jsonb_each_text(p_methods) as method(name,id)
      where name not in ('cash','pix','debit_card','credit_card') or id is null or id !~ '^[1-9][0-9]{0,14}$'
        or (name<>'cash' and p_terminal is null))
    else false end;
$$;
revoke all on function private.representative_kit_route_methods_valid(jsonb,text) from public,anon,authenticated,service_role;

alter table private.representative_kit_collection_routes
  drop constraint representative_kit_collection_routes_bling_method_ids_check,
  drop constraint representative_kit_collection_method_ids_present,
  alter column point_terminal_id drop not null,
  add constraint representative_kit_verified_route_methods check (
    private.representative_kit_route_methods_valid(bling_method_ids,point_terminal_id));

alter table private.representative_kit_orders
  drop constraint representative_kit_order_collection_complete,
  add constraint representative_kit_order_collection_complete check (
    (num_nonnulls(collection_route_id,collection_method,collection_bling_method)=0 and collection_point_terminal is null
      or num_nonnulls(collection_route_id,collection_method,collection_bling_method)=3
        and (collection_method='cash' or collection_point_terminal is not null))
    and ((collection_method is not distinct from 'cash') = (cash_tendered_cents is not null))
    and (cash_tendered_cents is null or cash_tendered_cents>=unit_price_cents*quantity+shipping_cents)
    and (state<>'awaiting_receipt' or collection_route_id is not null));

create or replace function public.reserve_representative_kit_collection_order(
  p_actor uuid,p_selection uuid,p_template text,p_quantity integer,p_quote uuid,p_address uuid,
  p_key uuid,p_origin text,p_method text,p_cash_tendered bigint
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  route private.representative_kit_collection_routes;
  reserved jsonb;
  o private.representative_kit_orders;
  total bigint;
begin
  if p_actor is null or p_key is null or p_method is null
    or p_method not in ('cash','pix','debit_card','credit_card') or (p_method='cash')<>(p_cash_tendered is not null) then
    raise exception 'invalid_kit_collection' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('representative-kit:'||p_actor::text||':'||p_key::text,0));
  select * into o from private.representative_kit_orders where actor_id=p_actor and idempotency_key=p_key;
  if found then
    if (coalesce(o.grade_kit_id,o.variant_id),o.grade_template,o.quantity,o.quote_id,o.address_id,o.collection_method,o.cash_tendered_cents)
      is distinct from (p_selection,p_template,p_quantity,p_quote,p_address,p_method,p_cash_tendered) then
      raise exception 'kit_idempotency_conflict' using errcode='23505';
    end if;
    return private.representative_kit_order_summary(o);
  end if;

  select cr.* into route from private.representative_kit_shipping_checkout_quotes q
    join private.representative_kit_collection_routes cr on cr.id=q.collection_route_id
    where q.id=p_quote and q.actor_id=p_actor and q.address_id=p_address and q.origin_postal_code=p_origin
      and cr.origin_postal_code=p_origin and q.postal_code between cr.destination_from and cr.destination_through
      and cr.delivery_cents=q.amount_in_cents and cr.estimated_days=q.estimated_days
      and cr.valid_until>clock_timestamp() and cr.closed_at is null for share of cr;
  if not found or not (route.bling_method_ids ? p_method) then
    raise exception 'kit_collection_unavailable' using errcode='23514'; end if;

  if p_template is null then
    reserved:=private.reserve_representative_kit_order(p_actor,p_selection,p_quantity,p_quote,p_address,p_key,p_origin);
  else
    reserved:=private.reserve_representative_kit_grade_order(p_actor,p_selection,p_template,p_quantity,p_quote,p_address,p_key,p_origin);
  end if;
  total:=(reserved ->> 'amountInCents')::bigint;
  if p_method='cash' and (p_cash_tendered<total or p_cash_tendered>9007199254740991) then
    raise exception 'kit_cash_tender_invalid' using errcode='23514';
  end if;
  update private.representative_kit_orders set state='awaiting_receipt',collection_route_id=route.id,
    collection_method=p_method,collection_bling_method=(route.bling_method_ids ->> p_method)::bigint,
    collection_point_terminal=case when p_method<>'cash' then route.point_terminal_id end,cash_tendered_cents=p_cash_tendered,
    shipping_snapshot=jsonb_set(shipping_snapshot,'{provider}','"own_delivery"')
    where id=(reserved ->> 'orderId')::uuid returning * into o;
  insert into private.representative_kit_fulfillment(order_id) values (o.id) on conflict do nothing;
  return private.representative_kit_order_summary(o);
end;
$$;

create or replace function public.quote_representative_kit_own_delivery(
  p_actor uuid,p_selection uuid,p_template text,p_quantity integer,p_address uuid,p_origin text,p_at_receipt boolean
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  route private.representative_kit_collection_routes;
  address_row public.addresses;
  postal text;
  grade_shipping jsonb;
  inserted jsonb;
  price bigint;
  dimensions jsonb;
  expiry timestamptz := clock_timestamp()+interval '15 minutes';
begin
  if p_quantity is null or p_quantity not between 1 and 99 then return null; end if;
  select * into address_row from public.addresses a where a.user_id=p_actor
    and a.id=p_address and a.state='MG' and a.country='BR' for share;
  if not found then return null; end if;
  postal:=regexp_replace(address_row.postal_code,'[^0-9]','','g');
  if postal !~ '^3[0-9]{7}$' then return null; end if;
  select q.* into route from private.representative_kit_collection_routes q
    where (p_origin is null or q.origin_postal_code=p_origin) and postal between q.destination_from and q.destination_through
      and q.valid_until>expiry and q.closed_at is null
      and 1=(select count(*) from private.representative_kit_collection_routes t
        where (p_origin is null or t.origin_postal_code=p_origin) and postal between t.destination_from and t.destination_through
          and t.valid_until>expiry and t.closed_at is null)
    for share;
  if not found or (p_at_receipt and route.bling_method_ids='{}'::jsonb) then return null; end if;
  p_origin := route.origin_postal_code;
  if p_template is null then
    if not public.representative_kit_purchase_available(p_actor,p_selection,p_origin) then return null; end if;
    select inputs.price_cents,inputs.dimensions into price,dimensions
      from private.representative_kit_shipping_inputs(p_selection) inputs
      join private.bling_catalog_metadata m on m.product_id=(select product_id from public.product_variants where id=p_selection)
      join public.inventory i on i.variant_id=p_selection
      where m.pairs_per_sku>1 and i.available_quantity>=p_quantity;
    if not found or price<=0 then return null; end if;
    inserted:=public.confirm_representative_kit_shipping_quote(
      p_actor,p_selection,p_quantity,p_address,postal,repeat('0',64),case when p_at_receipt then 'recebimento' else 'entrega_propria' end,route.name,route.name,
      route.delivery_cents,route.delivery_cents,route.estimated_days,'[]'::jsonb,expiry,p_origin,price,dimensions);
  else
    grade_shipping:=public.read_representative_kit_grade_shipping(p_actor,p_selection,p_template,p_quantity,p_address,p_origin);
    if grade_shipping -> 'purchaseAvailable' is distinct from 'true'::jsonb then return null; end if;
    price:=(grade_shipping ->> 'priceCents')::bigint;
    inserted:=public.confirm_representative_kit_grade_shipping(
      p_actor,p_selection,p_template,p_quantity,p_address,p_origin,grade_shipping ->> 'catalogHash',
      address_row.updated_at,repeat('0',64),case when p_at_receipt then 'recebimento' else 'entrega_propria' end,route.name,route.name,route.delivery_cents,
      route.delivery_cents,route.estimated_days,'[]'::jsonb,expiry);
  end if;
  if inserted ->> 'id' is null then return null; end if;
  update private.representative_kit_shipping_checkout_quotes set own_delivery_route_id=route.id, collection_route_id=case when p_at_receipt then route.id end
    where id=(inserted ->> 'id')::uuid;
  return jsonb_build_object('id',inserted -> 'id','shippingInCents',route.delivery_cents,
    'amountInCents',price*p_quantity+route.delivery_cents,'estimatedDays',route.estimated_days,'service',route.name,
    'collectionMethods',(select coalesce(jsonb_agg(m.name order by m.name),'[]'::jsonb)
      from jsonb_object_keys(route.bling_method_ids) m(name) where p_at_receipt));
end;
$$;

create or replace function public.manage_representative_kit_delivery_route(p_close uuid,p_route jsonb)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  route private.representative_kit_collection_routes;
begin
  perform private.require_permission('representatives.rules.manage');
  if p_close is not null then
    update private.representative_kit_collection_routes set closed_at=clock_timestamp()
      where id=p_close and closed_at is null returning * into route;
    if not found then return false; end if;
  else
    select * into route from jsonb_populate_record(null::private.representative_kit_collection_routes,p_route);
    if route.origin_postal_code is null or route.valid_until is null or route.valid_until <= clock_timestamp()
      or route.delivery_cents is distinct from 0
      or route.point_terminal_id is not null or route.bling_method_ids - 'cash' <> '{}'::jsonb
      or not private.representative_kit_route_methods_valid(route.bling_method_ids,route.point_terminal_id) then return false; end if;
    perform pg_advisory_xact_lock(hashtextextended('kit_route:'||route.origin_postal_code,0));
    if exists (select 1 from private.representative_kit_collection_routes r
      where r.origin_postal_code=route.origin_postal_code and r.closed_at is null and r.valid_until>clock_timestamp()
        and route.destination_from<=r.destination_through and route.destination_through>=r.destination_from)
      then return false; end if;
    insert into private.representative_kit_collection_routes(name,origin_postal_code,destination_from,destination_through,
      delivery_cents,estimated_days,bling_method_ids,point_terminal_id,verified_evidence,valid_until)
    values(route.name,route.origin_postal_code,route.destination_from,route.destination_through,route.delivery_cents,
      route.estimated_days,route.bling_method_ids,route.point_terminal_id,route.verified_evidence,route.valid_until)
    returning id into route.id;
  end if;
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
    values(auth.uid(),private.current_app_role(),
      case when p_close is null then 'representative.kit.route.created' else 'representative.kit.route.closed' end,
      'representative_kit_delivery_route',route.id,jsonb_build_object('origin',route.origin_postal_code));
  return true;
end;
$$;
;

-- 20261120130000_representative_kit_address_delivery.sql
-- Prepaid own delivery uses the buyer's verified MG address and the approved origin.
alter table private.representative_kit_shipping_checkout_quotes
  alter column estimated_days drop not null,
  add column address_only_delivery boolean not null default false,
  add constraint kit_quote_address_only_delivery check (
    (estimated_days is not null or service_id='entrega_propria_endereco')
    and (not address_only_delivery or (service_id='entrega_propria_endereco'
      and estimated_days is null and own_delivery_route_id is null and collection_route_id is null
      and amount_in_cents=0 and cost_in_cents=0)));

create function private.representative_kit_is_own_delivery(o private.representative_kit_orders)
returns boolean language sql immutable set search_path = '' as $$
  select o.collection_route_id is not null or o.own_delivery_route_id is not null
    or coalesce(o.shipping_snapshot ->> 'provider'='own_delivery',false);
$$;
revoke all on function private.representative_kit_is_own_delivery(private.representative_kit_orders)
  from public,anon,authenticated,service_role;

create or replace function public.quote_representative_kit_own_delivery(
  p_actor uuid,p_selection uuid,p_template text,p_quantity integer,p_address uuid,p_origin text,p_at_receipt boolean
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  route private.representative_kit_collection_routes;
  service_id text;
  address_row public.addresses;
  postal text;
  grade_shipping jsonb;
  inserted jsonb;
  price bigint;
  dimensions jsonb;
  expiry timestamptz := clock_timestamp()+interval '15 minutes';
begin
  if p_at_receipt is null or p_quantity is null or p_quantity not between 1 and 99 then return null; end if;
  select * into address_row from public.addresses a where a.user_id=p_actor
    and a.id=p_address and a.state='MG' and a.country='BR' for share;
  if not found then return null; end if;
  postal:=regexp_replace(address_row.postal_code,'[^0-9]','','g');
  if postal is null or postal !~ '^3[0-9]{7}$' then return null; end if;
  if p_at_receipt then
    select q.* into route from private.representative_kit_collection_routes q
      where (p_origin is null or q.origin_postal_code=p_origin) and postal between q.destination_from and q.destination_through
        and q.valid_until>expiry and q.closed_at is null
        and 1=(select count(*) from private.representative_kit_collection_routes t
          where (p_origin is null or t.origin_postal_code=p_origin) and postal between t.destination_from and t.destination_through
            and t.valid_until>expiry and t.closed_at is null)
      for share;
    if not found or route.bling_method_ids='{}'::jsonb then return null; end if;
    p_origin := route.origin_postal_code;
    service_id := 'recebimento';
  else
    if p_origin is null then
      select min(a.origin_postal_code) into p_origin
        from private.representative_kit_checkout_approvals a
        where a.actor_id=p_actor and a.revoked_at is null and a.valid_until>expiry
        having count(distinct a.origin_postal_code)=1;
    end if;
    if p_origin is null then return null; end if;
    service_id := 'entrega_propria_endereco';
    route.name := 'Entrega própria';
    route.delivery_cents := 0;
  end if;
  if p_template is null then
    if not public.representative_kit_purchase_available(p_actor,p_selection,p_origin) then return null; end if;
    select inputs.price_cents,inputs.dimensions into price,dimensions
      from private.representative_kit_shipping_inputs(p_selection) inputs
      join private.bling_catalog_metadata m on m.product_id=(select product_id from public.product_variants where id=p_selection)
      join public.inventory i on i.variant_id=p_selection
      where m.pairs_per_sku>1 and i.available_quantity>=p_quantity;
    if not found or price<=0 then return null; end if;
    inserted:=public.confirm_representative_kit_shipping_quote(
      p_actor,p_selection,p_quantity,p_address,postal,repeat('0',64),service_id,route.name,route.name,
      route.delivery_cents,route.delivery_cents,route.estimated_days,'[]'::jsonb,expiry,p_origin,price,dimensions);
  else
    grade_shipping:=public.read_representative_kit_grade_shipping(p_actor,p_selection,p_template,p_quantity,p_address,p_origin);
    if grade_shipping -> 'purchaseAvailable' is distinct from 'true'::jsonb then return null; end if;
    price:=(grade_shipping ->> 'priceCents')::bigint;
    inserted:=public.confirm_representative_kit_grade_shipping(
      p_actor,p_selection,p_template,p_quantity,p_address,p_origin,grade_shipping ->> 'catalogHash',
      address_row.updated_at,repeat('0',64),service_id,route.name,route.name,route.delivery_cents,
      route.delivery_cents,route.estimated_days,'[]'::jsonb,expiry);
  end if;
  if inserted ->> 'id' is null then return null; end if;
  update private.representative_kit_shipping_checkout_quotes set address_only_delivery=not p_at_receipt, own_delivery_route_id=route.id, collection_route_id=case when p_at_receipt then route.id end
    where id=(inserted ->> 'id')::uuid;
  return jsonb_build_object('id',inserted -> 'id','shippingInCents',route.delivery_cents,
    'amountInCents',price*p_quantity+route.delivery_cents,'estimatedDays',route.estimated_days,'service',route.name,
    'collectionMethods',(select coalesce(jsonb_agg(m.name order by m.name),'[]'::jsonb)
      from jsonb_object_keys(route.bling_method_ids) m(name) where p_at_receipt));
end;
$$;

create or replace function private.record_representative_kit_own_delivery()
returns trigger language plpgsql set search_path = ''
as $$
declare
  quote private.representative_kit_shipping_checkout_quotes;
  route private.representative_kit_collection_routes;
  delivery public.addresses;
begin
  select * into quote from private.representative_kit_shipping_checkout_quotes where id=new.quote_id;
  if not coalesce(quote.address_only_delivery,false) then
    if quote.own_delivery_route_id is null then return new; end if;
    select * into route from private.representative_kit_collection_routes
      where id=quote.own_delivery_route_id for share;
    if not found or route.closed_at is not null or route.valid_until <= clock_timestamp()
      or quote.origin_postal_code <> route.origin_postal_code
      or quote.postal_code not between route.destination_from and route.destination_through
      or route.delivery_cents <> quote.amount_in_cents or route.name <> quote.service
      or route.estimated_days <> quote.estimated_days
      or 1 <> (select count(*) from private.representative_kit_collection_routes r
        where r.origin_postal_code=quote.origin_postal_code and quote.postal_code between r.destination_from and r.destination_through
          and r.closed_at is null and r.valid_until>clock_timestamp()) then
      raise exception 'kit_own_delivery_quote_changed' using errcode='23514';
    end if;
  end if;
  select * into strict delivery from public.addresses where id=quote.address_id and user_id=new.actor_id
    and state='MG' and country='BR' and updated_at=quote.address_updated_at;
  new.own_delivery_route_id := route.id;
  new.shipping_snapshot := new.shipping_snapshot || jsonb_build_object(
    'provider','own_delivery','routeId',route.id,'estimatedDays',route.estimated_days,
    'deliveryAddress',jsonb_build_object('name',delivery.recipient_name,'street',delivery.street,
      'number',delivery.number,'complement',delivery.complement,'district',delivery.district,
      'city',delivery.city,'state',delivery.state,'postalCode',quote.postal_code));
  return new;
end;
$$;

create or replace function public.reserve_representative_kit_own_delivery(
  p_actor uuid,p_selection uuid,p_template text,p_quantity integer,p_quote uuid,p_address uuid,p_key uuid,p_origin text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  origin text;
begin
  select q.origin_postal_code into origin from private.representative_kit_shipping_checkout_quotes q
    where q.id=p_quote and q.actor_id=p_actor and (q.address_only_delivery or q.own_delivery_route_id is not null)
      and q.collection_route_id is null;
  if not found or (p_origin is not null and p_origin <> origin)
    then raise exception 'kit_quote_unavailable' using errcode='23514'; end if;
  if p_template is null then
    return public.reserve_representative_kit_order(p_actor,p_selection,p_quantity,p_quote,p_address,p_key,origin);
  end if;
  return public.reserve_representative_kit_grade_order(p_actor,p_selection,p_template,p_quantity,p_quote,p_address,p_key,origin);
end;
$$;

create or replace function public.due_representative_kit_fulfillment()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(due)),'[]'::jsonb) from (
    select f.order_id as "orderId", f.bling_sale_id as "saleId", f.bling_invoice_id as "invoiceId",
      f.shipment_id as "shipmentId", f.shipment_status as "shipmentStatus", o.variant_id as "variantId",
      o.sku, o.product_name as "productName", o.quantity, coalesce(o.paid_at,o.created_at) as "paidAt", o.grade_lines as "gradeLines",
      private.representative_kit_is_own_delivery(o) as "ownDelivery", o.collection_method as "collectionMethod", o.collection_bling_method as "collectionBlingMethod", o.created_at as "createdAt",
      o.shipping_snapshot ->> 'estimatedDays' as "deliveryDays",
      o.unit_price_cents as "unitPriceInCents", o.shipping_cents as "shippingInCents",
      o.unit_price_cents * o.quantity + o.shipping_cents as "amountInCents",
      o.shipping_snapshot ->> 'serviceId' as "serviceId",
      o.shipping_snapshot ->> 'originPostalCode' as "originPostalCode",
      o.shipping_snapshot -> 'address' ->> 'postalCode' as "postalCode",
      a.buyer_profile as "buyerProfile", a.buyer_document as "buyerDocument", a.buyer_state_registration as "buyerStateRegistration",
      r.fiscal_parameters as "fiscalParameters"
    from private.representative_kit_fulfillment f
    join private.representative_kit_orders o on o.id = f.order_id
    join private.representative_kit_checkout_approvals a on a.actor_id = o.actor_id and a.rule_version_id = o.rule_version_id
    join private.representative_resale_fiscal_rule_versions r on r.id = o.rule_version_id
    where private.representative_kit_fiscal_ready(o)
      and not exists (
        select 1 from jsonb_array_elements(o.grade_lines) item
        where private.bling_kit_source_hash((item ->> 'variantId')::uuid) is distinct from item ->> 'fiscalHash'
      )
      and coalesce(f.shipment_status,'pending') not in ('returned','cancelled','delivered')
      and (f.checked_at is null or f.checked_at < now() - interval '15 minutes')
      and not exists(select 1 from private.bling_order_links b
        where b.invoice_id = f.bling_invoice_id or b.external_order_id = f.bling_sale_id)
    order by f.checked_at nulls first, f.order_id limit 3
  ) due;
$$;

create or replace function public.confirm_representative_kit_mdfe(p_order uuid,p_key text,p_protocol text,p_evidence text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  o private.representative_kit_orders;
  f private.representative_kit_fulfillment;
  remainder integer;
begin
  if auth.uid() is null or not private.has_permission('orders.update_operational_status') then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  if coalesce(p_key,'') !~ '^31[0-9]{18}58[0-9]{22}$'
    or coalesce(p_protocol,'') !~ '^[0-9]{15}$' or p_protocol=repeat('0',15)
    or length(btrim(coalesce(p_evidence,''))) not between 10 and 200 then return false; end if;
  select sum(substr(p_key,i,1)::integer * (2+(43-i)%8)) % 11 into remainder
    from generate_series(1,43) as digits(i);
  if right(p_key,1)::integer <> (case when remainder<2 then 0 else 11-remainder end) then return false; end if;

  select * into o from private.representative_kit_orders candidate where id=p_order
    and (private.representative_kit_is_own_delivery(candidate)) for update;
  if not found or o.actor_id=auth.uid() or o.state not in ('awaiting_receipt','paid')
    or o.cancellation_requested_at is not null or not private.representative_kit_requires_mdfe(o.shipping_snapshot) then return false; end if;
  select * into f from private.representative_kit_fulfillment where order_id=p_order for update;
  if not found or f.invoice_access_key is null or f.invoice_confirmed_at is null
    or f.invoice_cancellation_confirmed_at is not null
    or substr(p_key,7,14) <> substr(f.invoice_access_key,7,14)
    or not (f.shipment_rank<4 or f.shipment_status='delayed' and o.collection_route_id is null) then return false; end if;

  insert into private.representative_kit_mdfe_checks as prior
    (order_id,access_key,invoice_access_key,protocol,evidence,verified_by)
    values(p_order,p_key,f.invoice_access_key,p_protocol,btrim(p_evidence),auth.uid())
  on conflict (order_id,access_key) do update set
    evidence=excluded.evidence,verified_by=excluded.verified_by,verified_at=excluded.verified_at
    where prior.used_at is null and prior.invoice_access_key=excluded.invoice_access_key and prior.protocol=excluded.protocol;
  if not found then return false; end if;
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
    values(auth.uid(),private.current_app_role(),'representative.kit.mdfe.verified','representative_kit_order',p_order,
      jsonb_build_object('manifestKeySuffix',right(p_key,8)));
  return true;
end;
$$;

create or replace function public.record_representative_kit_tracking(
  p_order uuid, p_shipment text, p_invoice_key text, p_status text, p_tracking text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  o private.representative_kit_orders;
  next_rank integer;
begin
  select * into o from private.representative_kit_orders where id = p_order for update;
  if not found or o.state <> 'paid' or o.stock_state <> 'sold' or not private.representative_kit_payment_allowed(o)
    or private.representative_kit_is_own_delivery(o)
    or p_invoice_key is null then return false; end if;
  next_rank := case p_status when 'pending' then 0 when 'ready' then 1 when 'label_created' then 2
    when 'dispatched' then 4 when 'in_transit' then 5 when 'delayed' then 5 when 'delivered' then 7
    when 'returned' then 8 when 'cancelled' then 8 else null end;
  if next_rank is null then return false; end if;
  update private.representative_kit_fulfillment set shipment_status = p_status, shipment_rank = next_rank,
    tracking_code = coalesce(nullif(p_tracking,''),tracking_code), checked_at = clock_timestamp()
    where order_id = p_order and shipment_id = p_shipment and invoice_access_key = p_invoice_key
      and invoice_confirmed_at > clock_timestamp() - interval '15 minutes'
      and shipment_rank <= next_rank and (shipment_rank < 8 or shipment_status = p_status);
  return found;
end;
$$;

create or replace function public.register_representative_kit_undelivered_return(p_order uuid,p_invoice bigint,p_key text,
  p_restock_quantity integer,p_evidence text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  o private.representative_kit_orders;
  f private.representative_kit_fulfillment;
  r private.representative_kit_returns;
  rule jsonb;
begin
  perform private.require_permission('returns.inspect');
  if p_invoice is null or p_invoice<=0 or coalesce(p_key,'') !~ '^31[0-9]{20}004[0-9]{19}$'
    or p_restock_quantity is null or length(btrim(coalesce(p_evidence,''))) not between 10 and 200 then return false; end if;
  select * into o from private.representative_kit_orders candidate where id=p_order
    and (private.representative_kit_is_own_delivery(candidate)) for update;
  if not found or o.actor_id=auth.uid() then return false; end if;
  select * into r from private.representative_kit_returns where order_id=p_order and return_kind='undelivered' and state<>'rejected';
  if found then return r.bling_invoice_id=p_invoice and r.invoice_key=p_key
    and r.restock_quantity=p_restock_quantity and r.inspection_reference=btrim(p_evidence); end if;
  if o.cancellation_requested_at is not null or o.returned_kit_count<>0 or p_restock_quantity not between 0 and o.quantity
    or exists (select 1 from private.representative_kit_returns where order_id=p_order and state<>'rejected') then return false; end if;
  select * into f from private.representative_kit_fulfillment where order_id=p_order for update;
  if not found or f.shipment_status is distinct from 'delayed' or f.invoice_access_key is null
    or substr(f.invoice_access_key,23,3)<>'003' or f.invoice_xml_sha256 is null
    or f.invoice_cancellation_confirmed_at is not null or f.bling_invoice_id=p_invoice then return false; end if;
  if not coalesce(o.state='paid' and o.stock_state='sold' or
    o.state='awaiting_receipt' and o.stock_state='reserved' and o.quantity=p_restock_quantity
      and not exists (select 1 from private.representative_kit_collection_payments p where p.order_id=o.id
        and (p.confirmed_at is not null or p.point_status is null or p.point_status not in ('failed','expired','canceled'))),false)
    then return false; end if;
  select fiscal_parameters #> '{returnRules,undelivered_return}' into rule
    from private.representative_resale_fiscal_rule_versions where id=o.rule_version_id;
  if not coalesce(rule->>'cfop'='1202' and rule->>'taxCodeKind'='CSOSN'
    and rule->>'taxCode' ~ '^[0-9]{3}$' and length(btrim(rule->>'homologationEvidence'))>=10,false) then return false; end if;

  insert into private.representative_kit_returns(order_id,request_key,return_kind,quantity,reason,state,inspected_by,
    inspection_reference,restock_quantity,bling_invoice_id,document_origin,invoice_key,refund_cents)
  values(o.id,gen_random_uuid(),'undelivered',o.quantity,'Retorno integral de mercadoria não entregue','received',auth.uid(),
    btrim(p_evidence),p_restock_quantity,p_invoice,'own_inflow',p_key,
    case when o.state='paid' then o.unit_price_cents*o.quantity+o.shipping_cents end);
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
    values(auth.uid(),private.current_app_role(),'representative.kit.undelivered.inspected','representative_kit_order',o.id,
      jsonb_build_object('restockQuantity',p_restock_quantity));
  return true;
end;
$$;

create or replace function public.list_representative_kit_collection_work()
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not private.has_permission('orders.update_operational_status') then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  return (select coalesce(jsonb_agg(rows.summary),'[]'::jsonb) from (
    select private.representative_kit_order_summary(o) || jsonb_build_object(
      'productName',o.product_name,'invoiceAuthorized',f.invoice_confirmed_at is not null,
      'undeliveredReturnRecorded',exists(select 1 from private.representative_kit_returns r
        where r.order_id=o.id and r.return_kind='undelivered' and r.state<>'rejected'),
      'mdfeRequired',private.representative_kit_requires_mdfe(o.shipping_snapshot),
      'mdfeVerified',private.representative_kit_pending_mdfe(o.id,f.invoice_access_key) is not null,
      'shipmentStatus',f.shipment_status,'pointStarted',p.point_key is not null,'pointLinked',p.point_order_id is not null,
      'deliveryAddress',o.shipping_snapshot -> 'deliveryAddress',
      'pointStatus',p.point_status,
      'receiptConfirmed',p.confirmed_at is not null,'cancellationRequested',o.cancellation_requested_at is not null,
      'invoiceCancelled',f.invoice_cancellation_confirmed_at is not null) as summary
    from private.representative_kit_orders o join private.representative_kit_fulfillment f on f.order_id=o.id
    left join private.representative_kit_collection_payments p on p.order_id=o.id
    where private.representative_kit_is_own_delivery(o)
    order by o.created_at desc,o.id limit 50
  ) rows);
end;
$$;

create or replace function public.manage_representative_kit_collection(p_order uuid,p_action text,p_evidence text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  o private.representative_kit_orders;
  f private.representative_kit_fulfillment;
  mdfe_key text;
begin
  if auth.uid() is null or not private.has_permission('orders.update_operational_status') then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  if length(btrim(coalesce(p_evidence,''))) not between 10 and 200 then return null; end if;
  select * into o from private.representative_kit_orders candidate where id=p_order and (private.representative_kit_is_own_delivery(candidate)) for update;
  if not found or o.actor_id=auth.uid() then return null; end if;
  select * into f from private.representative_kit_fulfillment where order_id=p_order for update;
  if not found then return null; end if;
  if p_action='cash_received' and o.collection_method='cash' and (
    o.state='paid' or o.state='awaiting_receipt' and f.shipment_status in ('dispatched','delivered') and o.cancellation_requested_at is null
  ) then
    insert into private.representative_kit_collection_payments(order_id,opened_by) values(o.id,auth.uid()) on conflict do nothing;
    if not private.confirm_representative_kit_collection_receipt(o,btrim(p_evidence),auth.uid()) then return null; end if;
  elsif p_action='confirm_delivery' and f.shipment_status in ('dispatched','delivered')
    and o.state in ('awaiting_receipt','paid') and o.cancellation_requested_at is null
    and f.invoice_access_key is not null and f.invoice_cancellation_confirmed_at is null then
    if f.shipment_status='delivered' then return jsonb_build_object('ok',true); end if;
    update private.representative_kit_fulfillment set shipment_status='delivered',shipment_rank=7 where order_id=o.id;
  elsif p_action='dispatch' and o.state in ('awaiting_receipt','paid') and o.cancellation_requested_at is null
    and not exists(select 1 from private.representative_kit_returns r
      where r.order_id=o.id and r.return_kind='undelivered' and r.state<>'rejected')
    and private.representative_kit_fiscal_ready(o) and (f.shipment_rank<4 or f.shipment_status='delayed' and o.collection_route_id is null) and f.invoice_access_key is not null
    and f.invoice_confirmed_at>clock_timestamp()-interval '30 minutes' then
    if private.representative_kit_requires_mdfe(o.shipping_snapshot) then
      mdfe_key := private.representative_kit_pending_mdfe(o.id,f.invoice_access_key);
      if mdfe_key is null then raise exception 'kit_mdfe_required' using errcode='23514'; end if;
      update private.representative_kit_mdfe_checks set used_at=clock_timestamp()
        where order_id=o.id and access_key=mdfe_key;
    end if;
    update private.representative_kit_fulfillment set shipment_status='dispatched',shipment_rank=4 where order_id=o.id;
  elsif p_action='cancel_before_dispatch' and o.state='awaiting_receipt' and o.cancellation_requested_at is null
    and f.shipment_rank<4 and f.bling_invoice_id is not null then
    update private.representative_kit_orders set cancellation_requested_at=clock_timestamp() where id=o.id;
    update private.representative_kit_fulfillment set shipment_status='delayed',shipment_rank=5,checked_at=null where order_id=o.id;
  elsif p_action='delivery_failed' and o.state='paid' and o.collection_route_id is null
    and f.shipment_status='dispatched' and o.cancellation_requested_at is null then
    update private.representative_kit_fulfillment set shipment_status='delayed',shipment_rank=5 where order_id=o.id;
  elsif p_action='delivery_failed' and o.state='awaiting_receipt' and f.shipment_status='dispatched'
    and not exists (select 1 from private.representative_kit_collection_payments p where p.order_id=o.id
      and (p.point_status is null or p.point_status not in ('failed','expired','canceled') or p.confirmed_at is not null)) then
    -- Circulated goods require a verified fiscal return before stock or finance can change.
    update private.representative_kit_fulfillment set shipment_status='delayed',shipment_rank=5,checked_at=null where order_id=o.id;
  elsif p_action='returned_unpaid' and o.state='awaiting_receipt' and o.cancellation_requested_at is not null
    and f.shipment_status='delayed' and f.invoice_cancellation_confirmed_at is not null
    and not exists (select 1 from private.representative_kit_collection_payments p where p.order_id=o.id
      and (p.point_status is null or p.point_status not in ('failed','expired','canceled') or p.confirmed_at is not null)) then
    perform private.transfer_representative_kit_inventory(o,o.quantity,'release',null,null,null,null);
    update private.representative_kit_orders set state='cancelled',stock_state='released' where id=o.id;
    update private.representative_kit_fulfillment set shipment_status='returned',shipment_rank=8 where order_id=o.id;
  else
    return null;
  end if;
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
    values(auth.uid(),private.current_app_role(),'representative.kit.collection.'||p_action,'representative_kit_order',o.id,
      jsonb_build_object('evidence',btrim(p_evidence)));
  return jsonb_build_object('ok',true);
end;
$$;

create or replace function public.manage_representative_kit_return(p_return uuid,p_action text,p_details jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  r private.representative_kit_returns;
  o private.representative_kit_orders;
  result jsonb;
  pickup_date date;
  evidence text;
  staff_id uuid := auth.uid();
  own_delivery boolean;
begin
  perform private.require_permission(case
    when p_action in ('receive','schedule_pickup','confirm_pickup') then 'returns.inspect'
    when p_action in ('prepare_refund','refund') then 'returns.refund'
    else 'returns.approve' end);
  select order_id into r.order_id from private.representative_kit_returns where id=p_return;
  if not found then return null; end if;
  select * into o from private.representative_kit_orders where id=r.order_id for update;
  select * into r from private.representative_kit_returns where id=p_return for update;
  if not found or staff_id is null or staff_id=o.actor_id then return null; end if;
  own_delivery := private.representative_kit_is_own_delivery(o);

  if p_action='schedule_pickup' then
    if not own_delivery or r.state<>'approved' or r.picked_up_at is not null
      or coalesce(p_details->>'pickupDate','') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' then return null; end if;
    pickup_date := (p_details->>'pickupDate')::date;
    if pickup_date < (statement_timestamp() at time zone 'America/Sao_Paulo')::date then return null; end if;
    update private.representative_kit_returns set pickup_on=pickup_date where id=p_return returning * into r;
  elsif p_action='confirm_pickup' then
    evidence := btrim(coalesce(p_details->>'pickupReference',''));
    if not own_delivery or r.state<>'approved' or r.pickup_on is null
      or length(evidence) not between 10 and 200 then return null; end if;
    if r.picked_up_at is not null then return private.representative_kit_return_summary(r); end if;
    update private.representative_kit_returns set picked_up_at=clock_timestamp(),
      picked_up_by=staff_id,pickup_reference=evidence where id=p_return returning * into r;
  elsif own_delivery and p_action='receive' and r.picked_up_at is null then
    return null;
  elsif p_action='prepare_refund' then
    if r.state<>'verified' or o.collection_method is not distinct from 'cash'
      or r.refund_cents is null or r.invoice_protocol is null or r.invoice_sha256 is null then return null; end if;
    if r.refund_prepared_by is not null then
      return case when r.refund_prepared_by=staff_id then private.representative_kit_return_summary(r) end;
    end if;
    update private.representative_kit_returns set refund_prepared_by=staff_id where id=p_return returning * into r;
  elsif p_action='refund' and o.collection_method is distinct from 'cash' then
    if r.state='refund_pending' and r.refund_confirmed_by=staff_id then return private.representative_kit_return_summary(r); end if;
    if r.refund_prepared_by is null or r.refund_prepared_by=staff_id or r.state<>'verified' then return null; end if;
    result := private.manage_representative_kit_return(p_return,p_action,p_details);
    if result is null then return null; end if;
    update private.representative_kit_returns set refund_confirmed_by=staff_id where id=p_return returning * into r;
  else
    return private.manage_representative_kit_return(p_return,p_action,p_details);
  end if;
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
    values(staff_id,private.current_app_role(),'representative.kit.return.'||p_action,'representative_kit_return',r.id,
      jsonb_build_object('orderId',r.order_id,'pickupOn',r.pickup_on,'refundInCents',r.refund_cents));
  return private.representative_kit_return_summary(r);
end;
$$;

create or replace function public.list_representative_kit_return_work()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_permission('returns.read');
  return (select coalesce(jsonb_agg(pending.summary),'[]'::jsonb) from (
    select private.representative_kit_return_summary(r) || jsonb_build_object('reason',r.reason,'sku',o.sku,
      'productName',o.product_name,'originalInvoiceKey',f.invoice_access_key,'refundInCents',r.refund_cents,
      'invoiceKey',r.invoice_key,'collectionMethod',o.collection_method,
      'ownDelivery',private.representative_kit_is_own_delivery(o),
      'deliveryAddress',o.shipping_snapshot -> 'deliveryAddress',
      'canConfirmRefund',r.refund_prepared_by is not null and r.refund_prepared_by <> auth.uid()) as summary
    from private.representative_kit_returns r join private.representative_kit_orders o on o.id=r.order_id
    join private.representative_kit_fulfillment f on f.order_id=o.id
    order by r.created_at desc, r.id limit 50
  ) pending);
end;
$$;

create or replace function public.list_representative_kit_fiscal_work()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not (private.has_permission('orders.update_operational_status') or private.has_permission('technical.integrations.manage'))
    then raise exception 'permission_denied' using errcode='42501'; end if;
  return (select coalesce(jsonb_agg(work.summary),'[]'::jsonb) from (
    select jsonb_build_object('orderId',o.id,'state',o.state,'sku',o.sku,'quantity',o.quantity,'productName',o.product_name,
      'invoiceId',f.bling_invoice_id,'saleId',f.bling_sale_id,'draftHash',f.invoice_draft_hash,
      'draftApproved',f.reviewed_draft_hash is not null and f.reviewed_draft_hash=f.invoice_draft_hash,
      'invoiceAuthorized',f.invoice_confirmed_at is not null,'shipmentStatus',f.shipment_status,
      'cancellationRequested',o.cancellation_requested_at is not null,'collectionMethod',o.collection_method,
      'ownDelivery',private.representative_kit_is_own_delivery(o)) as summary
    from private.representative_kit_orders o join private.representative_kit_fulfillment f on f.order_id=o.id
    order by o.created_at desc,o.id limit 50
  ) work);
end;
$$;

create or replace function public.read_representative_kit_dispatch(p_order uuid, p_invoice_key text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('shipmentId',f.shipment_id, 'serviceId',o.shipping_snapshot ->> 'serviceId',
    'originPostalCode',o.shipping_snapshot ->> 'originPostalCode',
    'costInCents',o.shipping_snapshot -> 'costInCents', 'packages',o.shipping_snapshot -> 'packages',
    'address',jsonb_build_object('state',a.state,'street',a.street,'number',a.number,'district',a.district,
      'city',a.city,'complement',a.complement,'postalCode',o.shipping_snapshot -> 'address' ->> 'postalCode'),
    'buyerName',buyer.buyer_legal_name, 'buyerDocument',buyer.buyer_document,
    'buyerRegistration',buyer.buyer_state_registration,'phone',p.phone,'email',u.email,
    'sku',o.sku,'name',o.product_name,'quantity',o.quantity,'unitPriceInCents',o.unit_price_cents,
    'variantId',o.variant_id)
  from private.representative_kit_orders o
  join private.representative_kit_fulfillment f on o.id = f.order_id
  join private.representative_kit_checkout_approvals buyer on buyer.actor_id = o.actor_id and buyer.rule_version_id = o.rule_version_id
  join public.addresses a on a.id = o.address_id and a.user_id = o.actor_id
  join public.profiles p on p.id = o.actor_id join auth.users u on u.id = o.actor_id
  where o.id = p_order and f.invoice_access_key = p_invoice_key
    and f.invoice_confirmed_at > now() - interval '5 minutes'
    and o.state = 'paid' and o.stock_state = 'sold' and private.representative_kit_payment_allowed(o)
    and o.cancellation_requested_at is null
    and not private.representative_kit_is_own_delivery(o)
    and not exists (select 1 from private.representative_kit_refund_requests r where r.order_id = o.id);
$$;
;

-- 20261120131500_representative_kit_pair_returns.sql
-- A grade order keeps its sold variant and SKU snapshots. A pair return reserves
-- quantities against those snapshots and records the consumed authorized XML lines.
alter table private.representative_kit_returns
  add column requested_pairs jsonb check (jsonb_typeof(requested_pairs) = 'object'),
  add column restock_pairs jsonb check (jsonb_typeof(restock_pairs) = 'object'),
  add column fiscal_return_lines jsonb check (jsonb_typeof(fiscal_return_lines) = 'array'),
  add constraint representative_kit_pair_return_scope check (requested_pairs is null or (
    return_kind='delivered' and quantity=1 and restock_quantity=0));

create function private.representative_kit_pair_selection_valid(p_selection jsonb,p_maximum jsonb,p_allow_empty boolean)
returns boolean language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(p_selection) is distinct from 'object' then false
    else (p_allow_empty or p_selection <> '{}'::jsonb)
      and not exists (
        select 1 from jsonb_each(p_selection) as pair(sku,quantity)
        where case when jsonb_typeof(pair.quantity)='number' and pair.quantity::text ~ '^[1-9][0-9]{0,2}$'
            then not coalesce((pair.quantity::text)::integer <= (p_maximum ->> pair.sku)::integer,false)
            else true end
      )
  end;
$$;
revoke all on function private.representative_kit_pair_selection_valid(jsonb,jsonb,boolean)
  from public,anon,authenticated,service_role;

create or replace function private.representative_kit_order_summary(o private.representative_kit_orders)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('orderId',o.id,'state',o.state,'variantId',o.variant_id,
    'quantity',o.quantity,'amountInCents',o.unit_price_cents*o.quantity+o.shipping_cents,
    'shippingInCents',o.shipping_cents,'reservedUntil',o.reserved_until,
    'collectionMethod',o.collection_method,'cashTenderedInCents',o.cash_tendered_cents,'cashChangeInCents',o.cash_change_cents,
    'returnablePairOptions',case when o.grade_lines is not null and o.shipping_cents=0
      and private.representative_kit_is_own_delivery(o) and exists (
        select 1 from private.representative_kit_fulfillment f where f.order_id=o.id
          and substring(f.invoice_access_key from 23 for 3)='003'
          and f.invoice_protocol is not null and f.invoice_xml_sha256 is not null
          and f.invoice_cancellation_confirmed_at is null
      ) then (
      select jsonb_agg(jsonb_build_object('sku',line->>'sku','size',line->>'size',
        'quantity',(line->>'pairs')::integer*o.quantity))
      from jsonb_array_elements(o.grade_lines) grade(line)
    ) end);
$$;

create or replace function private.representative_kit_return_summary(r private.representative_kit_returns)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id',r.id,'orderId',r.order_id,'quantity',r.quantity,'state',r.state,
    'instructions',r.instructions,'createdAt',r.created_at,'pickupOn',r.pickup_on,
    'pickedUp',r.picked_up_at is not null,'refundPrepared',r.refund_prepared_by is not null,
    'requestedPairs',r.requested_pairs,'restockPairs',r.restock_pairs);
$$;

create function private.request_representative_kit_return(
  p_actor uuid,p_order uuid,p_quantity integer,p_reason text,p_key uuid,p_pairs jsonb
) returns jsonb language plpgsql set search_path = '' as $$
declare
  o private.representative_kit_orders;
  r private.representative_kit_returns;
  f private.representative_kit_fulfillment;
  whole_count integer;
  available_pairs jsonb;
begin
  select * into o from private.representative_kit_orders where id=p_order and actor_id=p_actor for update;
  if not found or not exists(select 1 from public.profiles where id=p_actor and status='active') then return null; end if;
  if p_quantity is null or p_quantity not between 1 and 99 or (p_pairs is not null and p_quantity<>1)
    or length(btrim(coalesce(p_reason,''))) not between 5 and 500 or p_key is null then
    raise exception 'invalid_kit_return' using errcode='22023';
  end if;
  select * into r from private.representative_kit_returns where order_id=p_order and request_key=p_key;
  if found then
    if (r.quantity,r.reason,r.requested_pairs) is distinct from (p_quantity,btrim(p_reason),p_pairs) then
      raise exception 'kit_return_idempotency_conflict' using errcode='23505';
    end if;
    return private.representative_kit_return_summary(r);
  end if;
  select * into f from private.representative_kit_fulfillment where order_id=p_order for share;
  if not found or o.state not in ('paid','manual_review') or o.stock_state<>'sold'
    or f.shipment_status not in ('delivered','returned') or f.invoice_access_key is null or f.invoice_cancellation_confirmed_at is not null
    or (p_pairs is not null and (o.grade_lines is null or o.shipping_cents<>0
      or substring(f.invoice_access_key from 23 for 3)<>'003' or f.invoice_protocol is null or f.invoice_xml_sha256 is null
      or not private.representative_kit_is_own_delivery(o))) then
    raise exception 'kit_return_unavailable' using errcode='23514';
  end if;
  select coalesce(sum(quantity),0) into whole_count from private.representative_kit_returns
    where order_id=p_order and state<>'rejected' and requested_pairs is null;
  if o.grade_lines is not null then
    select jsonb_object_agg(line->>'sku', (line->>'pairs')::integer*(o.quantity-whole_count)
      - coalesce((select sum((prior.requested_pairs->>(line->>'sku'))::integer)
        from private.representative_kit_returns prior where prior.order_id=p_order and prior.state<>'rejected'),0))
      into available_pairs from jsonb_array_elements(o.grade_lines) grade(line);
  end if;
  if (p_pairs is not null and not private.representative_kit_pair_selection_valid(p_pairs,available_pairs,false))
    or (p_pairs is null and (whole_count+p_quantity>o.quantity or exists(
      select 1 from jsonb_array_elements(o.grade_lines) grade(line)
      where (line->>'pairs')::integer*p_quantity > (available_pairs->>(line->>'sku'))::integer))) then
    raise exception 'kit_return_unavailable' using errcode='23514';
  end if;
  insert into private.representative_kit_returns(order_id,request_key,quantity,reason,requested_pairs)
    values(p_order,p_key,p_quantity,btrim(p_reason),p_pairs) returning * into r;
  return private.representative_kit_return_summary(r);
end;
$$;
revoke all on function private.request_representative_kit_return(uuid,uuid,integer,text,uuid,jsonb)
  from public,anon,authenticated,service_role;

create or replace function public.request_representative_kit_return(p_actor uuid,p_order uuid,p_quantity integer,p_reason text,p_key uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select private.request_representative_kit_return(p_actor,p_order,p_quantity,p_reason,p_key,null);
$$;

create function public.request_representative_kit_pair_return(p_actor uuid,p_order uuid,p_pairs jsonb,p_reason text,p_key uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select private.request_representative_kit_return(p_actor,p_order,1,p_reason,p_key,coalesce(p_pairs,'null'::jsonb));
$$;
revoke all on function public.request_representative_kit_pair_return(uuid,uuid,jsonb,text,uuid)
  from public,anon,authenticated;
grant execute on function public.request_representative_kit_pair_return(uuid,uuid,jsonb,text,uuid) to service_role;

create function public.record_representative_kit_return_invoice_lines(
  p_return uuid,p_key text,p_protocol text,p_hash text,p_lines jsonb
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  o private.representative_kit_orders;
  r private.representative_kit_returns;
  item record;
  sku_quantities jsonb;
  consumed bigint;
begin
  if jsonb_typeof(p_lines) is distinct from 'array' then return false; end if;
  if jsonb_array_length(p_lines) not between 1 and 990 then return false; end if;
  if exists (
    select 1 from jsonb_array_elements(p_lines) as fiscal(line)
    where jsonb_typeof(line) is distinct from 'object'
      or length(coalesce(line->>'signature','')) not between 2 and 240
      or length(coalesce(line->>'sku','')) not between 1 and 60
      or coalesce(line->>'quantity','') !~ '^[1-9][0-9]{0,8}$'
      or coalesce(line->>'saleQuantity','') !~ '^[1-9][0-9]{0,8}$'
  ) or exists (
    select 1 from jsonb_array_elements(p_lines) as fiscal(line)
    group by line->>'signature' having count(*)>1
  ) then return false; end if;

  select order_id into r.order_id from private.representative_kit_returns where id=p_return;
  if not found then return false; end if;
  select * into o from private.representative_kit_orders where id=r.order_id for update;
  select * into r from private.representative_kit_returns where id=p_return for update;
  if not found or r.invoice_key is distinct from p_key then return false; end if;
  if r.state<>'received' then
    return r.invoice_protocol is not distinct from p_protocol and r.invoice_sha256 is not distinct from p_hash
      and (r.fiscal_return_lines is null or r.fiscal_return_lines=p_lines);
  end if;
  if r.requested_pairs is not null then
    select jsonb_object_agg(sku,quantity) into sku_quantities from (
      select line->>'sku' as sku, sum((line->>'quantity')::bigint) as quantity
      from jsonb_array_elements(p_lines) as fiscal(line) group by line->>'sku'
    ) totals;
    if sku_quantities is distinct from r.requested_pairs or r.restock_pairs is null then return false; end if;
  end if;

  -- Historical whole-kit documents used the exact proportional quantity of
  -- each XML line. New proofs record the actual count per SKU and fiscal price.
  for item in
    select line->>'signature' as signature,
      (line->>'quantity')::bigint as quantity,(line->>'saleQuantity')::bigint as sold
    from jsonb_array_elements(p_lines) as fiscal(line)
  loop
    select coalesce(sum(
      case when prior.fiscal_return_lines is null then item.sold*prior.quantity/o.quantity
        else coalesce((select (prev->>'quantity')::bigint from jsonb_array_elements(prior.fiscal_return_lines) as old(prev)
          where prev->>'signature'=item.signature),0)
      end),0)
      into consumed
      from private.representative_kit_returns prior
      where prior.order_id=o.id and prior.id<>r.id and prior.invoice_protocol is not null
        and prior.state in ('verified','refund_pending','completed');
    if item.quantity + consumed > item.sold then return false; end if;
  end loop;
  update private.representative_kit_returns set fiscal_return_lines=p_lines where id=p_return;
  if not public.record_representative_kit_return_invoice(p_return,p_key,p_protocol,p_hash) then
    raise exception 'kit_return_verification_required' using errcode='23514';
  end if;
  return true;
end;
$$;
revoke all on function public.record_representative_kit_return_invoice_lines(uuid,text,text,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.record_representative_kit_return_invoice_lines(uuid,text,text,text,jsonb) to service_role;

create or replace function public.manage_representative_kit_return(p_return uuid,p_action text,p_details jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  r private.representative_kit_returns;
  o private.representative_kit_orders;
  result jsonb;
  pickup_date date;
  evidence text;
  staff_id uuid := auth.uid();
  own_delivery boolean;
begin
  perform private.require_permission(case
    when p_action in ('receive','schedule_pickup','confirm_pickup') then 'returns.inspect'
    when p_action in ('prepare_refund','refund') then 'returns.refund'
    else 'returns.approve' end);
  select order_id into r.order_id from private.representative_kit_returns where id=p_return;
  if not found then return null; end if;
  select * into o from private.representative_kit_orders where id=r.order_id for update;
  select * into r from private.representative_kit_returns where id=p_return for update;
  if not found or staff_id is null or staff_id=o.actor_id then return null; end if;
  own_delivery := private.representative_kit_is_own_delivery(o);

  if p_action='schedule_pickup' then
    if not own_delivery or r.state<>'approved' or r.picked_up_at is not null
      or coalesce(p_details->>'pickupDate','') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' then return null; end if;
    pickup_date := (p_details->>'pickupDate')::date;
    if pickup_date < (statement_timestamp() at time zone 'America/Sao_Paulo')::date then return null; end if;
    update private.representative_kit_returns set pickup_on=pickup_date where id=p_return returning * into r;
  elsif p_action='confirm_pickup' then
    evidence := btrim(coalesce(p_details->>'pickupReference',''));
    if not own_delivery or r.state<>'approved' or r.pickup_on is null
      or length(evidence) not between 10 and 200 then return null; end if;
    if r.picked_up_at is not null then return private.representative_kit_return_summary(r); end if;
    update private.representative_kit_returns set picked_up_at=clock_timestamp(),
      picked_up_by=staff_id,pickup_reference=evidence where id=p_return returning * into r;
  elsif own_delivery and p_action='receive' and r.picked_up_at is null then
    return null;
  elsif p_action='receive' and r.requested_pairs is null and (p_details ? 'restockPairs') then
    return null;
  elsif p_action='receive' and r.requested_pairs is not null then
    if not private.representative_kit_pair_selection_valid(p_details->'restockPairs',r.requested_pairs,true)
      or p_details->>'restockQuantity' is distinct from '0' then return null; end if;
    result := private.manage_representative_kit_return(p_return,p_action,p_details);
    if result is null then return null; end if;
    update private.representative_kit_returns set restock_pairs=p_details->'restockPairs'
      where id=p_return returning * into r;
  elsif p_action='prepare_refund' then
    if r.state<>'verified' or o.collection_method is not distinct from 'cash'
      or r.refund_cents is null or r.invoice_protocol is null or r.invoice_sha256 is null then return null; end if;
    if r.refund_prepared_by is not null then
      return case when r.refund_prepared_by=staff_id then private.representative_kit_return_summary(r) end;
    end if;
    update private.representative_kit_returns set refund_prepared_by=staff_id where id=p_return returning * into r;
  elsif p_action='refund' and o.collection_method is distinct from 'cash' then
    if r.state='refund_pending' and r.refund_confirmed_by=staff_id then return private.representative_kit_return_summary(r); end if;
    if r.refund_prepared_by is null or r.refund_prepared_by=staff_id or r.state<>'verified' then return null; end if;
    result := private.manage_representative_kit_return(p_return,p_action,p_details);
    if result is null then return null; end if;
    update private.representative_kit_returns set refund_confirmed_by=staff_id where id=p_return returning * into r;
  else
    return private.manage_representative_kit_return(p_return,p_action,p_details);
  end if;
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
    values(staff_id,private.current_app_role(),'representative.kit.return.'||p_action,'representative_kit_return',r.id,
      jsonb_build_object('orderId',r.order_id,'pickupOn',r.pickup_on,'refundInCents',r.refund_cents));
  return private.representative_kit_return_summary(r);
end;
$$;

create or replace function public.due_representative_kit_return_invoices()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(due)),'[]'::jsonb) from (
    select r.id as "returnId",r.quantity as "returnQuantity",r.requested_pairs as "requestedPairs",r.document_origin as "documentOrigin",
      r.bling_invoice_id as "invoiceId",r.invoice_key as "invoiceKey",coalesce(r.refund_cents,o.unit_price_cents*o.quantity+o.shipping_cents) as "fiscalTotalInCents",
      o.quantity as "originalQuantity",o.buyer_snapshot ->> 'document' as "buyerDocument",
      rule.fiscal_parameters ->> 'issuerDocument' as "issuerDocument",
      rule.fiscal_parameters -> 'returnRules' -> case when r.return_kind='undelivered' then 'undelivered_return' else r.document_origin end as "returnRule",
      f.invoice_access_key as "originalKey",f.invoice_xml_sha256 as "originalHash",f.bling_invoice_id as "originalInvoiceId"
    from private.representative_kit_returns r join private.representative_kit_orders o on o.id=r.order_id
    join private.representative_kit_fulfillment f on f.order_id=o.id
    join private.representative_resale_fiscal_rule_versions rule on rule.id=o.rule_version_id
    where r.state='received' and f.invoice_cancellation_confirmed_at is null
      and (r.checked_at is null or r.checked_at<now()-interval '15 minutes')
    order by r.checked_at nulls first,r.id limit 3
  ) due;
$$;

create or replace function public.record_representative_kit_return_invoice(p_return uuid,p_key text,p_protocol text,p_hash text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  r private.representative_kit_returns;
  o private.representative_kit_orders;
  f private.representative_kit_fulfillment;
begin
  if coalesce(p_protocol,'') !~ '^[0-9]{15}$' or coalesce(p_hash,'') !~ '^[0-9a-f]{64}$' then return false; end if;
  select order_id into r.order_id from private.representative_kit_returns where id=p_return;
  if not found then return false; end if;
  select * into o from private.representative_kit_orders where id=r.order_id for update;
  select * into r from private.representative_kit_returns where id=p_return for update;
  if not found or r.invoice_key is distinct from p_key then return false; end if;
  if r.state<>'received' then return r.invoice_protocol is not distinct from p_protocol
    and r.invoice_sha256 is not distinct from p_hash; end if;

  if r.fiscal_return_lines is null and exists (
    select 1 from private.representative_kit_returns pending where pending.order_id=o.id
      and pending.requested_pairs is not null and pending.state<>'rejected'
  ) then return false; end if;

  if r.return_kind='undelivered' then
    select * into f from private.representative_kit_fulfillment where order_id=o.id for update;
    if not found or f.shipment_status is distinct from 'delayed' or f.invoice_cancellation_confirmed_at is not null
      or o.cancellation_requested_at is not null or r.inspected_by is null or r.quantity<>o.quantity then return false; end if;
    if o.state='awaiting_receipt' and o.stock_state='reserved' and r.refund_cents is null and r.restock_quantity=o.quantity
      and not exists (select 1 from private.representative_kit_collection_payments p where p.order_id=o.id
        and (p.confirmed_at is not null or p.point_status is null or p.point_status not in ('failed','expired','canceled'))) then
      perform private.transfer_representative_kit_inventory(o,o.quantity,'release',null,null,null,null);
      update private.representative_kit_orders set state='cancelled',stock_state='released',returned_kit_count=o.quantity where id=o.id;
      r.state:='completed';
    elsif o.state='paid' and o.stock_state='sold' and r.refund_cents is not null then
      r.state:='verified';
    else return false;
    end if;
    update private.representative_kit_fulfillment set shipment_status='returned',shipment_rank=8 where order_id=o.id;
  else
    r.state:='verified';
  end if;
  update private.representative_kit_returns set state=r.state,invoice_protocol=p_protocol,invoice_sha256=p_hash,checked_at=clock_timestamp()
    where id=p_return;
  return found;
end;
$$;

create or replace function private.finalize_representative_kit_return()
returns trigger language plpgsql set search_path = '' as $$
declare
  r private.representative_kit_returns;
  o private.representative_kit_orders;
  stock_order private.representative_kit_orders;
begin
  if new.reason <> 'accepted_return' then return new; end if;
  if tg_when='BEFORE' then
    if old.started_at is null and new.started_at is not null and not exists(
      select 1 from private.representative_kit_returns q where q.id=new.kit_return_id and q.order_id=new.order_id
        and q.state='refund_pending' and q.invoice_key=new.return_invoice_key and q.refund_cents=new.amount_cents
        and q.invoice_protocol is not null and q.invoice_sha256 is not null
    ) then raise exception 'kit_return_verification_required' using errcode='23514'; end if;
    return new;
  end if;
  if old.provider_refund_id is not null or new.provider_refund_id is null then return new; end if;
  select * into o from private.representative_kit_orders where id=new.order_id for update;
  select * into r from private.representative_kit_returns where id=new.kit_return_id for update;
  if not found or r.state<>'refund_pending' or r.order_id<>o.id or (r.requested_pairs is null and o.returned_kit_count+r.quantity>o.quantity)
    then raise exception 'kit_return_stock_mismatch' using errcode='23514'; end if;
  if r.requested_pairs is not null then
    if r.restock_pairs is null or r.fiscal_return_lines is null or o.grade_lines is null
      then raise exception 'kit_return_stock_mismatch' using errcode='23514'; end if;
    stock_order := o;
    select jsonb_agg(line || jsonb_build_object('pairs',(r.restock_pairs->>(line->>'sku'))::integer))
      into stock_order.grade_lines
      from jsonb_array_elements(o.grade_lines) as grade(line) where r.restock_pairs ? (line->>'sku');
    if stock_order.grade_lines is not null then
      perform private.transfer_representative_kit_inventory(stock_order,1,'restock',
        'Devolução inspecionada de pares de revenda MG','representative_kit_return',r.id,r.inspected_by);
    end if;
  else
    update private.representative_kit_orders set returned_kit_count=returned_kit_count+r.quantity,
      stock_state=case when returned_kit_count+r.quantity=quantity then 'released' else stock_state end where id=o.id;
    if r.restock_quantity>0 then
      perform private.transfer_representative_kit_inventory(o,r.restock_quantity,'restock',
        'Devolução inspecionada de kit de revenda MG','representative_kit_return',r.id,r.inspected_by);
    end if;
  end if;
  update private.representative_kit_returns set state='completed' where id=r.id;
  if o.grade_lines is not null and not exists (
    select 1 from jsonb_array_elements(o.grade_lines) as grade(line)
    where (line->>'pairs')::integer*o.quantity <> (
      select coalesce(sum(case when completed.requested_pairs is null then (line->>'pairs')::integer*completed.quantity
        else coalesce((completed.requested_pairs->>(line->>'sku'))::integer,0) end),0)
      from private.representative_kit_returns completed where completed.order_id=o.id and completed.state='completed'
    )
  ) then update private.representative_kit_orders set stock_state='released' where id=o.id; end if;
  return new;
end;
$$;
;

-- 20261120133000_representative_kit_address_cash.sql
-- A cash order offered through the address-only checkout uses the approved
-- cash method and an operational delivery date, recorded before billing.
alter table private.representative_kit_shipping_checkout_quotes
  add column address_cash_bling_method bigint check (
    address_cash_bling_method is null or (address_only_delivery and address_cash_bling_method between 1 and 999999999999999));

alter table private.representative_kit_orders
  add column collection_due_on date check (
    collection_due_on is null or (collection_method is not distinct from 'cash' and collection_route_id is null)),
  drop constraint representative_kit_order_collection_complete,
  add constraint representative_kit_order_collection_complete check (
    (num_nonnulls(collection_route_id,collection_method,collection_bling_method)=0 and collection_point_terminal is null
      or num_nonnulls(collection_route_id,collection_method,collection_bling_method)=3
        and (collection_method='cash' or collection_point_terminal is not null)
      or collection_route_id is null and collection_method is not distinct from 'cash'
        and collection_bling_method is not null and collection_point_terminal is null
        and shipping_snapshot->>'provider' is not distinct from 'own_delivery' and shipping_cents=0)
    and ((collection_method is not distinct from 'cash') = (cash_tendered_cents is not null))
    and (cash_tendered_cents is null or cash_tendered_cents>=unit_price_cents*quantity+shipping_cents)
    and (state<>'awaiting_receipt' or collection_method is not null));

create function private.representative_kit_direct_cash_method(p_actor uuid,p_origin text,p_rule uuid)
returns bigint language sql stable set search_path = '' as $$
  select min(cash->>'blingPaymentMethodId')::bigint
  from private.representative_kit_checkout_approvals a
  join private.representative_resale_fiscal_rule_versions v on v.id=a.rule_version_id
  cross join lateral (select v.fiscal_parameters->'cashAtDelivery' as cash) config
  where a.actor_id=p_actor and a.origin_postal_code=p_origin
    and v.id=p_rule
    and private.representative_kit_commercial_configuration(a.actor_id,v.id)
    and cash->>'blingPaymentMethodId' ~ '^[1-9][0-9]{0,14}$'
    and length(btrim(cash->>'homologationEvidence'))>=10
  having count(distinct cash->>'blingPaymentMethodId')=1;
$$;
revoke all on function private.representative_kit_direct_cash_method(uuid,text,uuid)
  from public,anon,authenticated,service_role;

create function public.schedule_representative_kit_cash_delivery(p_order uuid,p_day date)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  o private.representative_kit_orders;
  f private.representative_kit_fulfillment;
  operator uuid := auth.uid();
begin
  if operator is null or not private.has_permission('orders.update_operational_status') then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  if p_day is null or not isfinite(p_day) or p_day < (statement_timestamp() at time zone 'America/Sao_Paulo')::date then return false; end if;
  select * into o from private.representative_kit_orders where id=p_order for update;
  if not found or o.actor_id=operator or o.state<>'awaiting_receipt' or o.stock_state<>'reserved'
    or o.collection_method is distinct from 'cash' or o.collection_route_id is not null
    or o.cancellation_requested_at is not null then return false; end if;
  select * into f from private.representative_kit_fulfillment where order_id=p_order for update;
  if not found then return false; end if;
  if o.collection_due_on=p_day then return true; end if;
  if f.bling_sale_id is not null or f.bling_invoice_id is not null or coalesce(f.shipment_rank,0)>=4
    or exists(select 1 from private.representative_kit_fulfillment_writes where order_id=o.id) then return false; end if;
  update private.representative_kit_orders set collection_due_on=p_day where id=o.id;
  update private.representative_kit_fulfillment set checked_at=null where order_id=o.id;
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
    values(operator,private.current_app_role(),'representative.kit.collection.scheduled','representative_kit_order',o.id,
      jsonb_build_object('from',o.collection_due_on,'deliveryOn',p_day));
  return true;
end;
$$;
revoke all on function public.schedule_representative_kit_cash_delivery(uuid,date) from public,anon,service_role;
grant execute on function public.schedule_representative_kit_cash_delivery(uuid,date) to authenticated;

create function public.claim_representative_kit_bling_write_for_delivery(
  p_order uuid,p_operation text,p_expected_hash text,p_collection_due_on date
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  current_day date;
begin
  select collection_due_on into current_day from private.representative_kit_orders where id=p_order for update;
  if not found or current_day is distinct from p_collection_due_on then return false; end if;
  return public.claim_representative_kit_bling_write(p_order,p_operation,p_expected_hash);
end;
$$;
revoke all on function public.claim_representative_kit_bling_write_for_delivery(uuid,text,text,date)
  from public,anon,authenticated;
grant execute on function public.claim_representative_kit_bling_write_for_delivery(uuid,text,text,date) to service_role;

create or replace function public.reserve_representative_kit_own_collection(
  p_actor uuid,p_selection uuid,p_template text,p_quantity integer,p_quote uuid,p_address uuid,
  p_key uuid,p_origin text,p_method text,p_cash_tendered bigint
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  q private.representative_kit_shipping_checkout_quotes;
  o private.representative_kit_orders;
  reserved jsonb;
begin
  select * into q from private.representative_kit_shipping_checkout_quotes
    where id=p_quote and actor_id=p_actor
      and (address_cash_bling_method is not null or (own_delivery_route_id is not null and collection_route_id is not null));
  if not found or (p_origin is not null and p_origin<>q.origin_postal_code)
    then raise exception 'kit_quote_unavailable' using errcode='23514'; end if;
  if q.address_cash_bling_method is null then
    return public.reserve_representative_kit_collection_order(p_actor,p_selection,p_template,p_quantity,p_quote,
      p_address,p_key,q.origin_postal_code,p_method,p_cash_tendered);
  end if;
  if p_actor is null or p_key is null or p_method is distinct from 'cash'
    or p_cash_tendered is null or p_cash_tendered not between 1 and 9007199254740991 then
    raise exception 'invalid_kit_collection' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('representative-kit:'||p_actor::text||':'||p_key::text,0));
  select * into o from private.representative_kit_orders where actor_id=p_actor and idempotency_key=p_key;
  if found then
    if (coalesce(o.grade_kit_id,o.variant_id),o.grade_template,o.quantity,o.quote_id,o.address_id,o.collection_method,o.cash_tendered_cents)
      is distinct from (p_selection,p_template,p_quantity,p_quote,p_address,p_method,p_cash_tendered) then
      raise exception 'kit_idempotency_conflict' using errcode='23505';
    end if;
    return private.representative_kit_order_summary(o);
  end if;

  if p_template is null then
    reserved:=private.reserve_representative_kit_order(p_actor,p_selection,p_quantity,p_quote,p_address,p_key,q.origin_postal_code);
  else
    reserved:=private.reserve_representative_kit_grade_order(p_actor,p_selection,p_template,p_quantity,p_quote,p_address,p_key,q.origin_postal_code);
  end if;
  select * into strict o from private.representative_kit_orders where id=(reserved->>'orderId')::uuid for update;
  if q.address_cash_bling_method is distinct from private.representative_kit_direct_cash_method(o.actor_id,q.origin_postal_code,o.rule_version_id)
    then raise exception 'kit_collection_unavailable' using errcode='23514'; end if;
  if p_cash_tendered<o.unit_price_cents*o.quantity+o.shipping_cents then
    raise exception 'kit_cash_tender_invalid' using errcode='23514';
  end if;
  update private.representative_kit_orders set state='awaiting_receipt',
    collection_method='cash',collection_bling_method=q.address_cash_bling_method,cash_tendered_cents=p_cash_tendered
    where id=o.id returning * into o;
  insert into private.representative_kit_fulfillment(order_id) values(o.id) on conflict do nothing;
  return private.representative_kit_order_summary(o);
end;
$$;

create or replace function public.quote_representative_kit_own_delivery(
  p_actor uuid,p_selection uuid,p_template text,p_quantity integer,p_address uuid,p_origin text,p_at_receipt boolean
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  route private.representative_kit_collection_routes;
  service_id text;
  cash_method bigint;
  cash_rule uuid;
  address_row public.addresses;
  postal text;
  grade_shipping jsonb;
  inserted jsonb;
  price bigint;
  dimensions jsonb;
  expiry timestamptz := clock_timestamp()+interval '15 minutes';
begin
  if p_at_receipt is null or p_quantity is null or p_quantity not between 1 and 99 then return null; end if;
  select * into address_row from public.addresses a where a.user_id=p_actor
    and a.id=p_address and a.state='MG' and a.country='BR' for share;
  if not found then return null; end if;
  postal:=regexp_replace(address_row.postal_code,'[^0-9]','','g');
  if postal is null or postal !~ '^3[0-9]{7}$' then return null; end if;
  if p_origin is null then
    select min(a.origin_postal_code) into p_origin
      from private.representative_kit_checkout_approvals a
      where a.actor_id=p_actor and a.revoked_at is null and a.valid_until>expiry
      having count(distinct a.origin_postal_code)=1;
  end if;
  if p_at_receipt and p_origin is not null then
    cash_rule := case when p_template is null
      then private.find_representative_kit_checkout_approval(p_actor,p_selection,p_origin)
      else private.find_representative_kit_approval_by_fingerprint(
        p_actor,public.read_representative_kit_grade_fingerprint(p_selection,p_template),p_origin)
    end;
    cash_method := private.representative_kit_direct_cash_method(p_actor,p_origin,cash_rule);
  end if;
  if p_at_receipt and cash_method is null then
    select q.* into route from private.representative_kit_collection_routes q
      where (p_origin is null or q.origin_postal_code=p_origin) and postal between q.destination_from and q.destination_through
        and q.valid_until>expiry and q.closed_at is null
        and 1=(select count(*) from private.representative_kit_collection_routes t
          where (p_origin is null or t.origin_postal_code=p_origin) and postal between t.destination_from and t.destination_through
            and t.valid_until>expiry and t.closed_at is null)
      for share;
    if not found or route.bling_method_ids='{}'::jsonb then return null; end if;
    p_origin := route.origin_postal_code;
    service_id := 'recebimento';
  else
    if p_origin is null then return null; end if;
    service_id := 'entrega_propria_endereco';
    route.name := 'Entrega própria';
    route.delivery_cents := 0;
  end if;
  if p_template is null then
    if not public.representative_kit_purchase_available(p_actor,p_selection,p_origin) then return null; end if;
    select inputs.price_cents,inputs.dimensions into price,dimensions
      from private.representative_kit_shipping_inputs(p_selection) inputs
      join private.bling_catalog_metadata m on m.product_id=(select product_id from public.product_variants where id=p_selection)
      join public.inventory i on i.variant_id=p_selection
      where m.pairs_per_sku>1 and i.available_quantity>=p_quantity;
    if not found or price<=0 then return null; end if;
    inserted:=public.confirm_representative_kit_shipping_quote(
      p_actor,p_selection,p_quantity,p_address,postal,repeat('0',64),service_id,route.name,route.name,
      route.delivery_cents,route.delivery_cents,route.estimated_days,'[]'::jsonb,expiry,p_origin,price,dimensions);
  else
    grade_shipping:=public.read_representative_kit_grade_shipping(p_actor,p_selection,p_template,p_quantity,p_address,p_origin);
    if grade_shipping -> 'purchaseAvailable' is distinct from 'true'::jsonb then return null; end if;
    price:=(grade_shipping ->> 'priceCents')::bigint;
    inserted:=public.confirm_representative_kit_grade_shipping(
      p_actor,p_selection,p_template,p_quantity,p_address,p_origin,grade_shipping ->> 'catalogHash',
      address_row.updated_at,repeat('0',64),service_id,route.name,route.name,route.delivery_cents,
      route.delivery_cents,route.estimated_days,'[]'::jsonb,expiry);
  end if;
  if inserted ->> 'id' is null then return null; end if;
  update private.representative_kit_shipping_checkout_quotes set address_only_delivery=route.id is null,
    address_cash_bling_method=cash_method,own_delivery_route_id=route.id,
    collection_route_id=case when p_at_receipt then route.id end
    where id=(inserted ->> 'id')::uuid;
  return jsonb_build_object('id',inserted -> 'id','shippingInCents',route.delivery_cents,
    'amountInCents',price*p_quantity+route.delivery_cents,'estimatedDays',route.estimated_days,'service',route.name,
    'collectionMethods',case when cash_method is not null then '["cash"]'::jsonb else (select coalesce(jsonb_agg(m.name order by m.name),'[]'::jsonb)
      from jsonb_object_keys(route.bling_method_ids) m(name) where p_at_receipt) end);
end;
$$;

create or replace function public.reserve_representative_kit_own_delivery(
  p_actor uuid,p_selection uuid,p_template text,p_quantity integer,p_quote uuid,p_address uuid,p_key uuid,p_origin text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  origin text;
begin
  select q.origin_postal_code into origin from private.representative_kit_shipping_checkout_quotes q
    where q.id=p_quote and q.actor_id=p_actor and (q.address_only_delivery or q.own_delivery_route_id is not null)
      and q.collection_route_id is null and q.address_cash_bling_method is null;
  if not found or (p_origin is not null and p_origin <> origin)
    then raise exception 'kit_quote_unavailable' using errcode='23514'; end if;
  if p_template is null then
    return public.reserve_representative_kit_order(p_actor,p_selection,p_quantity,p_quote,p_address,p_key,origin);
  end if;
  return public.reserve_representative_kit_grade_order(p_actor,p_selection,p_template,p_quantity,p_quote,p_address,p_key,origin);
end;
$$;

create or replace function public.reserve_representative_kit_order(
  p_actor uuid,p_variant uuid,p_quantity integer,p_quote uuid,p_address uuid,p_key uuid,p_origin_postal_code text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from private.representative_kit_shipping_checkout_quotes
    where id=p_quote and (collection_route_id is not null or address_cash_bling_method is not null))
    or exists(select 1 from private.representative_kit_orders
      where actor_id=p_actor and idempotency_key=p_key and collection_method is not null) then
    raise exception 'kit_collection_selection_required' using errcode='23514';
  end if;
  return private.reserve_representative_kit_order(p_actor,p_variant,p_quantity,p_quote,p_address,p_key,p_origin_postal_code);
end;
$$;

create or replace function public.reserve_representative_kit_grade_order(
  p_actor uuid,p_kit uuid,p_template text,p_quantity integer,p_quote uuid,p_address uuid,p_key uuid,p_origin text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from private.representative_kit_shipping_checkout_quotes
    where id=p_quote and (collection_route_id is not null or address_cash_bling_method is not null))
    or exists(select 1 from private.representative_kit_orders
      where actor_id=p_actor and idempotency_key=p_key and collection_method is not null) then
    raise exception 'kit_collection_selection_required' using errcode='23514';
  end if;
  return private.reserve_representative_kit_grade_order(p_actor,p_kit,p_template,p_quantity,p_quote,p_address,p_key,p_origin);
end;
$$;

create or replace function private.representative_kit_fiscal_ready(o private.representative_kit_orders)
returns boolean language sql stable set search_path = ''
as $$
  select (o.state='paid' and o.stock_state='sold'
      or o.state='awaiting_receipt' and o.stock_state='reserved' and (o.collection_route_id is not null
        or o.collection_method='cash' and o.collection_due_on is not null
          and o.collection_bling_method=private.representative_kit_direct_cash_method(
            o.actor_id,o.shipping_snapshot->>'originPostalCode',o.rule_version_id)
          and (
          o.collection_due_on >= (statement_timestamp() at time zone 'America/Sao_Paulo')::date
          or exists(select 1 from private.representative_kit_fulfillment f where f.order_id=o.id and f.bling_invoice_id is not null)
        )))
    and private.representative_kit_payment_allowed(o);
$$;

create or replace function private.can_cancel_unshipped_kit_collection(o private.representative_kit_orders)
returns boolean language sql stable set search_path = ''
as $$
  select o.state='awaiting_receipt' and o.stock_state='reserved' and o.collection_method is not null
    and not exists (select 1 from private.representative_kit_fulfillment f where f.order_id=o.id
      and (f.bling_sale_id is not null or f.bling_invoice_id is not null or f.shipment_rank>=4))
    and not exists (select 1 from private.representative_kit_fulfillment_writes w where w.order_id=o.id);
$$;

create or replace function public.due_representative_kit_fulfillment()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(due)),'[]'::jsonb) from (
    select f.order_id as "orderId", f.bling_sale_id as "saleId", f.bling_invoice_id as "invoiceId",
      f.shipment_id as "shipmentId", f.shipment_status as "shipmentStatus", o.variant_id as "variantId",
      o.sku, o.product_name as "productName", o.quantity, coalesce(o.paid_at,o.created_at) as "paidAt", o.grade_lines as "gradeLines",
      private.representative_kit_is_own_delivery(o) as "ownDelivery", o.collection_method as "collectionMethod", o.collection_bling_method as "collectionBlingMethod", o.created_at as "createdAt",
      o.shipping_snapshot ->> 'estimatedDays' as "deliveryDays", o.collection_due_on as "collectionDueOn",
      o.unit_price_cents as "unitPriceInCents", o.shipping_cents as "shippingInCents",
      o.unit_price_cents * o.quantity + o.shipping_cents as "amountInCents",
      o.shipping_snapshot ->> 'serviceId' as "serviceId",
      o.shipping_snapshot ->> 'originPostalCode' as "originPostalCode",
      o.shipping_snapshot -> 'address' ->> 'postalCode' as "postalCode",
      a.buyer_profile as "buyerProfile", a.buyer_document as "buyerDocument", a.buyer_state_registration as "buyerStateRegistration",
      r.fiscal_parameters as "fiscalParameters"
    from private.representative_kit_fulfillment f
    join private.representative_kit_orders o on o.id = f.order_id
    join private.representative_kit_checkout_approvals a on a.actor_id = o.actor_id and a.rule_version_id = o.rule_version_id
    join private.representative_resale_fiscal_rule_versions r on r.id = o.rule_version_id
    where private.representative_kit_fiscal_ready(o)
      and not exists (
        select 1 from jsonb_array_elements(o.grade_lines) item
        where private.bling_kit_source_hash((item ->> 'variantId')::uuid) is distinct from item ->> 'fiscalHash'
      )
      and coalesce(f.shipment_status,'pending') not in ('returned','cancelled','delivered')
      and (f.checked_at is null or f.checked_at < now() - interval '15 minutes')
      and not exists(select 1 from private.bling_order_links b
        where b.invoice_id = f.bling_invoice_id or b.external_order_id = f.bling_sale_id)
    order by f.checked_at nulls first, f.order_id limit 3
  ) due;
$$;

create or replace function public.list_representative_kit_collection_work()
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not private.has_permission('orders.update_operational_status') then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  return (select coalesce(jsonb_agg(rows.summary),'[]'::jsonb) from (
    select private.representative_kit_order_summary(o) || jsonb_build_object(
      'productName',o.product_name,'invoiceAuthorized',f.invoice_confirmed_at is not null,
      'undeliveredReturnRecorded',exists(select 1 from private.representative_kit_returns r
        where r.order_id=o.id and r.return_kind='undelivered' and r.state<>'rejected'),
      'mdfeRequired',private.representative_kit_requires_mdfe(o.shipping_snapshot),
      'mdfeVerified',private.representative_kit_pending_mdfe(o.id,f.invoice_access_key) is not null,
      'shipmentStatus',f.shipment_status,'pointStarted',p.point_key is not null,'pointLinked',p.point_order_id is not null,
      'deliveryAddress',o.shipping_snapshot -> 'deliveryAddress',
      'collectionDueOn',o.collection_due_on,
      'canScheduleCash',o.collection_method='cash' and o.collection_route_id is null and private.can_cancel_unshipped_kit_collection(o),
      'pointStatus',p.point_status,
      'receiptConfirmed',p.confirmed_at is not null,'cancellationRequested',o.cancellation_requested_at is not null,
      'invoiceCancelled',f.invoice_cancellation_confirmed_at is not null) as summary
    from private.representative_kit_orders o join private.representative_kit_fulfillment f on f.order_id=o.id
    left join private.representative_kit_collection_payments p on p.order_id=o.id
    where private.representative_kit_is_own_delivery(o)
    order by o.created_at desc,o.id limit 50
  ) rows);
end;
$$;

create or replace function public.prepare_representative_kit_collection_refund(p_return uuid,p_cash_evidence text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  o private.representative_kit_orders;
  r private.representative_kit_refund_requests;
  receipt private.representative_kit_collection_payments;
  confirmed_total bigint;
  baseline text[];
  refund_reference text;
begin
  perform private.require_permission('returns.refund');
  select order_id into r.order_id from private.representative_kit_refund_requests where kit_return_id=p_return;
  if not found then return null; end if;
  select * into o from private.representative_kit_orders where id=r.order_id and collection_method is not null for update;
  if not found or o.actor_id=auth.uid() or o.state not in ('paid','manual_review','refunded') then return null; end if;
  select * into r from private.representative_kit_refund_requests where kit_return_id=p_return for update;
  select * into receipt from private.representative_kit_collection_payments where order_id=o.id and confirmed_at is not null for share;
  if not found then return null; end if;
  if r.provider_refund_id is not null then return jsonb_build_object('confirmed',true); end if;
  select coalesce(sum(amount_cents),0),coalesce(array_agg(provider_refund_id order by provider_refund_id),'{}') into confirmed_total,baseline
    from private.representative_kit_provider_refunds where order_id=o.id;
  if confirmed_total+r.amount_cents>o.unit_price_cents*o.quantity+o.shipping_cents or r.reason<>'accepted_return' then return null; end if;
  if o.collection_method='cash' then
    if length(btrim(coalesce(p_cash_evidence,''))) not between 10 and 200 then return null; end if;
    refund_reference:='CASH-'||encode(sha256(convert_to(btrim(p_cash_evidence),'UTF8')),'hex');
    update private.representative_kit_refund_requests set started_at=clock_timestamp(),baseline_refund_ids=baseline where id=r.id;
    insert into private.representative_kit_provider_refunds(provider_refund_id,order_id,amount_cents)
      values(refund_reference,o.id,r.amount_cents);
    update private.representative_kit_refund_requests set provider_refund_id=refund_reference,checked_at=clock_timestamp() where id=r.id;
    if confirmed_total+r.amount_cents=o.unit_price_cents*o.quantity+o.shipping_cents then
      update private.representative_kit_orders set state='refunded' where id=o.id;
    end if;
    insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
      values(auth.uid(),private.current_app_role(),'representative.kit.cash_refund.confirmed','representative_kit_order',o.id,
        jsonb_build_object('refundId',r.id,'evidence',btrim(p_cash_evidence)));
    return jsonb_build_object('confirmed',true);
  end if;
  if p_cash_evidence is not null or receipt.point_order_id is null or receipt.point_key is null then return null; end if;
  if r.started_at is null then
    update private.representative_kit_refund_requests set started_at=clock_timestamp(),
      baseline_refund_ids=baseline where id=r.id returning * into r;
  end if;
  if baseline is distinct from r.baseline_refund_ids then return null; end if;
  return jsonb_build_object('confirmed',false,'refundId',r.id,'refundCents',r.amount_cents,'previousRefundIds',baseline,
    'pointOrderId',receipt.point_order_id,'pointKey',receipt.point_key,'receipt',receipt.receipt_reference,
    'method',o.collection_method,'terminal',o.collection_point_terminal,'amountInCents',o.unit_price_cents*o.quantity+o.shipping_cents,
    'maySend',r.started_at>clock_timestamp()-interval '20 hours');
end;
$$;

create or replace function public.confirm_representative_kit_mdfe(p_order uuid,p_key text,p_protocol text,p_evidence text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  o private.representative_kit_orders;
  f private.representative_kit_fulfillment;
  remainder integer;
begin
  if auth.uid() is null or not private.has_permission('orders.update_operational_status') then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  if coalesce(p_key,'') !~ '^31[0-9]{18}58[0-9]{22}$'
    or coalesce(p_protocol,'') !~ '^[0-9]{15}$' or p_protocol=repeat('0',15)
    or length(btrim(coalesce(p_evidence,''))) not between 10 and 200 then return false; end if;
  select sum(substr(p_key,i,1)::integer * (2+(43-i)%8)) % 11 into remainder
    from generate_series(1,43) as digits(i);
  if right(p_key,1)::integer <> (case when remainder<2 then 0 else 11-remainder end) then return false; end if;

  select * into o from private.representative_kit_orders candidate where id=p_order
    and (private.representative_kit_is_own_delivery(candidate)) for update;
  if not found or o.actor_id=auth.uid() or o.state not in ('awaiting_receipt','paid')
    or o.cancellation_requested_at is not null or not private.representative_kit_requires_mdfe(o.shipping_snapshot) then return false; end if;
  select * into f from private.representative_kit_fulfillment where order_id=p_order for update;
  if not found or f.invoice_access_key is null or f.invoice_confirmed_at is null
    or f.invoice_cancellation_confirmed_at is not null
    or substr(p_key,7,14) <> substr(f.invoice_access_key,7,14)
    or not (f.shipment_rank<4 or f.shipment_status='delayed' and o.collection_method is null) then return false; end if;

  insert into private.representative_kit_mdfe_checks as prior
    (order_id,access_key,invoice_access_key,protocol,evidence,verified_by)
    values(p_order,p_key,f.invoice_access_key,p_protocol,btrim(p_evidence),auth.uid())
  on conflict (order_id,access_key) do update set
    evidence=excluded.evidence,verified_by=excluded.verified_by,verified_at=excluded.verified_at
    where prior.used_at is null and prior.invoice_access_key=excluded.invoice_access_key and prior.protocol=excluded.protocol;
  if not found then return false; end if;
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
    values(auth.uid(),private.current_app_role(),'representative.kit.mdfe.verified','representative_kit_order',p_order,
      jsonb_build_object('manifestKeySuffix',right(p_key,8)));
  return true;
end;
$$;

create or replace function public.manage_representative_kit_collection(p_order uuid,p_action text,p_evidence text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  o private.representative_kit_orders;
  f private.representative_kit_fulfillment;
  mdfe_key text;
begin
  if auth.uid() is null or not private.has_permission('orders.update_operational_status') then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  if length(btrim(coalesce(p_evidence,''))) not between 10 and 200 then return null; end if;
  select * into o from private.representative_kit_orders candidate where id=p_order and (private.representative_kit_is_own_delivery(candidate)) for update;
  if not found or o.actor_id=auth.uid() then return null; end if;
  select * into f from private.representative_kit_fulfillment where order_id=p_order for update;
  if not found then return null; end if;
  if p_action='cash_received' and o.collection_method='cash' and (
    o.state='paid' or o.state='awaiting_receipt' and f.shipment_status in ('dispatched','delivered') and o.cancellation_requested_at is null
  ) then
    insert into private.representative_kit_collection_payments(order_id,opened_by) values(o.id,auth.uid()) on conflict do nothing;
    if not private.confirm_representative_kit_collection_receipt(o,btrim(p_evidence),auth.uid()) then return null; end if;
  elsif p_action='confirm_delivery' and f.shipment_status in ('dispatched','delivered')
    and o.state in ('awaiting_receipt','paid') and o.cancellation_requested_at is null
    and f.invoice_access_key is not null and f.invoice_cancellation_confirmed_at is null then
    if f.shipment_status='delivered' then return jsonb_build_object('ok',true); end if;
    update private.representative_kit_fulfillment set shipment_status='delivered',shipment_rank=7 where order_id=o.id;
  elsif p_action='dispatch' and o.state in ('awaiting_receipt','paid') and o.cancellation_requested_at is null
    and not exists(select 1 from private.representative_kit_returns r
      where r.order_id=o.id and r.return_kind='undelivered' and r.state<>'rejected')
    and private.representative_kit_fiscal_ready(o) and (f.shipment_rank<4 or f.shipment_status='delayed' and o.collection_method is null) and f.invoice_access_key is not null
    and f.invoice_confirmed_at>clock_timestamp()-interval '30 minutes' then
    if private.representative_kit_requires_mdfe(o.shipping_snapshot) then
      mdfe_key := private.representative_kit_pending_mdfe(o.id,f.invoice_access_key);
      if mdfe_key is null then raise exception 'kit_mdfe_required' using errcode='23514'; end if;
      update private.representative_kit_mdfe_checks set used_at=clock_timestamp()
        where order_id=o.id and access_key=mdfe_key;
    end if;
    update private.representative_kit_fulfillment set shipment_status='dispatched',shipment_rank=4 where order_id=o.id;
  elsif p_action='cancel_before_dispatch' and o.state='awaiting_receipt' and o.cancellation_requested_at is null
    and f.shipment_rank<4 and f.bling_invoice_id is not null then
    update private.representative_kit_orders set cancellation_requested_at=clock_timestamp() where id=o.id;
    update private.representative_kit_fulfillment set shipment_status='delayed',shipment_rank=5,checked_at=null where order_id=o.id;
  elsif p_action='delivery_failed' and o.state='paid' and o.collection_method is null
    and f.shipment_status='dispatched' and o.cancellation_requested_at is null then
    update private.representative_kit_fulfillment set shipment_status='delayed',shipment_rank=5 where order_id=o.id;
  elsif p_action='delivery_failed' and o.state='awaiting_receipt' and f.shipment_status='dispatched'
    and not exists (select 1 from private.representative_kit_collection_payments p where p.order_id=o.id
      and (p.point_status is null or p.point_status not in ('failed','expired','canceled') or p.confirmed_at is not null)) then
    -- Circulated goods require a verified fiscal return before stock or finance can change.
    update private.representative_kit_fulfillment set shipment_status='delayed',shipment_rank=5,checked_at=null where order_id=o.id;
  elsif p_action='returned_unpaid' and o.state='awaiting_receipt' and o.cancellation_requested_at is not null
    and f.shipment_status='delayed' and f.invoice_cancellation_confirmed_at is not null
    and not exists (select 1 from private.representative_kit_collection_payments p where p.order_id=o.id
      and (p.point_status is null or p.point_status not in ('failed','expired','canceled') or p.confirmed_at is not null)) then
    perform private.transfer_representative_kit_inventory(o,o.quantity,'release',null,null,null,null);
    update private.representative_kit_orders set state='cancelled',stock_state='released' where id=o.id;
    update private.representative_kit_fulfillment set shipment_status='returned',shipment_rank=8 where order_id=o.id;
  else
    return null;
  end if;
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
    values(auth.uid(),private.current_app_role(),'representative.kit.collection.'||p_action,'representative_kit_order',o.id,
      jsonb_build_object('evidence',btrim(p_evidence)));
  return jsonb_build_object('ok',true);
end;
$$;
;


create function pg_temp.no_plan() returns text language sql as $$select 'test suite'::text$$;
create function pg_temp.finish() returns setof text language sql as $$select ''::text where false$$;
create function pg_temp.ok(actual boolean, label text) returns text language plpgsql as $$
begin if actual is not true then raise exception 'Assertion failed: % [actual %]', label,actual; end if;
return 'ok - '||label; end $$;
create function pg_temp.is(actual anycompatible, expected anycompatible,label text) returns text language plpgsql as $$
begin if actual is distinct from expected then raise exception 'Assertion failed: % [actual % expected %]', label,actual,expected; end if;
return 'ok - '||label; end $$;
create function pg_temp.isnt(actual anycompatible, expected anycompatible,label text) returns text language plpgsql as $$
begin if actual is not distinct from expected then raise exception 'Assertion failed: % [actual % unexpected %]', label,actual,expected; end if;
return 'ok - '||label; end $$;
create function pg_temp.results_eq(actual text, expected text,label text) returns text language plpgsql as $$
declare result text[]; target text[];
begin execute 'select array_agg(r::text) from ('||actual||') as r' into result;
execute 'select array_agg(r::text) from ('||expected||') as r' into target;
return pg_temp.is(result,target,label); end $$;
create function pg_temp.throws_ok(statement text, code text, expected_message text,label text) returns text language plpgsql as $$
declare seen_code text; seen_message text;
begin
  begin execute statement;
  exception when others then get stacked diagnostics seen_code=returned_sqlstate,seen_message=message_text; end;
  if seen_code is distinct from code or (expected_message is not null and seen_message is distinct from expected_message)
    then raise exception 'Assertion failed: % [actual %: % expected %: %]',label,seen_code,seen_message,code,expected_message;
  end if;
  return 'ok - '||label;
end $$;


set local search_path = public, extensions;
select pg_temp.no_plan();

create temporary table commercial_kit_fixture as
select gen_random_uuid() actor, gen_random_uuid() outsider, gen_random_uuid() application, gen_random_uuid() representative,
  gen_random_uuid() category, gen_random_uuid() product, gen_random_uuid() variant, gen_random_uuid() address,
  null::uuid quote, null::uuid expiry_quote;
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
  select actor,'kit-shipping@example.invalid','{}'::jsonb,'{}'::jsonb from commercial_kit_fixture
  union all select outsider,'kit-shipping-outsider@example.invalid','{}'::jsonb,'{}'::jsonb from commercial_kit_fixture;
update public.profiles set status='active' where id=(select actor from commercial_kit_fixture);
insert into public.representative_applications(id,user_id) select application,actor from commercial_kit_fixture;
insert into public.representatives(id,user_id,application_id,status)
  select representative,actor,application,'approved_waiting_kit' from commercial_kit_fixture;
insert into public.categories(id,name,slug) select category,'Kit shipping test',category::text from commercial_kit_fixture;
insert into public.products(id,name,slug,category_id,status,base_price,weight_grams,width_cm,height_cm,length_cm)
  select product,'Kit shipping test',product::text,category,'draft',50,250,10,5,20 from commercial_kit_fixture;
insert into public.product_variants(id,product_id,sku,color_name,size)
  select variant,product,'TEST-SHIPPING-'||variant::text,'White','37' from commercial_kit_fixture;
insert into public.product_images(product_id,storage_path,alt_text,width,height,is_primary)
  select product,'test/kit-shipping.webp','Shipping fixture',720,720,true from commercial_kit_fixture;
update public.products set status='active' where id=(select product from commercial_kit_fixture);
insert into public.inventory(variant_id,available_quantity,reserved_quantity)
  select variant,3,0 from commercial_kit_fixture;
insert into private.bling_catalog_metadata(product_id,commercial_unit,pairs_per_sku,ncm,origin,cest,production_type,evidence_reference)
  select product,'UN',2,'64022000',0,'','T','Shipping fixture' from commercial_kit_fixture;
insert into public.addresses(id,user_id,label,recipient_name,postal_code,street,number,district,city,state)
  select address,actor,'Test','Test recipient','30110-100','Test street','1','Test district','Test city','MG' from commercial_kit_fixture;

alter table commercial_kit_fixture add column request_key uuid not null default gen_random_uuid(),
  add column rule_version uuid not null default gen_random_uuid(), add column order_id uuid,
  add column expected_payment text not null default '123';

insert into private.bling_kit_fiscal_components(
  kit_variant_id,position,sku,description,unit,quantity_pairs,allocation_weight,ncm,origin,cest,source_hash,evidence_reference
)
select f.variant,n,'SYNTHETIC-PAIR-'||n,'Fixture pair '||n,'PR',1,1,'64022000',0,'',
  private.bling_kit_source_hash(f.variant),'Synthetic fixture evidence'
from commercial_kit_fixture f cross join generate_series(1,2) n;

create function pg_temp.commercial_quote(p_origin text default '35520000', p_cents bigint default 5000)
returns uuid language sql as $$
  select (public.confirm_representative_kit_shipping_quote(actor,variant,2,address,'30110100',repeat('a',64),
    '1','PAC','Correios',2100,1800,4,'[]',now()+interval '20 minutes',p_origin,p_cents,'[250,10,5,20]')->>'id')::uuid
  from commercial_kit_fixture;
$$;

create function pg_temp.reserve_commercial_kit(p_quantity integer default 2, p_other_key boolean default false)
returns jsonb language sql as $$
  select public.reserve_representative_kit_order(actor,variant,p_quantity,quote,address,
    case when p_other_key then gen_random_uuid() else request_key end,'35520000')
  from commercial_kit_fixture;
$$;

select pg_temp.ok(not has_function_privilege('authenticated',
  'public.reserve_representative_kit_order(uuid,uuid,integer,uuid,uuid,uuid,text)','execute'),
  'signed-in clients cannot create commercial orders through SQL');
select pg_temp.ok(not has_table_privilege('service_role','private.representative_kit_orders','update'),
  'the service API cannot mutate the aggregate directly');
select pg_temp.throws_ok($$select pg_temp.commercial_quote('01310100')$$,'23514','representative_kit_origin_outside_mg',
  'origin outside MG cannot confirm freight');
select pg_temp.throws_ok($$select pg_temp.commercial_quote('35520000',1)$$,'23514','kit_shipping_inputs_changed',
  'confirmation compares live merchandise price');

update commercial_kit_fixture set quote = pg_temp.commercial_quote();
select pg_temp.throws_ok($$select pg_temp.reserve_commercial_kit()$$,'23514','resale_not_homologated',
  'order cannot reserve stock without fiscal and operational approval');
select pg_temp.is((select q.used_at from private.representative_kit_shipping_checkout_quotes q
  join commercial_kit_fixture f on f.quote = q.id),null::timestamptz,'failed order rolls back consumption');
select pg_temp.is((select i.available_quantity from public.inventory i join commercial_kit_fixture f on f.variant=i.variant_id),
  3,'failed order leaves inventory untouched');

insert into private.representative_resale_fiscal_rule_versions
  (id,rule_key,version,issuer_reference,product_fingerprint,origin_state,destination_state,person_type,
    icms_status,final_consumer,purpose,valid_from,valid_until,fiscal_parameters)
select rule_version,gen_random_uuid(),1,'synthetic issuer',public.read_representative_resale_product_fingerprint(variant),
  'MG','MG','business','taxpayer',false,'resale',now()-interval '1 day',now()+interval '1 day',
  '{"buyerProfile":"MG02","issuerDocument":"12345678000195","classification":"third_party_no_st","creditEligible":false,
    "returnRules":{"own_inflow":{"cfop":"1202","taxCodeKind":"CSOSN","taxCode":"102","homologationEvidence":"synthetic return XML"},
      "undelivered_return":{"cfop":"1202","taxCodeKind":"CSOSN","taxCode":"102","homologationEvidence":"synthetic undelivered return XML"}},
    "blingRule":{"scenario":"resale_in_state_no_credit","issuer_state":"MG","series":3,"document_model":55,"cfop":"5102",
    "csosn":"102","icms_rate":0,"pis_cst":"49","cofins_cst":"49","ipi_cst":"99","ipi_cenq":"999",
    "pis_rate":0,"cofins_rate":0,"ipi_rate":0,"natures":[{"final_consumer":false,"external_nature_id":123}]}}'
from commercial_kit_fixture;
insert into private.representative_resale_fiscal_rule_approvals(rule_version_id,approver_reference,evidence_reference)
select rule_version,'synthetic approver','synthetic evidence' from commercial_kit_fixture;
insert into private.representative_kit_checkout_approvals(
  actor_id,rule_version_id,buyer_profile,buyer_fiscal_state,origin_postal_code,buyer_evidence,operation_evidence,
  stock_evidence,homologation_evidence,valid_until)
select actor,rule_version,'MG02','MG','35520000','synthetic buyer','synthetic operation','synthetic stock',
  'synthetic XML authorization',now()+interval '1 hour' from commercial_kit_fixture;

update public.products set width_cm = 15 where id = (select product from commercial_kit_fixture);
select pg_temp.throws_ok($$select pg_temp.reserve_commercial_kit()$$,'23514','kit_shipping_inputs_changed',
  'packing changes invalidate the freight even when unit price stays unchanged');
update public.products set width_cm = 10 where id = (select product from commercial_kit_fixture);

select pg_temp.throws_ok($$select pg_temp.reserve_commercial_kit()$$,'23514','resale_configuration_required',
  'the fiscal buyer and its official registration are required before creating an order');
update private.representative_kit_checkout_approvals set buyer_legal_name = 'Synthetic buyer LTDA',
  buyer_document = '11222333000181', buyer_state_registration = '0012345678900',
  buyer_fiscal_address = '{"state":"MG","postal_code":"30110100","street":"Test street","number":"1","district":"Test district","city":"Test city"}'
  where actor_id = (select actor from commercial_kit_fixture);

select pg_temp.is(pg_temp.reserve_commercial_kit()->>'amountInCents','12100','uses the locked catalog price and private freight');
update commercial_kit_fixture set order_id = (pg_temp.reserve_commercial_kit()->>'orderId')::uuid;
select pg_temp.ok((select order_id is not null from commercial_kit_fixture),'same request replays the existing order');
select pg_temp.throws_ok($$select pg_temp.reserve_commercial_kit(1)$$,'23505','kit_idempotency_conflict',
  'a reused key cannot change quantity');
select pg_temp.throws_ok($$select pg_temp.reserve_commercial_kit(2,true)$$,'23514','kit_quote_unavailable',
  'a new key cannot reuse consumed freight');
select pg_temp.results_eq(
  $$select available_quantity,reserved_quantity from public.inventory where variant_id=(select variant from commercial_kit_fixture)$$,
  $$values (1,2)$$,'stock is reserved once in the inventory shared with retail');

select pg_temp.is((select public.cancel_unstarted_representative_kit_order(outsider,order_id) from commercial_kit_fixture),
  false,'another buyer cannot release the hold');
select pg_temp.is((select public.cancel_unstarted_representative_kit_order(null,order_id) from commercial_kit_fixture),
  false,'expiration cannot release a live hold');
select pg_temp.is((select public.cancel_unstarted_representative_kit_order(actor,order_id) from commercial_kit_fixture),
  true,'the buyer can cancel an unstarted payment');
select pg_temp.is((select public.cancel_unstarted_representative_kit_order(actor,order_id) from commercial_kit_fixture),
  true,'cancellation is idempotent');
select pg_temp.results_eq(
  $$select available_quantity,reserved_quantity from public.inventory where variant_id=(select variant from commercial_kit_fixture)$$,
  $$values (3,0)$$,'the hold is restored exactly once');

update commercial_kit_fixture set quote = pg_temp.commercial_quote(), request_key = gen_random_uuid();
update commercial_kit_fixture set order_id = (pg_temp.reserve_commercial_kit()->>'orderId')::uuid;

create function pg_temp.claim_commercial_pix() returns jsonb language sql as $$
  select public.claim_representative_kit_pix(actor,order_id) from commercial_kit_fixture;
$$;

create function pg_temp.settle_commercial_pix(p_status text,p_id text default null,p_amount bigint default 12100,
  p_refunds jsonb default '[]')
returns jsonb language sql as $$
  select public.settle_representative_kit_payment(order_id,coalesce(p_id,expected_payment),'KITMG-'||order_id,p_amount,'BRL',p_status,now(),p_refunds)
  from commercial_kit_fixture;
$$;

select pg_temp.ok(not has_function_privilege('authenticated',
  'public.settle_representative_kit_payment(uuid,text,text,bigint,text,text,timestamptz,jsonb)','execute'),
  'buyers cannot confirm their own payment');
select pg_temp.throws_ok($$select pg_temp.settle_commercial_pix('approved')$$,'23514','kit_payment_identity_mismatch',
  'payments cannot attach before the creation claim');
update private.representative_kit_checkout_approvals set revoked_at = now() where actor_id = (select actor from commercial_kit_fixture);
select pg_temp.throws_ok($$select pg_temp.claim_commercial_pix()$$,'23514','resale_payment_blocked',
  'approval is required again before issuing Pix');
update private.representative_kit_checkout_approvals set revoked_at = null where actor_id = (select actor from commercial_kit_fixture);
update private.representative_kit_checkout_approvals set buyer_state_registration='0099999999999'
  where actor_id=(select actor from commercial_kit_fixture);
select pg_temp.throws_ok($$select pg_temp.claim_commercial_pix()$$,'23514','resale_payment_blocked',
  'changing the verified fiscal buyer after checkout cannot start payment for the old snapshot');
update private.representative_kit_checkout_approvals set buyer_state_registration='0012345678900'
  where actor_id=(select actor from commercial_kit_fixture);
select pg_temp.is(pg_temp.claim_commercial_pix()->>'buyerDocument','11222333000181','the provider receives the approved fiscal buyer');
select pg_temp.is(pg_temp.claim_commercial_pix(),null::jsonb,'a replay never claims a second provider write');
select pg_temp.is((select public.cancel_unstarted_representative_kit_order(actor,order_id) from commercial_kit_fixture),
  false,'an uncertain provider creation keeps the stock held');
select pg_temp.throws_ok($$select pg_temp.settle_commercial_pix('pending','123',1)$$,'23514','kit_payment_identity_mismatch',
  'provider amount must match exactly');
select pg_temp.is(pg_temp.settle_commercial_pix('pending')->>'state','payment_pending','a matching payment attaches');
select pg_temp.throws_ok($$select pg_temp.settle_commercial_pix('approved','456')$$,'23514','kit_payment_identity_mismatch',
  'a different payment cannot replace the attached identity');
select pg_temp.is((select public.request_representative_kit_payment_cancellation(actor,order_id)->>'cancellationRequested'
  from commercial_kit_fixture),'true','a requested cancellation awaits provider confirmation');
select pg_temp.is(pg_temp.settle_commercial_pix('approved')->>'state','paid','confirmed approval wins the cancellation race');
select pg_temp.is(pg_temp.settle_commercial_pix('pending')->>'state','paid','a stale pending response cannot regress payment');
select pg_temp.results_eq(
  $$select available_quantity,reserved_quantity from public.inventory where variant_id=(select variant from commercial_kit_fixture)$$,
  $$values (1,0)$$,'paid stock is debited once');
select pg_temp.is((select count(*)::integer from public.inventory_movements where reference_id=(select order_id from commercial_kit_fixture)),
  1,'debit has one physical movement');
select pg_temp.is((select count(*)::integer from private.representative_kit_refund_requests
  where order_id=(select order_id from commercial_kit_fixture) and reason='undispatched_cancellation'),
  1,'the cancellation race enqueues one full estorno before fulfillment');
select pg_temp.is((select public.claim_representative_kit_refund(id,'{}') from private.representative_kit_refund_requests
  where order_id=(select order_id from commercial_kit_fixture)),true,'the unshipped order can refund after confirmed payment');
select pg_temp.is(pg_temp.settle_commercial_pix('refunded',null,12100,'[{"id":"88","amountInCents":12100}]')->>'state',
  'refunded','an approved full refund reconciles to the payment ledger');
select pg_temp.is((select public.acknowledge_representative_kit_refund(id,'88') from private.representative_kit_refund_requests
  where order_id=(select order_id from commercial_kit_fixture)),true,'the exact provider refund receipt is recorded');
select pg_temp.is((select public.finish_representative_kit_refund(id,'88') from private.representative_kit_refund_requests
  where order_id=(select order_id from commercial_kit_fixture)),true,'the provider receipt closes the local refund');
select pg_temp.is((select public.finish_representative_kit_refund(id,'88') from private.representative_kit_refund_requests
  where order_id=(select order_id from commercial_kit_fixture)),true,'the unshipped refund can replay safely');
select pg_temp.results_eq(
  $$select available_quantity,reserved_quantity from public.inventory where variant_id=(select variant from commercial_kit_fixture)$$,
  $$values (3,0)$$,'confirmed unshipped refund returns stock exactly once');

update commercial_kit_fixture set quote=pg_temp.commercial_quote(),request_key=gen_random_uuid(),expected_payment='222';
update commercial_kit_fixture set order_id=(pg_temp.reserve_commercial_kit()->>'orderId')::uuid;
select pg_temp.is(pg_temp.claim_commercial_pix()->>'buyerDocument','11222333000181','a second order has an independent payment claim');
select pg_temp.is(pg_temp.settle_commercial_pix('approved')->>'state','paid','an ordinary payment enqueues fulfillment');
update private.representative_kit_fulfillment set bling_sale_id=123,bling_invoice_id=456,shipment_id='synthetic-carrier'
  where order_id=(select order_id from commercial_kit_fixture);
create function pg_temp.record_kit_invoice(p_series text default '002')
returns boolean language sql as $$
  select public.record_representative_kit_authorized_invoice(order_id,123,456,
    '3126111234567800019555'||p_series||repeat('1',19),'100000000000001',repeat('a',64))
  from commercial_kit_fixture;
$$;
create function pg_temp.record_kit_tracking(p_status text)
returns boolean language sql as $$
  select public.record_representative_kit_tracking(order_id,'synthetic-carrier',
    '3126111234567800019555002'||repeat('1',19),p_status,'SYNTHETICCODE')
  from commercial_kit_fixture;
$$;
select pg_temp.is(pg_temp.record_kit_tracking('dispatched'),false,'carrier state requires validated fiscal clearance');
select pg_temp.is(pg_temp.record_kit_invoice('003'),false,'the return series cannot clear a sale for dispatch');
select pg_temp.is(pg_temp.record_kit_invoice(),true,'the backend can record a verified sale identity');
select pg_temp.is(pg_temp.record_kit_tracking('in_transit'),true,'tracking can proceed once the paid order has fiscal clearance');
select pg_temp.is(pg_temp.record_kit_tracking('ready'),false,'an old provider state cannot regress tracking');
select pg_temp.is((select public.read_representative_kit_tracking(outsider,order_id) from commercial_kit_fixture),
  null::jsonb,'tracking projection is scoped to the purchaser');

insert into private.representative_kit_refund_requests(order_id,amount_cents,reason,operational_evidence,fiscal_evidence,original_invoice_key)
select order_id,2100,'undispatched_cancellation','synthetic cancellation','synthetic fiscal evidence',
  '3126111234567800019555002'||repeat('1',19) from commercial_kit_fixture;
select pg_temp.is((select public.claim_representative_kit_refund(id,'{}') from private.representative_kit_refund_requests
  where order_id=(select order_id from commercial_kit_fixture)),false,'an order in transit cannot use the unshipped refund path');

create function pg_temp.request_kit_return(p_quantity integer,p_key uuid)
returns jsonb language sql as $$
  select public.request_representative_kit_return(actor,order_id,p_quantity,'Synthetic return request',p_key)
  from commercial_kit_fixture;
$$;
select pg_temp.throws_ok($$select pg_temp.request_kit_return(1,'11111111-1111-4111-8111-111111111111')$$,
  '23514','kit_return_unavailable','a shipment in transit cannot be refunded as a received return');
select pg_temp.is(pg_temp.record_kit_tracking('delivered'),true,'delivery is recorded from the confirmed carrier');
select pg_temp.is(pg_temp.request_kit_return(1,'11111111-1111-4111-8111-111111111111')->>'state','requested','buyer can request one returned kit');
select pg_temp.is(pg_temp.request_kit_return(1,'11111111-1111-4111-8111-111111111111')->>'state','requested','return request is idempotent');
select pg_temp.throws_ok($$select pg_temp.request_kit_return(2,'22222222-2222-4222-8222-222222222222')$$,
  '23514','kit_return_unavailable','return requests share one order quantity balance');
select pg_temp.is((select public.list_representative_kit_returns(outsider,order_id) from commercial_kit_fixture),
  '[]'::jsonb,'another buyer cannot see private return records');
select pg_temp.is((select public.record_representative_kit_return_invoice(id,'3126111234567800019555003'||repeat('1',19),
  '100000000000003',repeat('a',64)) from private.representative_kit_returns where order_id=(select order_id from commercial_kit_fixture)),
  false,'XML cannot bypass inspection and receipt');

create function pg_temp.manage_kit_return(p_action text,p_data jsonb default '{}'::jsonb)
returns text language sql as $$
  select public.manage_representative_kit_return(r.id,p_action,p_data)->>'state'
  from private.representative_kit_returns r join commercial_kit_fixture f using(order_id);
$$;
select set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true) from commercial_kit_fixture;
select pg_temp.throws_ok($$select pg_temp.manage_kit_return('approve','{"instructions":"No support role"}')$$,
  '42501','permission denied','the buyer cannot approve their own return');
update public.profiles set status='active' where id=(select outsider from commercial_kit_fixture);
insert into public.user_permission_overrides(user_id,permission_id,allowed,reason,created_by)
select f.outsider,p.id,true,'Synthetic return reviewer permissions',f.outsider
from public.permissions p cross join commercial_kit_fixture f where p.code in ('returns.approve','returns.inspect','returns.refund');
select set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true) from commercial_kit_fixture;
select pg_temp.is(pg_temp.manage_kit_return('approve','{"instructions":"Synthetic store return instructions"}'),
  'approved','authorized staff can approve the return');
select pg_temp.is(pg_temp.manage_kit_return('receive',jsonb_build_object('invoiceId',901,'refundInCents',6050,'restockQuantity',1,
  'invoiceKey','3126111234567800019555003'||repeat('1',19),'documentOrigin','own_inflow','inspectionReference','Synthetic inspected kit')),
  'received','receiving inventory alone does not authorize the refund');
select pg_temp.is(pg_temp.manage_kit_return('refund'),null::text,'staff cannot authorize the refund before XML validation');
select pg_temp.is((select public.record_representative_kit_return_invoice(id,'3126111234567800019555003'||repeat('1',19),
  '100000000000003',repeat('a',64)) from private.representative_kit_returns where order_id=(select order_id from commercial_kit_fixture)),
  true,'trusted verification attaches the exact authorized return');
delete from private.representative_kit_refund_requests where order_id=(select order_id from commercial_kit_fixture);
select pg_temp.is(pg_temp.manage_kit_return('refund'),null::text,'a refund must be prepared first');
select pg_temp.is(pg_temp.manage_kit_return('prepare_refund'),'verified','preparation leaves the refund unqueued');
select pg_temp.is(pg_temp.manage_kit_return('refund'),null::text,'a preparer cannot approve the same refund');
alter table commercial_kit_fixture add column refund_reviewer uuid default gen_random_uuid();
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
  select refund_reviewer,'kit-refund-reviewer@example.invalid','{}'::jsonb,'{}'::jsonb from commercial_kit_fixture;
update public.profiles set status='active' where id=(select refund_reviewer from commercial_kit_fixture);
insert into public.user_permission_overrides(user_id,permission_id,allowed,reason,created_by)
  select f.refund_reviewer,p.id,true,'Synthetic second refund reviewer',f.outsider
  from public.permissions p cross join commercial_kit_fixture f where p.code='returns.refund';
select set_config('request.jwt.claims',jsonb_build_object('sub',refund_reviewer,'role','authenticated')::text,true)
  from commercial_kit_fixture;
select pg_temp.is(pg_temp.manage_kit_return('refund'),'refund_pending','the authorized partial refund is queued');
select pg_temp.is((select public.claim_representative_kit_refund(id,'{}') from private.representative_kit_refund_requests
  where order_id=(select order_id from commercial_kit_fixture)),true,'verified partial refund can claim one external write');
select pg_temp.is((select available_quantity from public.inventory where variant_id=(select variant from commercial_kit_fixture)),
  1,'stock waits for the actual refund receipt');

select pg_temp.is(pg_temp.settle_commercial_pix('approved',null,12100,'[{"id":"99","amountInCents":6050}]')->>'state',
  'manual_review','a partial refund blocks fulfillment without automatically returning stock');
select pg_temp.is(pg_temp.settle_commercial_pix('approved',null,12100,'[{"id":"99","amountInCents":6050}]')->>'refundedInCents',
  '6050','repeated refund events cannot duplicate the refund amount');
select pg_temp.is((select public.acknowledge_representative_kit_refund(id,'99') from private.representative_kit_refund_requests
  where order_id=(select order_id from commercial_kit_fixture)),true,'provider acknowledgement is associated with the reviewed return');
select pg_temp.is((select public.finish_representative_kit_refund(id,'99') from private.representative_kit_refund_requests
  where order_id=(select order_id from commercial_kit_fixture)),true,'settled return completes');
select pg_temp.is((select public.finish_representative_kit_refund(id,'99') from private.representative_kit_refund_requests
  where order_id=(select order_id from commercial_kit_fixture)),true,'receipt replay is harmless');
select pg_temp.is((select r.state from private.representative_kit_returns r join commercial_kit_fixture f using(order_id)),
  'completed','buyer reads completed return after settlement');
select pg_temp.is((select available_quantity from public.inventory where variant_id=(select variant from commercial_kit_fixture)),
  2,'the inspected resellable kit returns to inventory exactly once');
select pg_temp.throws_ok($$select pg_temp.settle_commercial_pix('approved',null,12100,'[{"id":"99","amountInCents":2101}]')$$,
  '23514','kit_refund_identity_mismatch','existing refund amount cannot be changed');
select pg_temp.is(pg_temp.settle_commercial_pix('refunded',null,12100,'[{"id":"100","amountInCents":6050}]')->>'state',
  'refunded','full provider refund is recorded');
select pg_temp.is((select available_quantity from public.inventory where variant_id=(select variant from commercial_kit_fixture)),
  2,'an external financial refund without a second inspected return does not restock');

select pg_temp.is((select jsonb_object_agg(size,pairs) from private.representative_kit_grade_templates() where code='standard'),
  '{"34":1,"35":2,"36":3,"37":3,"38":2,"39":1}'::jsonb,'standard sheet matches the approved sizes');
select pg_temp.is((select jsonb_object_agg(size,pairs) from private.representative_kit_grade_templates() where code='lower_restock'),
  '{"34":1,"35":3,"36":4,"37":4}'::jsonb,'lower restock matches the approved sizes');
select pg_temp.is((select jsonb_object_agg(size,pairs) from private.representative_kit_grade_templates() where code='upper_restock'),
  '{"37":4,"38":4,"39":4}'::jsonb,'upper restock matches the approved sizes');

alter table commercial_kit_fixture add column own_quote uuid, add column own_key uuid default gen_random_uuid();
update commercial_kit_fixture set own_quote=(public.quote_representative_kit_own_delivery(actor,variant,null,1,address,
  null,false)->>'id')::uuid;
select pg_temp.ok((select own_quote is not null from commercial_kit_fixture),'the prepaid quote needs no route or configured origin');
create function pg_temp.reserve_own_kit()
returns jsonb language sql as $$
  select public.reserve_representative_kit_own_delivery(actor,variant,null,1,own_quote,address,own_key,'35520000')
    from commercial_kit_fixture;
$$;
select pg_temp.is(pg_temp.reserve_own_kit()->>'amountInCents','5000','the prepaid order includes no delivery charge');
select pg_temp.is((select shipping_snapshot->>'provider' from private.representative_kit_orders
  where id=(pg_temp.reserve_own_kit()->>'orderId')::uuid),'own_delivery','the prepaid order preserves the delivery provider');
select pg_temp.ok((select own_delivery_route_id is null and shipping_snapshot->>'estimatedDays' is null
  and shipping_snapshot->'deliveryAddress'->>'state'='MG' from private.representative_kit_orders
  where id=(pg_temp.reserve_own_kit()->>'orderId')::uuid),'the order stores the MG address without a route or estimated date');
select pg_temp.is((select public.request_representative_kit_payment_cancellation(actor,(pg_temp.reserve_own_kit()->>'orderId')::uuid)->>'state'
  from commercial_kit_fixture),'cancelled','unused prepaid own-delivery stock can be released');
insert into private.representative_kit_collection_routes(name,origin_postal_code,destination_from,destination_through,
  delivery_cents,estimated_days,bling_method_ids,point_terminal_id,verified_evidence,valid_until)
values('Synthetic delivery','35520000','30110000','30110999',1300,2,
  '{"cash":11,"pix":22,"debit_card":33,"credit_card":44}','SYNTHETIC_POINT','Synthetic verified local delivery',now()+interval '1 day');
alter table commercial_kit_fixture add column collection_quote uuid, add column collection_key uuid default gen_random_uuid();
update commercial_kit_fixture set collection_quote=(public.quote_representative_kit_collection(actor,variant,null,1,address,
  '35520000')->>'id')::uuid;

create function pg_temp.reserve_cash_kit(p_cash bigint)
returns jsonb language sql as $$
  select public.reserve_representative_kit_collection_order(actor,variant,null,1,collection_quote,address,collection_key,
    '35520000','cash',p_cash) from commercial_kit_fixture;
$$;

select pg_temp.throws_ok($$select pg_temp.reserve_cash_kit(6299)$$,'23514','kit_cash_tender_invalid','insufficient cash rejects the whole transaction');
select pg_temp.is((select q.used_at from private.representative_kit_shipping_checkout_quotes q
  join commercial_kit_fixture f on q.id=f.collection_quote),null::timestamptz,'invalid cash leaves the quote available');
select pg_temp.is(pg_temp.reserve_cash_kit(7000)->>'cashChangeInCents','700','database computes change from the confirmed order total');
select pg_temp.is(pg_temp.reserve_cash_kit(7000)->>'state','awaiting_receipt','cash selection reserves stock without marking the order paid');
select pg_temp.throws_ok($$select pg_temp.reserve_cash_kit(8000)$$,'23505','kit_idempotency_conflict','replay cannot alter the planned cash');
select pg_temp.is((select public.request_representative_kit_payment_cancellation(actor,(pg_temp.reserve_cash_kit(7000)->>'orderId')::uuid)->>'state'
  from commercial_kit_fixture),'cancelled','collection cancellation before any external action is available');
select pg_temp.is((select available_quantity from public.inventory where variant_id=(select variant from commercial_kit_fixture)),
  2,'an unpaid cancellation releases the reservation');

alter table commercial_kit_fixture add column grade_product uuid default gen_random_uuid(),
  add column grade_kit uuid default gen_random_uuid(),add column grade_rule uuid default gen_random_uuid(),
  add column grade_key uuid default gen_random_uuid(),add column grade_quote uuid;
insert into public.products(id,name,slug,category_id,status,base_price,weight_grams,width_cm,height_cm,length_cm)
  select grade_product,'Grade fixture',grade_product::text,category,'draft',35,150,8,4,16 from commercial_kit_fixture;
insert into public.product_variants(product_id,sku,color_name,size)
  select grade_product,'TEST-GRADE-'||s,'White',s::text from commercial_kit_fixture cross join generate_series(34,39) s;
insert into public.product_images(product_id,storage_path,alt_text,width,height,is_primary)
  select grade_product,'test/kit-grade.webp','Grade fixture',720,720,true from commercial_kit_fixture;
update public.products set status='active' where id=(select grade_product from commercial_kit_fixture);
insert into public.inventory(variant_id,available_quantity,reserved_quantity)
  select v.id,5,0 from public.product_variants v join commercial_kit_fixture f on v.product_id=f.grade_product;
insert into private.bling_catalog_metadata(product_id,commercial_unit,pairs_per_sku,ncm,origin,cest,production_type,evidence_reference)
  select grade_product,'PR',1,'64022000',0,'','T','Grade synthetic evidence' from commercial_kit_fixture;
insert into public.kits(id,name,slug,description,price_in_cents,grade_product_id,grade_color,created_by)
  select grade_kit,'Grade test kit',grade_kit::text,'Grade fixture',36001,grade_product,'White',actor from commercial_kit_fixture;
select pg_temp.is((select private.representative_kit_grade_snapshot(grade_kit,'upper_restock')->>'priceCents'
  from commercial_kit_fixture),'36001','an existing kit retains its common price until configured');
select pg_temp.throws_ok($$update public.kits set grade_standard_price_cents=36001
  where id=(select grade_kit from commercial_kit_fixture)$$,
  '23514',null,'a kit cannot have a partial price configuration');
update public.kits set grade_standard_price_cents=36001,
  grade_lower_restock_price_cents=35001,grade_upper_restock_price_cents=37001
  where id=(select grade_kit from commercial_kit_fixture);
select set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true)
  from commercial_kit_fixture;
select pg_temp.is((select jsonb_object_agg(template->>'code',template->'unitPriceInCents')
  from jsonb_array_elements(public.list_representative_kit_grade_offers()) offer
  cross join lateral jsonb_array_elements(offer->'templates') template
  where (offer->>'kitId')::uuid=(select grade_kit from commercial_kit_fixture)),
  '{"standard":36001,"lower_restock":35001,"upper_restock":37001}'::jsonb,
  'the catalog publishes the individual prices of all three grades');
select pg_temp.is((select private.representative_kit_grade_snapshot(grade_kit,'lower_restock')->>'priceCents'
  from commercial_kit_fixture),'35001','the freight snapshot uses the lower restock price');
select pg_temp.is((select private.representative_kit_grade_snapshot(grade_kit,'upper_restock')->>'priceCents'
  from commercial_kit_fixture),'37001','the freight snapshot uses the upper restock price');
insert into private.representative_resale_fiscal_rule_versions(
  id,rule_key,version,issuer_reference,product_fingerprint,origin_state,destination_state,person_type,icms_status,
  final_consumer,purpose,valid_from,valid_until,fiscal_parameters)
select f.grade_rule,gen_random_uuid(),1,r.issuer_reference,public.read_representative_kit_grade_fingerprint(f.grade_kit,'standard'),
  r.origin_state,r.destination_state,r.person_type,r.icms_status,r.final_consumer,r.purpose,r.valid_from,r.valid_until,
  r.fiscal_parameters || '{"cashAtDelivery":{"blingPaymentMethodId":"11","homologationEvidence":"Synthetic cash XML"}}'::jsonb
from private.representative_resale_fiscal_rule_versions r join commercial_kit_fixture f on r.id=f.rule_version;
insert into private.representative_resale_fiscal_rule_approvals(rule_version_id,approver_reference,evidence_reference)
select grade_rule,'Synthetic grade approver','Synthetic grade evidence' from commercial_kit_fixture;
insert into private.representative_kit_checkout_approvals(
  actor_id,rule_version_id,buyer_profile,buyer_fiscal_state,origin_postal_code,buyer_evidence,operation_evidence,
  stock_evidence,homologation_evidence,valid_until,buyer_legal_name,buyer_document,buyer_state_registration,buyer_fiscal_address)
select f.actor,f.grade_rule,a.buyer_profile,a.buyer_fiscal_state,a.origin_postal_code,a.buyer_evidence,a.operation_evidence,
  a.stock_evidence,a.homologation_evidence,a.valid_until,a.buyer_legal_name,a.buyer_document,a.buyer_state_registration,a.buyer_fiscal_address
from private.representative_kit_checkout_approvals a join commercial_kit_fixture f on a.rule_version_id=f.rule_version and a.actor_id=f.actor;
update commercial_kit_fixture set grade_quote=(public.quote_representative_kit_collection(actor,grade_kit,'standard',1,address,
  '35520000')->>'id')::uuid;
create function pg_temp.reserve_grade_cash()
returns jsonb language sql as $$
  select public.reserve_representative_kit_collection_order(actor,grade_kit,'standard',1,grade_quote,address,grade_key,
    '35520000','cash',40000) from commercial_kit_fixture;
$$;
update public.kits set grade_standard_price_cents=36501 where id=(select grade_kit from commercial_kit_fixture);
select pg_temp.throws_ok($$select pg_temp.reserve_grade_cash()$$,'23514','kit_grade_quote_changed',
  'changing the chosen grade price invalidates the previous quote');
select pg_temp.is((select used_at from private.representative_kit_shipping_checkout_quotes
  where id=(select grade_quote from commercial_kit_fixture)),null::timestamptz,
  'a stale quote remains unused');
update commercial_kit_fixture set grade_quote=(public.quote_representative_kit_collection(actor,grade_kit,'standard',1,address,
  '35520000')->>'id')::uuid;
update public.inventory set available_quantity=0 where variant_id in (
  select v.id from public.product_variants v join commercial_kit_fixture f on v.product_id=f.grade_product where v.size='38');
select pg_temp.throws_ok($$select pg_temp.reserve_grade_cash()$$,'23514','kit_grade_quote_changed',
  'a missing grade size rejects the complete sheet');
select pg_temp.is((select sum(i.reserved_quantity)::integer from public.inventory i join public.product_variants v on v.id=i.variant_id
  join commercial_kit_fixture f on v.product_id=f.grade_product),0,'failure leaves all reservations untouched');
update public.inventory set available_quantity=5 where variant_id in (
  select v.id from public.product_variants v join commercial_kit_fixture f on v.product_id=f.grade_product where v.size='38');
select pg_temp.is(pg_temp.reserve_grade_cash()->>'cashChangeInCents','2199','the new grade price and freight determine cash change');
update public.kits set grade_standard_price_cents=37501 where id=(select grade_kit from commercial_kit_fixture);
select pg_temp.is(pg_temp.reserve_grade_cash()->>'amountInCents','37801','an idempotent replay retains the reserved grade price');
select pg_temp.is((select jsonb_object_agg(v.size,i.reserved_quantity) from public.inventory i join public.product_variants v on v.id=i.variant_id
  join commercial_kit_fixture f on v.product_id=f.grade_product),
  '{"34":1,"35":2,"36":3,"37":3,"38":2,"39":1}'::jsonb,'reserving a sheet holds its exact shared stock');
select pg_temp.is((select public.request_representative_kit_payment_cancellation(actor,(pg_temp.reserve_grade_cash()->>'orderId')::uuid)->>'state'
  from commercial_kit_fixture),'cancelled','the unpaid grade can be cancelled as a whole');
select pg_temp.is((select sum(i.available_quantity)::integer from public.inventory i join public.product_variants v on v.id=i.variant_id
  join commercial_kit_fixture f on v.product_id=f.grade_product),30,'all of the original grade stock is restored');

alter table commercial_kit_fixture add column delivery_order uuid, add column pair_return uuid;
update private.representative_kit_collection_routes set closed_at=now() where name='Synthetic delivery';
update commercial_kit_fixture set grade_key=gen_random_uuid(),grade_quote=(public.quote_representative_kit_own_delivery(
  actor,grade_kit,'standard',1,address,null,true)->>'id')::uuid;
update commercial_kit_fixture set delivery_order=(public.reserve_representative_kit_own_collection(
  actor,grade_kit,'standard',1,grade_quote,address,grade_key,null,'cash',40000)->>'orderId')::uuid;
select pg_temp.ok((select o.collection_route_id is null and o.collection_method='cash' and o.collection_bling_method=11
    and o.shipping_cents=0 and o.shipping_snapshot->>'estimatedDays' is null
  from private.representative_kit_orders o join commercial_kit_fixture f on o.id=f.delivery_order),
  'cash at delivery uses the rule and the MG address without a route');
select pg_temp.is((select private.representative_kit_fiscal_ready(o)
  from private.representative_kit_orders o join commercial_kit_fixture f on o.id=f.delivery_order),
  false,'address-only cash billing waits for an operating date');
insert into public.user_permission_overrides(user_id,permission_id,allowed,reason,created_by)
select f.outsider,p.id,true,'Synthetic delivery operator',f.outsider
  from public.permissions p cross join commercial_kit_fixture f where p.code='orders.update_operational_status';
select set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true)
  from commercial_kit_fixture;
select pg_temp.is((select public.schedule_representative_kit_cash_delivery(delivery_order,current_date+1)
  from commercial_kit_fixture),true,'an authorized operator schedules cash delivery');
select pg_temp.is((select private.representative_kit_fiscal_ready(o)
  from private.representative_kit_orders o join commercial_kit_fixture f on o.id=f.delivery_order),
  true,'the delivery date enables the usual billing queue');
select pg_temp.is((select public.claim_representative_kit_bling_write_for_delivery(delivery_order,'bling_sale',null,current_date+2)
  from commercial_kit_fixture),false,'a stale delivery snapshot cannot claim a billing write');
update private.representative_kit_fulfillment
  set bling_sale_id=912,bling_invoice_id=913,invoice_access_key='3126111234567800019555003'||repeat('4',19),
    invoice_protocol='100000000000004',invoice_xml_sha256=repeat('b',64),
    invoice_confirmed_at=clock_timestamp(),shipment_status='dispatched',shipment_rank=4
  where order_id=(select delivery_order from commercial_kit_fixture);
select pg_temp.is((select public.manage_representative_kit_collection(delivery_order,'cash_received','Synthetic cash receipt')->>'ok'
  from commercial_kit_fixture),'true','cash can be confirmed independently of delivery');
select pg_temp.is((select f.shipment_status from private.representative_kit_fulfillment f join commercial_kit_fixture t
  on f.order_id=t.delivery_order),'dispatched','cash receipt cannot complete the physical delivery');
select pg_temp.is((select public.manage_representative_kit_collection(delivery_order,'confirm_delivery','Synthetic signed delivery')->>'ok'
  from commercial_kit_fixture),'true','authorized staff can confirm the physical delivery');
select pg_temp.is((select f.shipment_status from private.representative_kit_fulfillment f join commercial_kit_fixture t
  on f.order_id=t.delivery_order),'delivered','both confirmations complete the order');

select pg_temp.throws_ok($$select public.request_representative_kit_pair_return(actor,delivery_order,
  '{"TEST-GRADE-35":3}','Synthetic excess return',gen_random_uuid()) from commercial_kit_fixture$$,
  '23514','kit_return_unavailable','a pair request cannot exceed the sold quantity for its SKU');
update commercial_kit_fixture set pair_return=(public.request_representative_kit_pair_return(actor,delivery_order,
  '{"TEST-GRADE-35":1}','Synthetic pair return',gen_random_uuid())->>'id')::uuid;
select pg_temp.is((select public.manage_representative_kit_return(pair_return,'approve',
  '{"instructions":"Synthetic approved return"}')->>'state' from commercial_kit_fixture),
  'approved','the operator approves the selected pair');
select pg_temp.isnt((select public.manage_representative_kit_return(pair_return,'schedule_pickup',
  jsonb_build_object('pickupDate',current_date+1)) from commercial_kit_fixture),null::jsonb,'pickup can be scheduled for a pair');
select pg_temp.isnt((select public.manage_representative_kit_return(pair_return,'confirm_pickup',
  '{"pickupReference":"Synthetic documented pickup"}') from commercial_kit_fixture),null::jsonb,'pickup evidence is recorded');
select pg_temp.is((select public.manage_representative_kit_return(pair_return,'receive',jsonb_build_object(
  'invoiceId',917,'invoiceKey','3126111234567800019555004'||repeat('7',19),'documentOrigin','own_inflow',
  'restockQuantity',0,'restockPairs','{"TEST-GRADE-34":1}'::jsonb,'refundInCents',3000,
  'inspectionReference','Synthetic pair inspection')) from commercial_kit_fixture),
  null::jsonb,'the inspector cannot restock a different SKU');
select pg_temp.is((select public.manage_representative_kit_return(pair_return,'receive',jsonb_build_object(
  'invoiceId',917,'invoiceKey','3126111234567800019555004'||repeat('7',19),'documentOrigin','own_inflow',
  'restockQuantity',0,'restockPairs','{"TEST-GRADE-35":1}'::jsonb,'refundInCents',3000,
  'inspectionReference','Synthetic pair inspection'))->>'state' from commercial_kit_fixture),
  'received','the inspected SKU and fiscal reference are recorded together');
select pg_temp.is((select public.record_representative_kit_return_invoice_lines(pair_return,
  '3126111234567800019555004'||repeat('7',19),'100000000000009',repeat('e',64),
  '[{"signature":"synthetic price line","sku":"TEST-GRADE-35","quantity":1,"saleQuantity":2}]')
  from commercial_kit_fixture),true,'the provider proof verifies the requested SKU and sold quantity');
select pg_temp.is((select public.manage_representative_kit_return(pair_return,'refund','{}')->>'state'
  from commercial_kit_fixture),'refund_pending','the fiscal evidence allows the usual cash return workflow');
select pg_temp.is((select public.prepare_representative_kit_collection_refund(pair_return,'Synthetic confirmed cash return')->>'confirmed'
  from commercial_kit_fixture),'true','cash return confirmation finalizes inventory without a route');
select pg_temp.is((select jsonb_object_agg(v.size,i.available_quantity) from public.inventory i
  join public.product_variants v on v.id=i.variant_id join commercial_kit_fixture f on v.product_id=f.grade_product),
  '{"34":4,"35":4,"36":2,"37":2,"38":3,"39":4}'::jsonb,'only the inspected variant returns to inventory');

select pg_temp.is((select public.quote_representative_kit_own_delivery(actor,variant,null,1,address,null,true)
  from commercial_kit_fixture),null::jsonb,'cash approval for a grade cannot authorize a different product');
update private.representative_kit_collection_routes set closed_at=null where name='Synthetic delivery';
update private.representative_kit_collection_routes set delivery_cents=0 where name='Synthetic delivery';
update commercial_kit_fixture set collection_key=gen_random_uuid(),collection_quote=(public.quote_representative_kit_own_delivery(
  actor,variant,null,1,address,'35520000',true)->>'id')::uuid;
update commercial_kit_fixture set delivery_order=(pg_temp.reserve_cash_kit(5000)->>'orderId')::uuid;
update private.representative_kit_fulfillment
  set bling_sale_id=914,bling_invoice_id=915,invoice_access_key='3126111234567800019555003'||repeat('5',19),
    invoice_protocol='100000000000005',invoice_xml_sha256=repeat('c',64),
    invoice_confirmed_at=clock_timestamp(),shipment_status='pending',shipment_rank=0
  where order_id=(select delivery_order from commercial_kit_fixture);
select pg_temp.is(private.representative_kit_requires_mdfe('{
  "originPostalCode":"35524168","address":{"postalCode":"35522001"},
  "deliveryAddress":{"city":"Nova Serrana","state":"MG","postalCode":"35522001"}}'),false,
  'a confirmed municipal Nova Serrana delivery can leave without a manifesto');
select pg_temp.is(private.representative_kit_requires_mdfe('{
  "originPostalCode":"35524168","address":{"postalCode":"30110100"},
  "deliveryAddress":{"city":"Nova Serrana","state":"MG","postalCode":"30110100"}}'),true,
  'a municipality name alone cannot exempt an intermunicipal CEP');
select pg_temp.is(private.representative_kit_requires_mdfe('{}'::jsonb),true,'an incomplete snapshot requires verification');
select pg_temp.throws_ok($$select public.manage_representative_kit_collection(delivery_order,'dispatch','Synthetic dispatch attempt')
  from commercial_kit_fixture$$,'23514','kit_mdfe_required','intermunicipal dispatch requires proof independently from the panel');
select pg_temp.is((select public.confirm_representative_kit_mdfe(delivery_order,'31261112345678000195580010000000011123456780',
  '100000000000006','Synthetic SEFAZ consultation') from commercial_kit_fixture),false,'invalid check digit cannot authorize dispatch');
select pg_temp.is((select public.confirm_representative_kit_mdfe(delivery_order,'31261112345678000195580010000000011123456787',
  '100000000000006','Synthetic SEFAZ consultation') from commercial_kit_fixture),true,'staff records a manifesto for the authorized NF-e');
select pg_temp.is((select private.representative_kit_pending_mdfe(delivery_order,'3126111234567800019555003'||repeat('6',19))
  from commercial_kit_fixture),null::text,'the evidence is bound to the invoice for which it was reviewed');
select pg_temp.is((select public.manage_representative_kit_collection(delivery_order,'dispatch','Synthetic dispatch after review')->>'ok'
  from commercial_kit_fixture),'true','matching verified manifesto unlocks the intermunicipal dispatch');
select pg_temp.is((select private.representative_kit_pending_mdfe(delivery_order,'3126111234567800019555003'||repeat('5',19))
  from commercial_kit_fixture),null::text,'dispatch consumes the authorization for this order');
select pg_temp.is((select public.manage_representative_kit_collection(delivery_order,'delivery_failed','Synthetic delivery refusal')->>'ok'
  from commercial_kit_fixture),'true','the delivery refusal is recorded after circulation');
select pg_temp.is((select o.cancellation_requested_at from private.representative_kit_orders o join commercial_kit_fixture t
  on o.id=t.delivery_order),null::timestamptz,'a refusal does not start invoice cancellation');
select pg_temp.is((select public.manage_representative_kit_collection(delivery_order,'returned_unpaid','Synthetic physical return')
  from commercial_kit_fixture),null::jsonb,'a physical return alone does not release stock');
select pg_temp.is((select o.stock_state from private.representative_kit_orders o join commercial_kit_fixture t
  on o.id=t.delivery_order),'reserved','the stock stays reserved until the fiscal return can be verified');

insert into public.user_permission_overrides(user_id,permission_id,allowed,reason,created_by)
select f.outsider,p.id,true,'Synthetic inspection operator',f.outsider
  from public.permissions p cross join commercial_kit_fixture f where p.code='returns.inspect'
on conflict (user_id,permission_id) do nothing;
select pg_temp.is((select public.register_representative_kit_undelivered_return(delivery_order,916,
  '3126111234567800019555004'||repeat('6',19),1,'Synthetic physical count') from commercial_kit_fixture),
  true,'the operator can register physically inspected stock with the independent return document');
select pg_temp.is((select o.stock_state from private.representative_kit_orders o join commercial_kit_fixture t
  on o.id=t.delivery_order),'reserved','registration alone still does not release stock');
select pg_temp.is((select public.record_representative_kit_return_invoice(r.id,r.invoice_key,'100000000000008',repeat('d',64))
  from private.representative_kit_returns r join commercial_kit_fixture t on t.delivery_order=r.order_id),true,
  'authorized return verification releases the unpaid stock');
select pg_temp.is((select public.record_representative_kit_return_invoice(r.id,r.invoice_key,'100000000000008',repeat('d',64))
  from private.representative_kit_returns r join commercial_kit_fixture t on t.delivery_order=r.order_id),true,
  'the authorized return verifier can replay without creating another stock movement');
select pg_temp.is((select o.stock_state from private.representative_kit_orders o join commercial_kit_fixture t
  on o.id=t.delivery_order),'released','the final state reflects the released reservation');

select * from pg_temp.finish();

rollback;
select 'staging rehearsal rollback completed' as result,
  to_regclass('private.representative_kit_orders') is null as rolled_back,
  (select max(version) from supabase_migrations.schema_migrations) as history;
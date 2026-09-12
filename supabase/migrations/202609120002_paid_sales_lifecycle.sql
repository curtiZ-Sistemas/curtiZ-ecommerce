-- Keep abandoned checkouts out of the customer journey and count only paid sales.

begin;

create or replace function private.expire_stale_mercadopago_order(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_row public.orders%rowtype;
  payment_row public.payments%rowtype;
begin
  select * into order_row
  from public.orders
  where id = p_order_id
  for update;

  if order_row.id is null or order_row.status <> 'pending_payment' then
    return false;
  end if;

  select * into payment_row
  from public.payments
  where order_id = p_order_id and provider = 'mercadopago'
  for update;

  if payment_row.id is null
    or payment_row.status not in ('pending', 'rejected')
    or payment_row.expires_at is null
    or payment_row.expires_at > now() then
    return false;
  end if;

  perform private.release_order_reservations(p_order_id);

  update public.payments
  set status = 'cancelled', status_detail = 'expired', updated_at = now()
  where id = payment_row.id;

  update public.payment_attempts
  set status = 'cancelled', status_detail = 'expired', updated_at = now()
  where payment_id = payment_row.id and status in ('pending', 'rejected');

  update public.orders
  set status = 'cancelled', payment_status = 'cancelled', updated_at = now()
  where id = p_order_id;

  insert into public.order_status_history(order_id, previous_status, new_status, reason)
  values (p_order_id, 'pending_payment', 'cancelled', 'Pagamento expirado sem aprovação');

  return true;
end;
$$;

revoke all on function private.expire_stale_mercadopago_order(uuid)
  from public, anon, authenticated;

create index if not exists payments_pending_expiration_idx
  on public.payments(expires_at)
  where provider = 'mercadopago'
    and status in ('pending', 'rejected')
    and expires_at is not null;

create or replace function private.expire_stale_mercadopago_orders(p_limit integer default 50)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate record;
  expired_count integer := 0;
begin
  if p_limit not between 1 and 250 then
    raise exception 'invalid_expiration_limit' using errcode = '22023';
  end if;

  for candidate in
    select payment.order_id
    from public.payments payment
    join public.orders sale on sale.id = payment.order_id
    where sale.status = 'pending_payment'
      and payment.provider = 'mercadopago'
      and payment.status in ('pending', 'rejected')
      and payment.expires_at <= now()
    order by payment.expires_at
    limit p_limit
  loop
    if private.expire_stale_mercadopago_order(candidate.order_id) then
      expired_count := expired_count + 1;
    end if;
  end loop;

  return expired_count;
end;
$$;

revoke all on function private.expire_stale_mercadopago_orders(integer)
  from public, anon, authenticated;

create or replace function public.expire_my_stale_checkout_orders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate record;
  expired_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  for candidate in
    select payment.order_id
    from public.payments payment
    join public.orders sale on sale.id = payment.order_id
    where sale.customer_id = auth.uid()
      and sale.status = 'pending_payment'
      and payment.provider = 'mercadopago'
      and payment.status in ('pending', 'rejected')
      and payment.expires_at <= now()
    order by payment.expires_at
    limit 25
  loop
    if private.expire_stale_mercadopago_order(candidate.order_id) then
      expired_count := expired_count + 1;
    end if;
  end loop;

  return expired_count;
end;
$$;

revoke all on function public.expire_my_stale_checkout_orders() from public, anon;
grant execute on function public.expire_my_stale_checkout_orders() to authenticated;

create or replace function public.expire_stale_mercadopago_order(p_order_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select private.expire_stale_mercadopago_order(p_order_id);
$$;

revoke all on function public.expire_stale_mercadopago_order(uuid)
  from public, anon, authenticated;
grant execute on function public.expire_stale_mercadopago_order(uuid) to service_role;

create or replace function public.expire_stale_mercadopago_orders(p_limit integer default 50)
returns integer
language sql
security definer
set search_path = ''
as $$
  select private.expire_stale_mercadopago_orders(p_limit);
$$;

revoke all on function public.expire_stale_mercadopago_orders(integer)
  from public, anon, authenticated;
grant execute on function public.expire_stale_mercadopago_orders(integer) to service_role;

drop materialized view if exists public.management_daily_metrics;
create materialized view public.management_daily_metrics as
with paid_sales as (
  select
    date_trunc('day', coalesce(placed_at, created_at)) as day,
    count(*) as order_count,
    sum(subtotal) as gross_revenue,
    sum(grand_total - fee_total - shipping_cost) as net_revenue,
    sum(estimated_profit) as estimated_profit
  from public.orders
  where payment_status = 'approved'
  group by date_trunc('day', coalesce(placed_at, created_at))
), completed_refunds as (
  select
    date_trunc('day', refund.completed_at) as day,
    sum(refund.amount) as refunds
  from public.payment_refunds refund
  where refund.status = 'completed' and refund.completed_at is not null
  group by date_trunc('day', refund.completed_at)
)
select
  coalesce(sale.day, refund.day) as day,
  coalesce(sale.order_count, 0) as order_count,
  coalesce(sale.gross_revenue, 0) as gross_revenue,
  coalesce(sale.net_revenue, 0) - coalesce(refund.refunds, 0) as net_revenue,
  coalesce(sale.estimated_profit, 0) as estimated_profit,
  coalesce(refund.refunds, 0) as refunds
from paid_sales sale
full join completed_refunds refund on refund.day = sale.day
with no data;

create unique index management_daily_metrics_day_idx
  on public.management_daily_metrics(day);
revoke all on public.management_daily_metrics from anon, authenticated;

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
      and (coalesce(placed_at, created_at) at time zone 'America/Sao_Paulo')::date
        between p_date_from and p_date_to
  ), previous_orders as materialized (
    select * from scoped_orders
    where payment_status = 'approved'
      and (coalesce(placed_at, created_at) at time zone 'America/Sao_Paulo')::date
        between previous_from and previous_to
  ), completed_refunds as (
    select coalesce(sum(refund.amount), 0) as amount, count(*)::bigint as refund_count
    from public.payment_refunds refund
    join public.payments payment on payment.id = refund.payment_id
    join scoped_orders sale on sale.id = payment.order_id
    where refund.status = 'completed'
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
  ), daily as (
    select jsonb_agg(
      jsonb_build_object(
        'day', day,
        'gross_cents', gross_cents,
        'net_cents', net_cents,
        'orders', order_count
      ) order by day
    ) as series
    from (
      select
        (coalesce(placed_at, created_at) at time zone 'America/Sao_Paulo')::date as day,
        round(sum(grand_total) * 100)::bigint as gross_cents,
        round(sum(grand_total - fee_total - shipping_cost) * 100)::bigint as net_cents,
        count(*)::bigint as order_count
      from filtered_orders
      group by 1
    ) grouped
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

revoke all on function public.manager_dashboard_metrics(date,date,text,uuid,uuid,uuid,uuid,uuid,uuid)
  from public, anon;
grant execute on function public.manager_dashboard_metrics(date,date,text,uuid,uuid,uuid,uuid,uuid,uuid)
  to authenticated;

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
    select sale.*
    from public.orders sale
    where sale.payment_status = 'approved'
      and (coalesce(sale.placed_at, sale.created_at) at time zone 'America/Sao_Paulo')::date
        between p_date_from and p_date_to
  ), previous_orders as materialized (
    select sale.*
    from public.orders sale
    where sale.payment_status = 'approved'
      and (coalesce(sale.placed_at, sale.created_at) at time zone 'America/Sao_Paulo')::date
        between previous_from and previous_to
  ), current_totals as (
    select
      count(*)::bigint as orders,
      round(coalesce(sum(grand_total), 0) * 100)::bigint as gross_cents,
      round(coalesce(sum(grand_total - fee_total - shipping_cost), 0) * 100)::bigint as net_cents,
      round(coalesce(sum(estimated_profit), 0) * 100)::bigint as profit_cents
    from current_orders
  ), previous_totals as (
    select
      count(*)::bigint as orders,
      round(coalesce(sum(grand_total), 0) * 100)::bigint as gross_cents,
      round(coalesce(sum(grand_total - fee_total - shipping_cost), 0) * 100)::bigint as net_cents,
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
          round(sum(grand_total - fee_total - shipping_cost) * 100)::bigint as net_cents,
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

revoke all on function public.manager_strategic_metrics(date, date) from public, anon;
grant execute on function public.manager_strategic_metrics(date, date) to authenticated;

commit;

notify pgrst, 'reload schema';

-- Separate the executive snapshot from strategic analysis without changing existing RPC contracts.

create or replace function public.manager_executive_financial_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('financial.read_summary');

  return jsonb_build_object(
    'receivable_cents', round(coalesce((select sum(amount) from public.accounts_receivable where status = 'pending'), 0) * 100)::bigint,
    'payable_cents', round(coalesce((select sum(amount) from public.accounts_payable where status = 'pending'), 0) * 100)::bigint,
    'overdue_receivable_cents', round(coalesce((select sum(amount) from public.accounts_receivable where status = 'pending' and due_on < (now() at time zone 'America/Sao_Paulo')::date), 0) * 100)::bigint,
    'overdue_payable_cents', round(coalesce((select sum(amount) from public.accounts_payable where status = 'pending' and due_on < (now() at time zone 'America/Sao_Paulo')::date), 0) * 100)::bigint
  );
end;
$$;

revoke all on function public.manager_executive_financial_summary() from public, anon;
grant execute on function public.manager_executive_financial_summary() to authenticated;

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
    select o.*
    from public.orders o
    where (o.created_at at time zone 'America/Sao_Paulo')::date between p_date_from and p_date_to
      and o.status <> 'draft'
  ), previous_orders as materialized (
    select o.*
    from public.orders o
    where (o.created_at at time zone 'America/Sao_Paulo')::date between previous_from and previous_to
      and o.status <> 'draft'
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
    'comparison', jsonb_build_object('current', to_jsonb(ct), 'previous', to_jsonb(pt)),
    'series', coalesce((
      select jsonb_agg(to_jsonb(series_row) order by series_row.day)
      from (
        select
          (created_at at time zone 'America/Sao_Paulo')::date as day,
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
          oi.product_id,
          max(oi.product_name_snapshot) as name,
          coalesce(sum(oi.total) filter (where (o.created_at at time zone 'America/Sao_Paulo')::date between p_date_from and p_date_to), 0)::numeric * 100 as current_revenue_cents,
          coalesce(sum(oi.total) filter (where (o.created_at at time zone 'America/Sao_Paulo')::date between previous_from and previous_to), 0)::numeric * 100 as previous_revenue_cents,
          coalesce(sum(oi.quantity) filter (where (o.created_at at time zone 'America/Sao_Paulo')::date between p_date_from and p_date_to), 0)::bigint as current_units,
          coalesce(sum(oi.quantity) filter (where (o.created_at at time zone 'America/Sao_Paulo')::date between previous_from and previous_to), 0)::bigint as previous_units
        from public.order_items oi
        join public.orders o on o.id = oi.order_id
        where o.status <> 'draft'
          and (o.created_at at time zone 'America/Sao_Paulo')::date between previous_from and p_date_to
        group by oi.product_id
        order by greatest(
          coalesce(sum(oi.total) filter (where (o.created_at at time zone 'America/Sao_Paulo')::date between p_date_from and p_date_to), 0),
          coalesce(sum(oi.total) filter (where (o.created_at at time zone 'America/Sao_Paulo')::date between previous_from and previous_to), 0)
        ) desc
        limit 30
      ) product_row
    ), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(to_jsonb(category_row) order by category_row.current_revenue_cents desc)
      from (
        select
          c.id as category_id,
          c.name,
          round(coalesce(sum(oi.total), 0) * 100)::bigint as current_revenue_cents,
          coalesce(sum(oi.quantity), 0)::bigint as current_units
        from current_orders o
        join public.order_items oi on oi.order_id = o.id
        join public.products p on p.id = oi.product_id
        join public.categories c on c.id = p.category_id
        group by c.id, c.name
        order by current_revenue_cents desc
        limit 12
      ) category_row
    ), '[]'::jsonb),
    'regions', coalesce((
      select jsonb_agg(to_jsonb(region_row) order by region_row.revenue_cents desc)
      from (
        select
          coalesce(nullif(trim(r.region_code), ''), 'Não informada') as name,
          round(coalesce(sum(rs.total_in_cents), 0))::bigint as revenue_cents,
          count(*)::bigint as sales
        from public.representative_sales rs
        join public.representatives r on r.id = rs.representative_id
        where rs.status = 'confirmed'
          and (coalesce(rs.sold_at, rs.created_at) at time zone 'America/Sao_Paulo')::date between p_date_from and p_date_to
        group by 1
        order by revenue_cents desc
        limit 12
      ) region_row
    ), '[]'::jsonb),
    'representatives', coalesce((
      select jsonb_agg(to_jsonb(representative_row) order by representative_row.revenue_cents desc)
      from (
        select
          r.id as representative_id,
          p.full_name as name,
          r.public_code,
          round(coalesce(sum(rs.total_in_cents), 0))::bigint as revenue_cents,
          count(*)::bigint as sales
        from public.representative_sales rs
        join public.representatives r on r.id = rs.representative_id
        join public.profiles p on p.id = r.user_id
        where rs.status = 'confirmed'
          and (coalesce(rs.sold_at, rs.created_at) at time zone 'America/Sao_Paulo')::date between p_date_from and p_date_to
        group by r.id, p.full_name, r.public_code
        order by revenue_cents desc
        limit 12
      ) representative_row
    ), '[]'::jsonb),
    'campaigns', coalesce((
      select jsonb_agg(to_jsonb(campaign_row) order by campaign_row.events desc)
      from (
        select
          cc.id as campaign_id,
          cc.name,
          cc.status::text,
          count(me.id)::bigint as events
        from public.creative_campaigns cc
        left join public.marketing_events me on me.utm_campaign = cc.slug
          and (me.occurred_at at time zone 'America/Sao_Paulo')::date between p_date_from and p_date_to
        where cc.status in ('scheduled', 'published')
           or me.id is not null
        group by cc.id, cc.name, cc.status
        order by events desc
        limit 12
      ) campaign_row
    ), '[]'::jsonb),
    'goals', coalesce((
      select jsonb_agg(to_jsonb(goal_row) order by goal_row.period_end)
      from (
        select
          g.id,
          g.title,
          g.period_start,
          g.period_end,
          g.target,
          coalesce(p.full_name, l.name, 'Escopo gerencial') as scope
        from public.representative_goals g
        left join public.representatives r on r.id = g.representative_id
        left join public.profiles p on p.id = r.user_id
        left join public.representative_levels l on l.id = g.level_id
        where g.active and g.period_start <= p_date_to and g.period_end >= p_date_from
        order by g.period_end
        limit 12
      ) goal_row
    ), '[]'::jsonb)
  ) into result
  from current_totals ct cross join previous_totals pt;

  return result;
end;
$$;

revoke all on function public.manager_strategic_metrics(date, date) from public, anon;
grant execute on function public.manager_strategic_metrics(date, date) to authenticated;

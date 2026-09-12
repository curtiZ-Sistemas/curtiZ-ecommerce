-- Restrict management and homepage rankings to eligible paid orders.
-- Completed partial refunds reduce net revenue once; fully refunded orders are excluded.
begin;

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

revoke all on function public.manager_strategic_metrics(date, date) from public, anon;
grant execute on function public.manager_strategic_metrics(date, date) to authenticated;

create or replace function public.get_homepage_best_sellers(
  p_period text default '90d', p_metric text default 'units', p_limit integer default 8,
  p_fill boolean default true, p_in_stock boolean default true
) returns jsonb language sql stable security definer set search_path = ''
as $$
with parameters as (
 select case when p_period in ('30d','90d','all') then p_period else '90d' end sales_period,
  case when p_metric in ('units','revenue') then p_metric else 'units' end ranking_metric,
  greatest(1,least(coalesce(p_limit,8),24)) result_limit
), qualified_sales as (
 select item.product_id,sum(item.quantity)::bigint units_sold,sum(item.total)::numeric revenue
 from public.order_items item join public.orders sale on sale.id=item.order_id cross join parameters config
 where sale.payment_status='approved'
  and sale.status not in ('draft','pending_payment','cancellation_requested','cancelled','returned','refund_pending','refunded')
  and sale.placed_at is not null
  and (config.sales_period='all' or sale.placed_at>=now()-case config.sales_period when '30d' then interval '30 days' else interval '90 days' end)
 group by item.product_id
), candidates as (
 select item.*,coalesce(sales.units_sold,0) units_sold,coalesce(sales.revenue,0) revenue,
  row_number() over(partition by item.product_id order by case when item.stock>0 then 0 else 1 end,
    md5(item.storefront_key||':curtiz-home-variant')) variant_rank
 from private.storefront_catalog_items() item
 left join qualified_sales sales on sales.product_id=item.product_id
 where (not p_in_stock or item.stock>0) and (p_fill or coalesce(sales.units_sold,0)>0)
), ranked as (
 select candidate.* from candidates candidate cross join parameters config
 where candidate.variant_rank=1
 order by case when candidate.units_sold>0 then 0 else 1 end,
  case when config.ranking_metric='units' then candidate.units_sold end desc,
  case when config.ranking_metric='revenue' then candidate.revenue end desc,
  candidate.units_sold desc,md5(candidate.product_id::text||':curtiz-home-fallback')
 limit (select result_limit from parameters)
)
select coalesce(jsonb_agg(jsonb_build_object(
 'id',product_id,'storefrontKey',storefront_key,'variantId',variant_id,'sku',sku,
 'variantColor',variant_color,'variantSize',variant_size,'slug',slug,'name',display_name,
 'category',category,'description',description,'priceInCents',price_cents,
 'compareAtPriceInCents',compare_at_price_cents,'rating',rating,'reviews',reviews,
 'colors',colors,'sizes',sizes,'imagePath',image_path,'featured',featured,'stock',stock
) order by case when units_sold>0 then 0 else 1 end,
 case when (select ranking_metric from parameters)='units' then units_sold end desc,
 case when (select ranking_metric from parameters)='revenue' then revenue end desc,
 units_sold desc,md5(product_id::text||':curtiz-home-fallback')),'[]'::jsonb) from ranked
$$;

revoke all on function public.get_homepage_best_sellers(text,text,integer,boolean,boolean) from public;
grant execute on function public.get_homepage_best_sellers(text,text,integer,boolean,boolean) to anon,authenticated;


create or replace function private.storefront_catalog_items()
returns table (
  product_id uuid,
  variant_id uuid,
  storefront_key text,
  slug text,
  display_name text,
  base_name text,
  category_id uuid,
  category text,
  category_slug text,
  collection text,
  collection_slug text,
  model_slug text,
  description text,
  price_cents integer,
  compare_at_price_cents integer,
  featured boolean,
  created_at timestamptz,
  colors text[],
  sizes text[],
  stock integer,
  rating numeric,
  reviews integer,
  sold_count integer,
  image_path text,
  sku text,
  variant_color text,
  variant_size text
)
language sql
stable
security definer
set search_path = ''
as $$
  with product_data as (
    select
      product.id,
      product.slug,
      product.name,
      category.id as category_id,
      category.name as category,
      category.slug as category_slug,
      coalesce(collection.name, '') as collection,
      coalesce(collection.slug, '') as collection_slug,
      coalesce(model.slug, '') as model_slug,
      product.short_description as description,
      product.base_price,
      product.compare_at_price,
      product.featured,
      product.created_at,
      coalesce(variants.colors, '{}'::text[]) as colors,
      coalesce(variants.sizes, '{}'::text[]) as sizes,
      coalesce(variants.stock, 0) as stock,
      coalesce(review_summary.rating, 0) as rating,
      coalesce(review_summary.reviews, 0) as reviews,
      coalesce(sales.sold_count, 0) as sold_count,
      generic_image.storage_path as generic_image_path
    from public.products product
    join public.categories category on category.id = product.category_id and category.active
    left join public.collections collection on collection.id = product.collection_id
    left join public.product_models model on model.id = product.model_id
    left join lateral (
      select
        array_agg(distinct variant.color_name order by variant.color_name) as colors,
        array_agg(distinct variant.size order by variant.size) as sizes,
        sum(greatest(coalesce(inventory.available_quantity, 0) - coalesce(inventory.reserved_quantity, 0), 0))::integer as stock
      from public.product_variants variant
      left join public.inventory inventory on inventory.variant_id = variant.id
      where variant.product_id = product.id and variant.active
    ) variants on true
    left join lateral (
      select round(avg(review.rating)::numeric, 1) as rating, count(*)::integer as reviews
      from public.reviews review
      where review.product_id = product.id and review.status = 'approved'
    ) review_summary on true
    left join lateral (
      select sum(item.quantity)::integer as sold_count
      from public.order_items item
      join public.orders sale on sale.id = item.order_id
      where item.product_id = product.id
        and sale.payment_status = 'approved'
        and sale.status not in ('draft', 'pending_payment', 'cancellation_requested', 'cancelled', 'returned', 'refund_pending', 'refunded')
    ) sales on true
    left join lateral (
      select image.storage_path
      from public.product_images image
      where image.product_id = product.id
        and image.variant_id is null
        and nullif(trim(image.storage_path), '') is not null
      order by image.is_primary desc, image.sort_order, image.created_at
      limit 1
    ) generic_image on true
    where product.status = 'active'
  ),
  visual_variants as (
    select
      product.id as product_id,
      variant.id as variant_id,
      product.id::text || ':' || variant.id::text as storefront_key,
      product.slug,
      product.name || ' — ' || variant.color_name || case
        when count(*) over(partition by product.id, lower(variant.color_name)) > 1
          then ' — ' || variant.size
        else ''
      end as display_name,
      product.name as base_name,
      product.category_id,
      product.category,
      product.category_slug,
      product.collection,
      product.collection_slug,
      product.model_slug,
      product.description,
      round(coalesce(variant.price_override, product.base_price) * 100)::integer as price_cents,
      case
        when product.compare_at_price > coalesce(variant.price_override, product.base_price)
          then round(product.compare_at_price * 100)::integer
        else null
      end as compare_at_price_cents,
      product.featured,
      product.created_at,
      array[variant.color_name]::text[] as colors,
      array[variant.size]::text[] as sizes,
      greatest(coalesce(inventory.available_quantity, 0) - coalesce(inventory.reserved_quantity, 0), 0)::integer as stock,
      product.rating,
      product.reviews,
      product.sold_count,
      variant_image.storage_path as image_path,
      variant.sku::text as sku,
      variant.color_name as variant_color,
      variant.size as variant_size
    from product_data product
    join public.product_variants variant on variant.product_id = product.id and variant.active
    left join public.inventory inventory on inventory.variant_id = variant.id
    join lateral (
      select image.storage_path
      from public.product_images image
      where image.product_id = product.id
        and image.variant_id = variant.id
        and nullif(trim(image.storage_path), '') is not null
        and image.width > 0 and image.height > 0
      order by image.is_primary desc, image.sort_order, image.created_at
      limit 1
    ) variant_image on true
  ),
  fallback_products as (
    select
      product.id as product_id,
      null::uuid as variant_id,
      product.id::text || ':product' as storefront_key,
      product.slug,
      product.name as display_name,
      product.name as base_name,
      product.category_id,
      product.category,
      product.category_slug,
      product.collection,
      product.collection_slug,
      product.model_slug,
      product.description,
      round(product.base_price * 100)::integer as price_cents,
      case when product.compare_at_price > product.base_price
        then round(product.compare_at_price * 100)::integer else null end as compare_at_price_cents,
      product.featured,
      product.created_at,
      product.colors,
      product.sizes,
      product.stock,
      product.rating,
      product.reviews,
      product.sold_count,
      product.generic_image_path as image_path,
      null::text as sku,
      null::text as variant_color,
      null::text as variant_size
    from product_data product
    where not exists (
      select 1 from visual_variants visual where visual.product_id = product.id
    )
  )
  select * from visual_variants
  union all
  select * from fallback_products;
$$;

revoke all on function private.storefront_catalog_items() from public, anon, authenticated;

commit;
notify pgrst, 'reload schema';

-- Gerência Curtiz: acesso estratégico, métricas agregadas e fechamento auditado.

insert into public.permissions(code, description) values
  ('financial.read_summary', 'Ler indicadores financeiros agregados'),
  ('financial.read_full', 'Ler lançamentos financeiros'),
  ('finance.reconcile', 'Conciliar pagamentos'),
  ('finance.close_period', 'Fechar períodos financeiros'),
  ('finance.reopen_period', 'Reabrir períodos financeiros com justificativa'),
  ('promotions.approve', 'Aprovar campanhas e promoções'),
  ('reports.export', 'Exportar relatórios gerenciais')
on conflict (code) do update set description = excluded.description;

insert into public.role_permissions(role, permission_id)
select 'manager', id
from public.permissions
where code in (
  'orders.read_all',
  'products.read',
  'inventory.read',
  'inventory.approve_adjustment',
  'financial.read_summary',
  'financial.read_full',
  'finance.reconcile',
  'finance.close_period',
  'finance.reopen_period',
  'promotions.approve',
  'reports.export',
  'audit.read',
  'users.read',
  'banners.update',
  'content.manage'
)
on conflict do nothing;

create policy "management reads financial closures" on public.financial_closures
  for select to authenticated
  using (private.has_permission('finance.close_period'));

create policy "management reads commercial policies" on public.commercial_policies
  for select to authenticated
  using (private.has_permission('financial.read_summary'));

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

  with filtered_orders as materialized (
    select o.*
    from public.orders o
    where (o.created_at at time zone 'America/Sao_Paulo')::date between p_date_from and p_date_to
      and (
        p_product_id is null and p_category_id is null and p_model_id is null
        or exists (
          select 1
          from public.order_items oi
          join public.products p on p.id = oi.product_id
          where oi.order_id = o.id
            and (p_product_id is null or p.id = p_product_id)
            and (p_category_id is null or p.category_id = p_category_id)
            and (p_model_id is null or p.model_id = p_model_id)
        )
      )
      and (
        p_region is null and p_representative_id is null and p_level_id is null
        or exists (
          select 1
          from public.representative_sales rs
          join public.representatives r on r.id = rs.representative_id
          where rs.order_id = o.id
            and (p_region is null or r.region_code = p_region)
            and (p_representative_id is null or r.id = p_representative_id)
            and (p_level_id is null or r.current_level_id = p_level_id)
        )
      )
      and (
        p_campaign_id is null
        or exists (
          select 1
          from public.marketing_events me
          join public.creative_campaigns cc
            on cc.id = p_campaign_id and cc.slug = me.utm_campaign
          where me.order_id = o.id
        )
      )
  ), previous_orders as materialized (
    select o.*
    from public.orders o
    where (o.created_at at time zone 'America/Sao_Paulo')::date between previous_from and previous_to
      and (
        p_product_id is null and p_category_id is null and p_model_id is null
        or exists (
          select 1 from public.order_items oi
          join public.products p on p.id = oi.product_id
          where oi.order_id = o.id
            and (p_product_id is null or p.id = p_product_id)
            and (p_category_id is null or p.category_id = p_category_id)
            and (p_model_id is null or p.model_id = p_model_id)
        )
      )
      and (
        p_region is null and p_representative_id is null and p_level_id is null
        or exists (
          select 1 from public.representative_sales rs
          join public.representatives r on r.id = rs.representative_id
          where rs.order_id = o.id
            and (p_region is null or r.region_code = p_region)
            and (p_representative_id is null or r.id = p_representative_id)
            and (p_level_id is null or r.current_level_id = p_level_id)
        )
      )
      and (
        p_campaign_id is null
        or exists (
          select 1 from public.marketing_events me
          join public.creative_campaigns cc
            on cc.id = p_campaign_id and cc.slug = me.utm_campaign
          where me.order_id = o.id
        )
      )
  ), current_totals as (
    select
      count(*)::bigint as order_count,
      round(coalesce(sum(grand_total), 0) * 100)::bigint as gross_cents,
      round(coalesce(sum(grand_total - fee_total - shipping_cost), 0) * 100)::bigint as net_cents,
      round(coalesce(sum(estimated_profit), 0) * 100)::bigint as estimated_profit_cents,
      round(coalesce(sum(case when payment_status = 'refunded' then grand_total else 0 end), 0) * 100)::bigint as refunds_cents,
      round(coalesce(avg(grand_total), 0) * 100)::bigint as average_ticket_cents
    from filtered_orders
    where status <> 'draft'
  ), previous_totals as (
    select round(coalesce(sum(grand_total), 0) * 100)::bigint as gross_cents
    from previous_orders
    where status <> 'draft'
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
        (created_at at time zone 'America/Sao_Paulo')::date as day,
        round(sum(grand_total) * 100)::bigint as gross_cents,
        round(sum(grand_total - fee_total - shipping_cost) * 100)::bigint as net_cents,
        count(*)::bigint as order_count
      from filtered_orders
      where status <> 'draft'
      group by 1
    ) grouped
  )
  select jsonb_build_object(
    'period', jsonb_build_object('from', p_date_from, 'to', p_date_to),
    'gross_cents', ct.gross_cents,
    'net_cents', ct.net_cents,
    'estimated_profit_cents', ct.estimated_profit_cents,
    'refunds_cents', ct.refunds_cents,
    'average_ticket_cents', ct.average_ticket_cents,
    'orders', ct.order_count,
    'gross_change_percent', case
      when pt.gross_cents = 0 then null
      else round(((ct.gross_cents - pt.gross_cents)::numeric / pt.gross_cents) * 100, 1)
    end,
    'series', coalesce(d.series, '[]'::jsonb),
    'overview', jsonb_build_object(
      'customers', (
        select count(*) from public.profiles p
        where (p.created_at at time zone 'America/Sao_Paulo')::date between p_date_from and p_date_to
          and not exists (
            select 1 from public.user_roles ur
            where ur.user_id = p.id and ur.role in ('operational', 'admin', 'manager', 'technical', 'representative')
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
      'refunds_in_period', (select count(*) from filtered_orders where payment_status = 'refunded')
    )
  ) into result
  from current_totals ct cross join previous_totals pt cross join daily d;

  return result;
end;
$$;

revoke all on function public.manager_dashboard_metrics(date,date,text,uuid,uuid,uuid,uuid,uuid,uuid) from public, anon;
grant execute on function public.manager_dashboard_metrics(date,date,text,uuid,uuid,uuid,uuid,uuid,uuid) to authenticated;

create or replace function public.manager_create_commission_simulation(
  p_period_start date,
  p_period_end date
)
returns public.commission_closings
language plpgsql
security definer
set search_path = ''
as $$
declare
  closing public.commission_closings;
begin
  perform private.require_permission('representatives.commissions.close');
  if p_period_start is null or p_period_end is null or p_period_end < p_period_start then
    raise exception 'invalid commission period';
  end if;

  insert into public.commission_closings(period_start, period_end, simulated_by)
  values (p_period_start, p_period_end, auth.uid())
  returning * into closing;

  insert into public.commission_closing_entries(closing_id, commission_entry_id, amount_in_cents)
  select closing.id, ce.id, ce.commission_in_cents
  from public.commission_entries ce
  where ce.status in ('approved', 'payable')
    and (ce.created_at at time zone 'America/Sao_Paulo')::date between p_period_start and p_period_end
    and not exists (
      select 1 from public.commission_closing_entries existing
      where existing.commission_entry_id = ce.id
    );

  update public.commission_closings
  set totals_snapshot = jsonb_build_object(
    'entries', (select count(*) from public.commission_closing_entries where closing_id = closing.id),
    'amount_in_cents', coalesce((select sum(amount_in_cents) from public.commission_closing_entries where closing_id = closing.id), 0)
  )
  where id = closing.id
  returning * into closing;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, new_data_sanitized, reason)
  values (auth.uid(), 'manager', 'commission_closing.simulated', 'commission_closings', closing.id, to_jsonb(closing), 'Simulação gerencial solicitada');

  return closing;
end;
$$;

create or replace function public.manager_transition_commission_closing(
  p_closing_id uuid,
  p_action text,
  p_reason text default null
)
returns public.commission_closings
language plpgsql
security definer
set search_path = ''
as $$
declare
  closing public.commission_closings;
  previous_closing public.commission_closings;
begin
  perform private.require_permission('representatives.commissions.close');
  select * into previous_closing from public.commission_closings where id = p_closing_id for update;
  if previous_closing.id is null then raise exception 'closing not found' using errcode = 'P0002'; end if;

  if p_action = 'submit' and previous_closing.status in ('simulating', 'reopened') then
    update public.commission_closings set status = 'pending_approval' where id = p_closing_id returning * into closing;
  elsif p_action = 'approve' and previous_closing.status = 'pending_approval' then
    update public.commission_closings set status = 'approved', approved_by = auth.uid() where id = p_closing_id returning * into closing;
  elsif p_action = 'lock' and previous_closing.status = 'approved' then
    update public.commission_closings set status = 'locked', locked_at = now() where id = p_closing_id returning * into closing;
    update public.commission_entries ce
      set status = 'payable', approved_at = coalesce(approved_at, now())
      from public.commission_closing_entries cce
      where cce.closing_id = p_closing_id and cce.commission_entry_id = ce.id and ce.status = 'approved';
  elsif p_action = 'reopen' and previous_closing.status in ('locked', 'paid') then
    if nullif(trim(p_reason), '') is null or char_length(trim(p_reason)) < 3 then
      raise exception 'reopen reason is required';
    end if;
    update public.commission_closings
      set status = 'reopened', reopen_reason = trim(p_reason)
      where id = p_closing_id returning * into closing;
  else
    raise exception 'invalid closing transition';
  end if;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, previous_data_sanitized, new_data_sanitized, reason)
  values (auth.uid(), 'manager', 'commission_closing.' || p_action, 'commission_closings', p_closing_id, to_jsonb(previous_closing), to_jsonb(closing), nullif(trim(p_reason), ''));

  return closing;
end;
$$;

revoke all on function public.manager_create_commission_simulation(date,date) from public, anon;
grant execute on function public.manager_create_commission_simulation(date,date) to authenticated;
revoke all on function public.manager_transition_commission_closing(uuid,text,text) from public, anon;
grant execute on function public.manager_transition_commission_closing(uuid,text,text) to authenticated;

create or replace function public.manager_restore_homepage_section(
  p_version_id uuid,
  p_reason text
)
returns public.homepage_sections
language plpgsql
security definer
set search_path = ''
as $$
declare
  version_row public.homepage_section_versions;
  previous_section public.homepage_sections;
  restored_section public.homepage_sections;
begin
  perform private.require_permission('content.manage');
  if nullif(trim(p_reason), '') is null or char_length(trim(p_reason)) < 3 then
    raise exception 'restore reason is required';
  end if;

  select * into version_row
  from public.homepage_section_versions
  where id = p_version_id;
  if version_row.id is null then raise exception 'homepage version not found' using errcode = 'P0002'; end if;

  select * into previous_section
  from public.homepage_sections
  where id = version_row.section_id
  for update;
  if previous_section.id is null then raise exception 'homepage section not found' using errcode = 'P0002'; end if;

  update public.homepage_sections
  set
    section_type = version_row.snapshot->>'section_type',
    title = version_row.snapshot->>'title',
    subtitle = version_row.snapshot->>'subtitle',
    settings = coalesce(version_row.snapshot->'settings', '{}'::jsonb),
    active = coalesce((version_row.snapshot->>'active')::boolean, false),
    starts_at = nullif(version_row.snapshot->>'starts_at', '')::timestamptz,
    ends_at = nullif(version_row.snapshot->>'ends_at', '')::timestamptz,
    sort_order = coalesce((version_row.snapshot->>'sort_order')::integer, 0),
    updated_by = auth.uid(),
    updated_at = now()
  where id = version_row.section_id
  returning * into restored_section;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, previous_data_sanitized, new_data_sanitized, reason)
  values (auth.uid(), 'manager', 'homepage_section.restored', 'homepage_sections', restored_section.id, to_jsonb(previous_section), to_jsonb(restored_section), trim(p_reason));

  return restored_section;
end;
$$;

revoke all on function public.manager_restore_homepage_section(uuid,text) from public, anon;
grant execute on function public.manager_restore_homepage_section(uuid,text) to authenticated;

create or replace function public.manager_can_export()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_permission('reports.export');
$$;

create or replace function public.manager_log_export(
  p_resource text,
  p_filters jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('reports.export');
  if p_resource not in ('financeiro', 'pedidos-vendas', 'kits', 'comissoes', 'fechamentos', 'pagamentos', 'auditoria') then
    raise exception 'resource export is not allowed' using errcode = '42501';
  end if;
  insert into public.audit_logs(actor_id, actor_role, action, entity_type, new_data_sanitized, reason)
  values (auth.uid(), 'manager', 'report.exported', 'manager_report', jsonb_build_object('resource', p_resource, 'filters', coalesce(p_filters, '{}'::jsonb)), 'Exportação gerencial solicitada');
end;
$$;

create or replace function public.manager_transition_representative(
  p_representative_id uuid,
  p_action text,
  p_reason text
)
returns public.representatives
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_representative public.representatives;
  updated_representative public.representatives;
  next_status public.representative_status;
begin
  perform private.require_permission('representatives.manage');
  if nullif(trim(p_reason), '') is null or char_length(trim(p_reason)) < 3 then
    raise exception 'representative status reason is required';
  end if;

  select * into previous_representative
  from public.representatives
  where id = p_representative_id
  for update;
  if previous_representative.id is null then raise exception 'representative not found' using errcode = 'P0002'; end if;

  if p_action = 'suspend' and previous_representative.status in ('active', 'inactive', 'unqualified') then
    next_status := 'suspended';
  elsif p_action = 'reactivate' and previous_representative.status in ('suspended', 'inactive') then
    next_status := case when previous_representative.activated_at is null then 'approved_waiting_kit' else 'active' end;
  else
    raise exception 'invalid representative transition';
  end if;

  update public.representatives
  set status = next_status,
      status_reason = trim(p_reason),
      suspended_at = case when next_status = 'suspended' then now() else null end,
      updated_at = now()
  where id = p_representative_id
  returning * into updated_representative;

  insert into public.representative_status_history(representative_id, previous_status, new_status, reason, changed_by)
  values (p_representative_id, previous_representative.status, next_status, trim(p_reason), auth.uid());

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, previous_data_sanitized, new_data_sanitized, reason)
  values (auth.uid(), 'manager', 'representative.' || p_action, 'representatives', p_representative_id, to_jsonb(previous_representative), to_jsonb(updated_representative), trim(p_reason));

  return updated_representative;
end;
$$;

revoke all on function public.manager_can_export() from public, anon;
grant execute on function public.manager_can_export() to authenticated;
revoke all on function public.manager_log_export(text,jsonb) from public, anon;
grant execute on function public.manager_log_export(text,jsonb) to authenticated;
revoke all on function public.manager_transition_representative(uuid,text,text) from public, anon;
grant execute on function public.manager_transition_representative(uuid,text,text) to authenticated;

create table public.creative_campaign_approvals (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.creative_campaigns(id) on delete cascade,
  reviewer_id uuid not null references public.profiles(id),
  decision text not null check (decision in ('approve', 'reject')),
  reason text not null check (char_length(reason) between 3 and 1000),
  approval_order smallint not null check (approval_order in (1, 2)),
  created_at timestamptz not null default now(),
  unique(campaign_id, reviewer_id, decision)
);

alter table public.creative_campaign_approvals enable row level security;
alter table public.creative_campaign_approvals force row level security;

create policy "campaign approvals authorized read" on public.creative_campaign_approvals
  for select to authenticated using (private.has_permission('creatives.approve'));
create policy "campaign approvals authorized insert" on public.creative_campaign_approvals
  for insert to authenticated with check (reviewer_id = auth.uid() and private.has_permission('creatives.approve'));

create or replace function public.manager_transition_creative_campaign(
  p_campaign_id uuid,
  p_status public.creative_status,
  p_reason text
)
returns public.creative_campaigns
language plpgsql
security definer
set search_path = ''
as $$
declare
  campaign public.creative_campaigns;
  previous_campaign public.creative_campaigns;
  approval_count integer;
  next_order smallint;
begin
  if nullif(trim(p_reason), '') is null or char_length(trim(p_reason)) < 3 then
    raise exception 'campaign transition reason required';
  end if;
  select * into campaign from public.creative_campaigns where id = p_campaign_id for update;
  previous_campaign := campaign;
  if campaign.id is null then raise exception 'campaign not found' using errcode = 'P0002'; end if;

  if p_status = 'pending_review' then
    perform private.require_permission('creatives.manage');
    if campaign.status <> 'draft' then raise exception 'invalid campaign transition'; end if;
    if campaign.approval_mode = 'disabled' then p_status := 'approved'; end if;
  elsif p_status in ('approved', 'rejected') then
    perform private.require_permission('creatives.approve');
    if campaign.status <> 'pending_review' then raise exception 'invalid campaign transition'; end if;
    select count(*)::integer + 1 into next_order
    from public.creative_campaign_approvals
    where campaign_id = campaign.id and decision = 'approve';
    insert into public.creative_campaign_approvals(campaign_id, reviewer_id, decision, reason, approval_order)
    values (campaign.id, auth.uid(), case when p_status = 'approved' then 'approve' else 'reject' end, trim(p_reason), least(next_order, 2));
    if p_status = 'approved' then
      select count(distinct reviewer_id)::integer into approval_count
      from public.creative_campaign_approvals
      where campaign_id = campaign.id and decision = 'approve';
      if campaign.approval_mode = 'double' and approval_count < 2 then
        insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, new_data_sanitized, reason)
        values (auth.uid(), 'manager', 'creative_campaign.approval_recorded', 'creative_campaigns', campaign.id, jsonb_build_object('approval_count', approval_count, 'required', 2), trim(p_reason));
        return campaign;
      end if;
    end if;
  elsif p_status = 'scheduled' then
    perform private.require_permission('creatives.publish');
    if campaign.status <> 'approved' or campaign.starts_at is null or campaign.starts_at <= now() then
      raise exception 'campaign schedule requires approval and a future start';
    end if;
  elsif p_status = 'published' then
    perform private.require_permission('creatives.publish');
    if campaign.status not in ('approved', 'scheduled') then raise exception 'campaign is not approved'; end if;
  elsif p_status = 'archived' then
    perform private.require_permission('creatives.publish');
  else
    raise exception 'unsupported campaign transition';
  end if;

  update public.creative_campaigns
  set status = p_status,
      published_by = case when p_status = 'published' then auth.uid() else published_by end,
      updated_at = now()
  where id = campaign.id
  returning * into campaign;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, previous_data_sanitized, new_data_sanitized, reason)
  values (auth.uid(), 'manager', 'creative_campaign.transition', 'creative_campaigns', campaign.id, to_jsonb(previous_campaign), to_jsonb(campaign), trim(p_reason));
  return campaign;
end;
$$;

revoke all on function public.manager_transition_creative_campaign(uuid,public.creative_status,text) from public, anon;
grant execute on function public.manager_transition_creative_campaign(uuid,public.creative_status,text) to authenticated;

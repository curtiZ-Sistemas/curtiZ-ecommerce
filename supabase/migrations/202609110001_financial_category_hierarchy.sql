-- Plano de contas simplificado sobre as categorias financeiras existentes.
-- Categorias antigas permanecem analiticas, ativas e sem grupo.
-- Relatorios historicos usam o parent_id atual: mover a subconta reclassifica a agregacao,
-- sem alterar, copiar ou duplicar contas e lancamentos historicos.

alter table public.financial_categories
  add column code text,
  add column parent_id uuid references public.financial_categories(id) on delete restrict,
  add column is_group boolean not null default false,
  add column sort_order integer not null default 0,
  add column updated_by uuid references public.profiles(id);

update public.financial_categories set updated_by = created_by where updated_by is null;
alter table public.financial_categories alter column updated_by set not null;

alter table public.financial_categories
  add constraint financial_categories_code_format check (
    code is null or (char_length(trim(code)) between 1 and 40 and code = trim(code))
  ),
  add constraint financial_categories_parent_shape check (
    (is_group and parent_id is null) or not is_group
  ),
  add constraint financial_categories_sort_order check (sort_order between 0 and 100000);

create unique index financial_categories_code_unique
  on public.financial_categories(lower(code)) where code is not null;
create index financial_categories_parent_idx on public.financial_categories(parent_id, sort_order, name);
create index financial_categories_kind_active_idx on public.financial_categories(kind, active, is_group);
create index accounts_receivable_category_idx on public.accounts_receivable(category_id);
create index accounts_payable_category_idx on public.accounts_payable(category_id);
create index financial_transactions_category_period_idx
  on public.financial_transactions(category_id, occurred_on) where reversed_at is null;

create or replace function private.validate_financial_category()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_row public.financial_categories%rowtype;
begin
  new.name := trim(new.name);
  new.code := nullif(trim(new.code), '');
  if tg_op = 'UPDATE' then
    new.updated_by := coalesce(auth.uid(), new.updated_by, old.updated_by, new.created_by);
  else
    new.updated_by := coalesce(auth.uid(), new.updated_by, new.created_by);
  end if;

  if new.parent_id = new.id then
    raise exception 'financial category cannot be its own parent';
  end if;
  if new.is_group and new.parent_id is not null then
    raise exception 'financial groups must be root categories';
  end if;

  if new.parent_id is not null then
    select * into parent_row from public.financial_categories where id = new.parent_id;
    if parent_row.id is null or not parent_row.is_group then
      raise exception 'financial category parent must be a group';
    end if;
    if parent_row.kind <> 'both' and new.kind <> parent_row.kind then
      raise exception 'financial category kind is incompatible with its group';
    end if;
  end if;

  if new.is_group and exists (
    select 1 from public.accounts_receivable where category_id = new.id
    union all select 1 from public.accounts_payable where category_id = new.id
    union all select 1 from public.financial_transactions where category_id = new.id
    union all select 1 from public.partner_contributions where category_id = new.id
  ) then
    raise exception 'a category with financial history cannot become a group';
  end if;

  if new.is_group and not new.active and exists (
    select 1 from public.financial_categories child
    where child.parent_id = new.id and child.active
  ) then
    raise exception 'a group with active subaccounts cannot be deactivated';
  end if;

  if new.is_group and exists (
    select 1 from public.financial_categories child
    where child.parent_id = new.id
      and new.kind <> 'both'
      and child.kind <> new.kind
  ) then
    raise exception 'financial group kind is incompatible with its subaccounts';
  end if;

  return new;
end;
$$;

create trigger validate_financial_category
before insert or update on public.financial_categories
for each row execute function private.validate_financial_category();

create or replace function private.prevent_financial_category_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists(select 1 from public.financial_categories where parent_id = old.id)
    or exists(select 1 from public.accounts_receivable where category_id = old.id)
    or exists(select 1 from public.accounts_payable where category_id = old.id)
    or exists(select 1 from public.financial_transactions where category_id = old.id)
    or exists(select 1 from public.partner_contributions where category_id = old.id) then
    raise exception 'financial category has children or history; deactivate it instead';
  end if;
  return old;
end;
$$;

create trigger prevent_financial_category_delete
before delete on public.financial_categories
for each row execute function private.prevent_financial_category_delete();

create or replace function private.validate_financial_category_assignment()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  expected_kind text := case
    when tg_argv[0] = 'transaction' then to_jsonb(new)->>'type'
    else tg_argv[0]
  end;
begin
  if new.category_id is null then return new; end if;
  if not exists (
    select 1 from public.financial_categories category
    where category.id = new.category_id
      and category.active
      and not category.is_group
      and category.kind in (expected_kind, 'both')
  ) then
    raise exception 'invalid analytic financial category';
  end if;
  return new;
end;
$$;

create trigger validate_receivable_category
before insert or update of category_id on public.accounts_receivable
for each row execute function private.validate_financial_category_assignment('income');
create trigger validate_payable_category
before insert or update of category_id on public.accounts_payable
for each row execute function private.validate_financial_category_assignment('expense');
create trigger validate_transaction_category
before insert or update of category_id, type on public.financial_transactions
for each row execute function private.validate_financial_category_assignment('transaction');
create trigger validate_contribution_category
before insert or update of category_id on public.partner_contributions
for each row execute function private.validate_financial_category_assignment('income');

alter function public.financial_control_snapshot(date, date)
  rename to financial_control_snapshot_flat_v1;
revoke all on function public.financial_control_snapshot_flat_v1(date, date) from public, anon, authenticated;

create or replace function public.financial_control_snapshot(p_date_from date, p_date_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
      from public.financial_transactions
      where reversed_at is null and occurred_on between p_date_from and p_date_to
      group by category_id
    ) tx on tx.category_id = c.id
    left join (
      select category_id, sum(amount) as projected,
        sum(amount) filter (where due_on < (now() at time zone 'America/Sao_Paulo')::date) as overdue
      from public.accounts_payable
      where status = 'pending' and due_on between p_date_from and p_date_to
      group by category_id
    ) ap on ap.category_id = c.id
    left join (
      select category_id, sum(amount) as projected,
        sum(amount) filter (where due_on < (now() at time zone 'America/Sao_Paulo')::date) as overdue
      from public.accounts_receivable
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
    ) order by r.due_on desc) from public.accounts_receivable r
      join public.financial_categories c on c.id=r.category_id
      left join public.financial_categories g on g.id=c.parent_id
      left join public.financial_accounts a on a.id=r.destination_account_id
      left join public.profiles pr on pr.id=r.created_by), '[]'::jsonb),
    'payables', coalesce((select jsonb_agg(to_jsonb(p) || jsonb_build_object(
      'display_status', case when p.status='pending' and p.due_on < (now() at time zone 'America/Sao_Paulo')::date then 'overdue' else p.status end,
      'category_name', case when g.id is null then c.name else g.name || ' > ' || c.name end,
      'category_code', c.code, 'group_id', g.id, 'group_name', g.name, 'subcategory_name', c.name,
      'account_name', a.name, 'responsible_name', pr.full_name
    ) order by p.due_on desc) from public.accounts_payable p
      join public.financial_categories c on c.id=p.category_id
      left join public.financial_categories g on g.id=c.parent_id
      left join public.financial_accounts a on a.id=p.source_account_id
      left join public.profiles pr on pr.id=p.created_by), '[]'::jsonb),
    'transactions', coalesce((select jsonb_agg(to_jsonb(t) || jsonb_build_object(
      'category_name', case when g.id is null then c.name else g.name || ' > ' || c.name end,
      'category_code', c.code, 'group_id', g.id, 'group_name', g.name, 'subcategory_name', c.name,
      'account_name', a.name, 'responsible_name', pr.full_name
    ) order by t.occurred_on desc,t.created_at desc) from public.financial_transactions t
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
$$;

alter function public.financial_control_mutate(text, jsonb)
  rename to financial_control_mutate_flat_v1;
revoke all on function public.financial_control_mutate_flat_v1(text, jsonb) from public, anon, authenticated;

create or replace function public.financial_control_mutate(p_action text, p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  entity_id uuid;
  old_row jsonb;
  new_row jsonb;
  category_kind text;
  category_parent uuid;
  category_is_group boolean;
  expected_kind text;
begin
  perform private.require_permission('finance.manage');
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'invalid payload'; end if;

  if p_action = 'category.save' then
    entity_id := nullif(p_payload->>'id','')::uuid;
    category_kind := coalesce(nullif(p_payload->>'kind',''),'both');
    category_parent := nullif(p_payload->>'parent_id','')::uuid;
    category_is_group := coalesce((p_payload->>'is_group')::boolean, false);
    if category_kind not in ('income','expense','both') then raise exception 'invalid category kind'; end if;
    if entity_id is null then
      insert into public.financial_categories(
        name, code, kind, parent_id, is_group, sort_order, active, created_by, updated_by
      ) values (
        trim(p_payload->>'name'), nullif(trim(p_payload->>'code'), ''), category_kind,
        category_parent, category_is_group, coalesce((p_payload->>'sort_order')::integer, 0),
        coalesce((p_payload->>'active')::boolean, true), actor, actor
      ) returning id, to_jsonb(financial_categories) into entity_id, new_row;
    else
      select to_jsonb(c) into old_row from public.financial_categories c where id=entity_id for update;
      update public.financial_categories set
        name=trim(p_payload->>'name'), code=nullif(trim(p_payload->>'code'), ''),
        kind=category_kind, parent_id=category_parent, is_group=category_is_group,
        sort_order=coalesce((p_payload->>'sort_order')::integer, sort_order),
        active=coalesce((p_payload->>'active')::boolean, active), updated_by=actor
      where id=entity_id returning to_jsonb(financial_categories) into new_row;
    end if;
    if new_row is null then raise exception 'financial category not found'; end if;
    insert into public.audit_logs(
      actor_id,actor_role,action,entity_type,entity_id,
      previous_data_sanitized,new_data_sanitized,reason
    ) values (
      actor,private.current_app_role(),p_action,
      case when category_is_group then 'financial.category_group' else 'financial.subaccount' end,
      entity_id,old_row,new_row,nullif(trim(p_payload->>'reason'),'')
    );
    return jsonb_build_object('id',entity_id,'action',p_action);
  end if;

  if p_action in ('receivable.create','receivable.update') then expected_kind := 'income'; end if;
  if p_action in ('payable.create','payable.update') then expected_kind := 'expense'; end if;
  if p_action = 'transaction.save' and nullif(p_payload->>'category_id','') is not null then expected_kind := p_payload->>'type'; end if;
  if p_action = 'contribution.save' and nullif(p_payload->>'category_id','') is not null then expected_kind := 'income'; end if;
  if expected_kind is not null and not exists (
    select 1 from public.financial_categories c
    where c.id=(p_payload->>'category_id')::uuid and c.active and not c.is_group
      and c.kind in (expected_kind,'both')
  ) then
    raise exception 'invalid analytic financial category';
  end if;

  return public.financial_control_mutate_flat_v1(p_action, p_payload);
end;
$$;

revoke all on function public.financial_control_snapshot(date,date) from public, anon;
grant execute on function public.financial_control_snapshot(date,date) to authenticated;
revoke all on function public.financial_control_mutate(text,jsonb) from public, anon;
grant execute on function public.financial_control_mutate(text,jsonb) to authenticated;

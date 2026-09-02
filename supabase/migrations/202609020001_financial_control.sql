-- Controle financeiro compartilhado do painel gerencial.

insert into public.permissions(code, description) values
  ('finance.manage', 'Gerenciar contas, lançamentos, aportes e configurações financeiras')
on conflict (code) do update set description = excluded.description;

insert into public.role_permissions(role, permission_id)
select 'manager', id from public.permissions where code = 'finance.manage'
on conflict do nothing;

create table public.financial_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 80),
  initial_balance numeric(14,2) not null default 0,
  active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.financial_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 80),
  kind text not null default 'both' check (kind in ('income','expense','both')),
  active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.financial_partner_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 100),
  expected_percentage numeric(5,2) not null check (expected_percentage >= 0 and expected_percentage <= 100),
  active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.financial_partners (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.financial_partner_groups(id) on delete restrict,
  name text not null check (char_length(trim(name)) between 2 and 100),
  active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.accounts_receivable (
  id uuid primary key default gen_random_uuid(),
  installment_batch_id uuid not null default gen_random_uuid(),
  installment_number integer not null default 1 check (installment_number > 0),
  installment_count integer not null default 1 check (installment_count > 0),
  customer text not null check (char_length(trim(customer)) between 2 and 160),
  description text not null check (char_length(trim(description)) between 2 and 240),
  category_id uuid not null references public.financial_categories(id) on delete restrict,
  issued_on date not null,
  due_on date not null,
  received_on date,
  document_number text check (document_number is null or char_length(document_number) <= 100),
  amount numeric(14,2) not null check (amount > 0),
  destination_account_id uuid references public.financial_accounts(id) on delete restrict,
  notes text check (notes is null or char_length(notes) <= 2000),
  status text not null default 'pending' check (status in ('pending','received','cancelled')),
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (due_on >= issued_on),
  check (installment_number <= installment_count),
  check ((status = 'received') = (received_on is not null)),
  check (received_on is null or received_on >= issued_on),
  unique (installment_batch_id, installment_number)
);

create table public.accounts_payable (
  id uuid primary key default gen_random_uuid(),
  installment_batch_id uuid not null default gen_random_uuid(),
  installment_number integer not null default 1 check (installment_number > 0),
  installment_count integer not null default 1 check (installment_count > 0),
  supplier text not null check (char_length(trim(supplier)) between 2 and 160),
  description text not null check (char_length(trim(description)) between 2 and 240),
  category_id uuid not null references public.financial_categories(id) on delete restrict,
  issued_on date not null,
  due_on date not null,
  paid_on date,
  document_number text check (document_number is null or char_length(document_number) <= 100),
  amount numeric(14,2) not null check (amount > 0),
  source_account_id uuid references public.financial_accounts(id) on delete restrict,
  notes text check (notes is null or char_length(notes) <= 2000),
  status text not null default 'pending' check (status in ('pending','paid','cancelled')),
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (due_on >= issued_on),
  check (installment_number <= installment_count),
  check ((status = 'paid') = (paid_on is not null)),
  check (paid_on is null or paid_on >= issued_on),
  unique (installment_batch_id, installment_number)
);

create table public.partner_contributions (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid references public.financial_partners(id) on delete restrict,
  group_id uuid references public.financial_partner_groups(id) on delete restrict,
  account_id uuid not null references public.financial_accounts(id) on delete restrict,
  category_id uuid references public.financial_categories(id) on delete restrict,
  contributed_on date not null,
  amount numeric(14,2) not null check (amount > 0),
  description text not null check (char_length(trim(description)) between 2 and 240),
  notes text check (notes is null or char_length(notes) <= 2000),
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((partner_id is null) <> (group_id is null))
);

create table public.financial_transactions (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('income','expense')),
  description text not null check (char_length(trim(description)) between 2 and 240),
  category_id uuid references public.financial_categories(id) on delete restrict,
  account_id uuid not null references public.financial_accounts(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  occurred_on date not null,
  origin text not null check (origin in ('manual','receivable','payable','contribution')),
  receivable_id uuid references public.accounts_receivable(id) on delete restrict,
  payable_id uuid references public.accounts_payable(id) on delete restrict,
  contribution_id uuid references public.partner_contributions(id) on delete restrict,
  notes text check (notes is null or char_length(notes) <= 2000),
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  reversed_at timestamptz,
  reversed_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (origin = 'manual' and receivable_id is null and payable_id is null and contribution_id is null)
    or (origin = 'receivable' and type = 'income' and receivable_id is not null and payable_id is null and contribution_id is null)
    or (origin = 'payable' and type = 'expense' and receivable_id is null and payable_id is not null and contribution_id is null)
    or (origin = 'contribution' and type = 'income' and receivable_id is null and payable_id is null and contribution_id is not null)
  )
);

create unique index financial_transaction_receivable_unique on public.financial_transactions(receivable_id) where receivable_id is not null;
create unique index financial_transaction_payable_unique on public.financial_transactions(payable_id) where payable_id is not null;
create unique index financial_transaction_contribution_unique on public.financial_transactions(contribution_id) where contribution_id is not null;
create unique index financial_accounts_name_unique on public.financial_accounts(lower(name));
create unique index financial_categories_name_unique on public.financial_categories(lower(name));
create unique index financial_partner_groups_name_unique on public.financial_partner_groups(lower(name));
create unique index financial_partners_name_unique on public.financial_partners(lower(name));
create index accounts_receivable_due_idx on public.accounts_receivable(status, due_on);
create index accounts_payable_due_idx on public.accounts_payable(status, due_on);
create index financial_transactions_period_idx on public.financial_transactions(occurred_on desc) where reversed_at is null;
create index partner_contributions_period_idx on public.partner_contributions(contributed_on desc);

create trigger touch_financial_accounts before update on public.financial_accounts for each row execute function private.touch_updated_at();
create trigger touch_financial_categories before update on public.financial_categories for each row execute function private.touch_updated_at();
create trigger touch_financial_partner_groups before update on public.financial_partner_groups for each row execute function private.touch_updated_at();
create trigger touch_financial_partners before update on public.financial_partners for each row execute function private.touch_updated_at();
create trigger touch_accounts_receivable before update on public.accounts_receivable for each row execute function private.touch_updated_at();
create trigger touch_accounts_payable before update on public.accounts_payable for each row execute function private.touch_updated_at();
create trigger touch_partner_contributions before update on public.partner_contributions for each row execute function private.touch_updated_at();
create trigger touch_financial_transactions before update on public.financial_transactions for each row execute function private.touch_updated_at();

alter table public.financial_accounts enable row level security;
alter table public.financial_categories enable row level security;
alter table public.financial_partner_groups enable row level security;
alter table public.financial_partners enable row level security;
alter table public.accounts_receivable enable row level security;
alter table public.accounts_payable enable row level security;
alter table public.partner_contributions enable row level security;
alter table public.financial_transactions enable row level security;
alter table public.financial_accounts force row level security;
alter table public.financial_categories force row level security;
alter table public.financial_partner_groups force row level security;
alter table public.financial_partners force row level security;
alter table public.accounts_receivable force row level security;
alter table public.accounts_payable force row level security;
alter table public.partner_contributions force row level security;
alter table public.financial_transactions force row level security;

create policy "finance readers accounts" on public.financial_accounts for select to authenticated using (private.has_permission('financial.read_full'));
create policy "finance readers categories" on public.financial_categories for select to authenticated using (private.has_permission('financial.read_full'));
create policy "finance readers partner groups" on public.financial_partner_groups for select to authenticated using (private.has_permission('financial.read_full'));
create policy "finance readers partners" on public.financial_partners for select to authenticated using (private.has_permission('financial.read_full'));
create policy "finance readers receivables" on public.accounts_receivable for select to authenticated using (private.has_permission('financial.read_full'));
create policy "finance readers payables" on public.accounts_payable for select to authenticated using (private.has_permission('financial.read_full'));
create policy "finance readers contributions" on public.partner_contributions for select to authenticated using (private.has_permission('financial.read_full'));
create policy "finance readers transactions" on public.financial_transactions for select to authenticated using (private.has_permission('financial.read_full'));

revoke insert, update, delete, truncate on public.financial_accounts, public.financial_categories,
  public.financial_partner_groups, public.financial_partners, public.accounts_receivable,
  public.accounts_payable, public.partner_contributions, public.financial_transactions
from anon, authenticated;

-- O saldo e todos os painéis partem exclusivamente dos lançamentos efetivos não estornados.
create or replace function public.financial_control_snapshot(p_date_from date, p_date_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform private.require_permission('financial.read_full');
  if p_date_from is null or p_date_to is null or p_date_to < p_date_from or p_date_to - p_date_from > 366 then
    raise exception 'invalid financial period';
  end if;

  with active_transactions as materialized (
    select * from public.financial_transactions where reversed_at is null
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
      'receivable', coalesce((select sum(amount) from public.accounts_receivable where status='pending'), 0),
      'payable', coalesce((select sum(amount) from public.accounts_payable where status='pending'), 0),
      'overdue_receivable', coalesce((select sum(amount) from public.accounts_receivable where status='pending' and due_on < (now() at time zone 'America/Sao_Paulo')::date), 0),
      'overdue_payable', coalesce((select sum(amount) from public.accounts_payable where status='pending' and due_on < (now() at time zone 'America/Sao_Paulo')::date), 0),
      'month_income', coalesce((select sum(amount) from active_transactions where type='income' and occurred_on between date_trunc('month', now() at time zone 'America/Sao_Paulo')::date and (now() at time zone 'America/Sao_Paulo')::date), 0),
      'month_expense', coalesce((select sum(amount) from active_transactions where type='expense' and occurred_on between date_trunc('month', now() at time zone 'America/Sao_Paulo')::date and (now() at time zone 'America/Sao_Paulo')::date), 0),
      'projected_balance', coalesce((select sum(initial_balance) from public.financial_accounts), 0)
        + coalesce((select sum(case when type='income' then amount else -amount end) from active_transactions), 0)
        + coalesce((select sum(amount) from public.accounts_receivable where status='pending'), 0)
        - coalesce((select sum(amount) from public.accounts_payable where status='pending'), 0)
    ),
    'series', coalesce((select jsonb_agg(jsonb_build_object('date',day,'income',income,'expense',expense,'balance',balance) order by day) from series), '[]'::jsonb),
    'payable_by_category', coalesce((select jsonb_agg(row_to_json(x) order by x.value desc) from (
      select c.name, sum(a.amount) as value from public.accounts_payable a join public.financial_categories c on c.id=a.category_id where a.status='pending' and a.due_on between p_date_from and p_date_to group by c.name
    ) x), '[]'::jsonb),
    'receivable_by_category', coalesce((select jsonb_agg(row_to_json(x) order by x.value desc) from (
      select c.name, sum(a.amount) as value from public.accounts_receivable a join public.financial_categories c on c.id=a.category_id where a.status='pending' and a.due_on between p_date_from and p_date_to group by c.name
    ) x), '[]'::jsonb),
    'largest_expenses', coalesce((select jsonb_agg(row_to_json(x) order by x.value desc) from (
      select description as name, amount as value from period_transactions where type='expense' order by amount desc limit 8
    ) x), '[]'::jsonb),
    'largest_receivables', coalesce((select jsonb_agg(row_to_json(x) order by x.value desc) from (
      select customer as name, sum(amount) as value from public.accounts_receivable where status='pending' and due_on between p_date_from and p_date_to group by customer order by value desc limit 8
    ) x), '[]'::jsonb),
    'account_status', jsonb_build_array(
      jsonb_build_object('name','Realizadas','value',(select count(*) from public.accounts_receivable where status='received' and due_on between p_date_from and p_date_to)+(select count(*) from public.accounts_payable where status='paid' and due_on between p_date_from and p_date_to)),
      jsonb_build_object('name','Pendentes','value',(select count(*) from public.accounts_receivable where status='pending' and due_on between greatest(p_date_from,(now() at time zone 'America/Sao_Paulo')::date) and p_date_to)+(select count(*) from public.accounts_payable where status='pending' and due_on between greatest(p_date_from,(now() at time zone 'America/Sao_Paulo')::date) and p_date_to)),
      jsonb_build_object('name','Vencidas','value',(select count(*) from public.accounts_receivable where status='pending' and due_on between p_date_from and least(p_date_to,(now() at time zone 'America/Sao_Paulo')::date-1))+(select count(*) from public.accounts_payable where status='pending' and due_on between p_date_from and least(p_date_to,(now() at time zone 'America/Sao_Paulo')::date-1)))
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
    'receivables', coalesce((select jsonb_agg(to_jsonb(r) || jsonb_build_object('display_status',case when r.status='pending' and r.due_on < (now() at time zone 'America/Sao_Paulo')::date then 'overdue' else r.status end,'category_name',c.name,'account_name',a.name) order by r.due_on desc) from public.accounts_receivable r join public.financial_categories c on c.id=r.category_id left join public.financial_accounts a on a.id=r.destination_account_id), '[]'::jsonb),
    'payables', coalesce((select jsonb_agg(to_jsonb(p) || jsonb_build_object('display_status',case when p.status='pending' and p.due_on < (now() at time zone 'America/Sao_Paulo')::date then 'overdue' else p.status end,'category_name',c.name,'account_name',a.name) order by p.due_on desc) from public.accounts_payable p join public.financial_categories c on c.id=p.category_id left join public.financial_accounts a on a.id=p.source_account_id), '[]'::jsonb),
    'transactions', coalesce((select jsonb_agg(to_jsonb(t) || jsonb_build_object('category_name',c.name,'account_name',a.name,'responsible_name',pr.full_name) order by t.occurred_on desc,t.created_at desc) from public.financial_transactions t left join public.financial_categories c on c.id=t.category_id join public.financial_accounts a on a.id=t.account_id left join public.profiles pr on pr.id=t.created_by where t.occurred_on between p_date_from and p_date_to), '[]'::jsonb),
    'contributions', coalesce((select jsonb_agg(to_jsonb(c) || jsonb_build_object('partner_name',p.name,'group_name',coalesce(g.name,pg.name),'account_name',a.name) order by c.contributed_on desc) from public.partner_contributions c left join public.financial_partners p on p.id=c.partner_id left join public.financial_partner_groups pg on pg.id=p.group_id left join public.financial_partner_groups g on g.id=c.group_id join public.financial_accounts a on a.id=c.account_id), '[]'::jsonb),
    'audit', coalesce((select jsonb_agg(to_jsonb(l) || jsonb_build_object('actor_name',p.full_name) order by l.created_at desc) from (select * from public.audit_logs where entity_type like 'financial.%' order by created_at desc limit 200) l left join public.profiles p on p.id=l.actor_id), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

-- Único ponto de escrita: valida permissões, valores em centavos e vínculos antes da alteração.
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
  batch_id uuid := gen_random_uuid();
  total_cents bigint;
  installment_cents bigint;
  installment_count integer;
  installment_index integer;
  interval_days integer;
  due_date date;
  old_row jsonb;
  new_row jsonb;
  category_kind text;
begin
  perform private.require_permission('finance.manage');
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'invalid payload'; end if;

  if p_action in ('receivable.create','receivable.update','payable.create','payable.update') then
    select kind into category_kind from public.financial_categories
    where id=(p_payload->>'category_id')::uuid and active;
    if category_kind is null or (p_action like 'receivable.%' and category_kind not in ('income','both'))
      or (p_action like 'payable.%' and category_kind not in ('expense','both')) then
      raise exception 'invalid category';
    end if;
  end if;
  if p_action in ('receivable.settle','payable.settle','transaction.save','contribution.save')
    and not exists(select 1 from public.financial_accounts where id=(p_payload->>'account_id')::uuid and active) then
    raise exception 'invalid financial account';
  end if;
  if p_action in ('receivable.create','receivable.update','payable.create','payable.update')
    and nullif(p_payload->>'account_id','') is not null
    and not exists(select 1 from public.financial_accounts where id=(p_payload->>'account_id')::uuid and active) then
    raise exception 'invalid financial account';
  end if;

  if p_action = 'account.save' then
    entity_id := nullif(p_payload->>'id','')::uuid;
    if entity_id is null then
      insert into public.financial_accounts(name,initial_balance,created_by)
      values(trim(p_payload->>'name'),coalesce((p_payload->>'initial_balance_cents')::bigint,0)/100.0,actor)
      returning id,to_jsonb(financial_accounts) into entity_id,new_row;
    else
      select to_jsonb(a) into old_row from public.financial_accounts a where id=entity_id for update;
      update public.financial_accounts set name=trim(p_payload->>'name'),initial_balance=(p_payload->>'initial_balance_cents')::bigint/100.0,active=coalesce((p_payload->>'active')::boolean,active)
      where id=entity_id returning to_jsonb(financial_accounts) into new_row;
    end if;
  elsif p_action = 'category.save' then
    entity_id := nullif(p_payload->>'id','')::uuid;
    category_kind := coalesce(nullif(p_payload->>'kind',''),'both');
    if category_kind not in ('income','expense','both') then raise exception 'invalid category kind'; end if;
    if entity_id is null then
      insert into public.financial_categories(name,kind,created_by) values(trim(p_payload->>'name'),category_kind,actor)
      returning id,to_jsonb(financial_categories) into entity_id,new_row;
    else
      select to_jsonb(c) into old_row from public.financial_categories c where id=entity_id for update;
      update public.financial_categories set name=trim(p_payload->>'name'),kind=category_kind,active=coalesce((p_payload->>'active')::boolean,active)
      where id=entity_id returning to_jsonb(financial_categories) into new_row;
    end if;
  elsif p_action = 'group.save' then
    entity_id := nullif(p_payload->>'id','')::uuid;
    if entity_id is null then
      insert into public.financial_partner_groups(name,expected_percentage,created_by) values(trim(p_payload->>'name'),(p_payload->>'expected_percentage')::numeric,actor)
      returning id,to_jsonb(financial_partner_groups) into entity_id,new_row;
    else
      select to_jsonb(g) into old_row from public.financial_partner_groups g where id=entity_id for update;
      update public.financial_partner_groups set name=trim(p_payload->>'name'),expected_percentage=(p_payload->>'expected_percentage')::numeric,active=coalesce((p_payload->>'active')::boolean,active)
      where id=entity_id returning to_jsonb(financial_partner_groups) into new_row;
    end if;
    if (select coalesce(sum(expected_percentage),0) from public.financial_partner_groups where active) > 100 then raise exception 'active percentages exceed 100'; end if;
  elsif p_action = 'partner.save' then
    entity_id := nullif(p_payload->>'id','')::uuid;
    if not exists(select 1 from public.financial_partner_groups where id=(p_payload->>'group_id')::uuid and active) then raise exception 'invalid partner group'; end if;
    if entity_id is null then
      insert into public.financial_partners(name,group_id,created_by) values(trim(p_payload->>'name'),(p_payload->>'group_id')::uuid,actor)
      returning id,to_jsonb(financial_partners) into entity_id,new_row;
    else
      select to_jsonb(p) into old_row from public.financial_partners p where id=entity_id for update;
      update public.financial_partners set name=trim(p_payload->>'name'),group_id=(p_payload->>'group_id')::uuid,active=coalesce((p_payload->>'active')::boolean,active)
      where id=entity_id returning to_jsonb(financial_partners) into new_row;
    end if;
  elsif p_action in ('receivable.create','payable.create') then
    total_cents := (p_payload->>'amount_cents')::bigint;
    installment_count := coalesce((p_payload->>'installment_count')::integer,1);
    interval_days := coalesce((p_payload->>'interval_days')::integer,30);
    if total_cents <= 0 or installment_count not between 1 and 120 or total_cents < installment_count or interval_days not between 1 and 365 then raise exception 'invalid installments'; end if;
    for installment_index in 1..installment_count loop
      installment_cents := total_cents / installment_count + case when installment_index <= total_cents % installment_count then 1 else 0 end;
      due_date := (p_payload->>'due_on')::date + ((installment_index-1)*interval_days);
      if p_action = 'receivable.create' then
        insert into public.accounts_receivable(installment_batch_id,installment_number,installment_count,customer,description,category_id,issued_on,due_on,document_number,amount,destination_account_id,notes,created_by,updated_by)
        values(batch_id,installment_index,installment_count,trim(p_payload->>'party'),trim(p_payload->>'description'),(p_payload->>'category_id')::uuid,(p_payload->>'issued_on')::date,due_date,nullif(trim(p_payload->>'document_number'),''),installment_cents/100.0,nullif(p_payload->>'account_id','')::uuid,nullif(trim(p_payload->>'notes'),''),actor,actor);
      else
        insert into public.accounts_payable(installment_batch_id,installment_number,installment_count,supplier,description,category_id,issued_on,due_on,document_number,amount,source_account_id,notes,created_by,updated_by)
        values(batch_id,installment_index,installment_count,trim(p_payload->>'party'),trim(p_payload->>'description'),(p_payload->>'category_id')::uuid,(p_payload->>'issued_on')::date,due_date,nullif(trim(p_payload->>'document_number'),''),installment_cents/100.0,nullif(p_payload->>'account_id','')::uuid,nullif(trim(p_payload->>'notes'),''),actor,actor);
      end if;
    end loop;
    entity_id := batch_id;
    new_row := jsonb_build_object('installment_batch_id',batch_id,'installment_count',installment_count,'amount_cents',total_cents);
  elsif p_action in ('receivable.update','payable.update') then
    entity_id := (p_payload->>'id')::uuid;
    if (p_payload->>'amount_cents')::bigint <= 0 then raise exception 'invalid amount'; end if;
    if p_action = 'receivable.update' then
      select to_jsonb(r) into old_row from public.accounts_receivable r where id=entity_id and status='pending' for update;
      update public.accounts_receivable set customer=trim(p_payload->>'party'),description=trim(p_payload->>'description'),category_id=(p_payload->>'category_id')::uuid,issued_on=(p_payload->>'issued_on')::date,due_on=(p_payload->>'due_on')::date,document_number=nullif(trim(p_payload->>'document_number'),''),amount=(p_payload->>'amount_cents')::bigint/100.0,destination_account_id=nullif(p_payload->>'account_id','')::uuid,notes=nullif(trim(p_payload->>'notes'),''),updated_by=actor where id=entity_id and status='pending' returning to_jsonb(accounts_receivable) into new_row;
    else
      select to_jsonb(p) into old_row from public.accounts_payable p where id=entity_id and status='pending' for update;
      update public.accounts_payable set supplier=trim(p_payload->>'party'),description=trim(p_payload->>'description'),category_id=(p_payload->>'category_id')::uuid,issued_on=(p_payload->>'issued_on')::date,due_on=(p_payload->>'due_on')::date,document_number=nullif(trim(p_payload->>'document_number'),''),amount=(p_payload->>'amount_cents')::bigint/100.0,source_account_id=nullif(p_payload->>'account_id','')::uuid,notes=nullif(trim(p_payload->>'notes'),''),updated_by=actor where id=entity_id and status='pending' returning to_jsonb(accounts_payable) into new_row;
    end if;
    if new_row is null then raise exception 'record is not pending'; end if;
  elsif p_action in ('receivable.settle','payable.settle') then
    entity_id := (p_payload->>'id')::uuid;
    if (p_payload->>'settled_on')::date > (now() at time zone 'America/Sao_Paulo')::date then raise exception 'future settlement is not allowed'; end if;
    if p_action = 'receivable.settle' then
      select to_jsonb(r) into old_row from public.accounts_receivable r where id=entity_id for update;
      update public.accounts_receivable set status='received',received_on=(p_payload->>'settled_on')::date,destination_account_id=(p_payload->>'account_id')::uuid,updated_by=actor where id=entity_id and status='pending' returning to_jsonb(accounts_receivable) into new_row;
      if new_row is null then raise exception 'receivable already settled'; end if;
      insert into public.financial_transactions(type,description,category_id,account_id,amount,occurred_on,origin,receivable_id,created_by,updated_by)
      select 'income',description,category_id,destination_account_id,amount,received_on,'receivable',id,actor,actor from public.accounts_receivable where id=entity_id
      on conflict (receivable_id) where receivable_id is not null do update set amount=excluded.amount,occurred_on=excluded.occurred_on,account_id=excluded.account_id,description=excluded.description,category_id=excluded.category_id,updated_by=actor,reversed_at=null,reversed_by=null;
    else
      select to_jsonb(p) into old_row from public.accounts_payable p where id=entity_id for update;
      update public.accounts_payable set status='paid',paid_on=(p_payload->>'settled_on')::date,source_account_id=(p_payload->>'account_id')::uuid,updated_by=actor where id=entity_id and status='pending' returning to_jsonb(accounts_payable) into new_row;
      if new_row is null then raise exception 'payable already settled'; end if;
      insert into public.financial_transactions(type,description,category_id,account_id,amount,occurred_on,origin,payable_id,created_by,updated_by)
      select 'expense',description,category_id,source_account_id,amount,paid_on,'payable',id,actor,actor from public.accounts_payable where id=entity_id
      on conflict (payable_id) where payable_id is not null do update set amount=excluded.amount,occurred_on=excluded.occurred_on,account_id=excluded.account_id,description=excluded.description,category_id=excluded.category_id,updated_by=actor,reversed_at=null,reversed_by=null;
    end if;
  elsif p_action in ('receivable.reverse','payable.reverse') then
    entity_id := (p_payload->>'id')::uuid;
    if char_length(trim(coalesce(p_payload->>'reason',''))) < 3 then raise exception 'reason is required'; end if;
    if p_action = 'receivable.reverse' then
      select to_jsonb(r) into old_row from public.accounts_receivable r where id=entity_id for update;
      update public.accounts_receivable set status='pending',received_on=null,updated_by=actor where id=entity_id and status='received' returning to_jsonb(accounts_receivable) into new_row;
      update public.financial_transactions set reversed_at=now(),reversed_by=actor,updated_by=actor,notes=concat_ws(E'\n',notes,'Estorno: '||trim(p_payload->>'reason')) where receivable_id=entity_id and reversed_at is null;
    else
      select to_jsonb(p) into old_row from public.accounts_payable p where id=entity_id for update;
      update public.accounts_payable set status='pending',paid_on=null,updated_by=actor where id=entity_id and status='paid' returning to_jsonb(accounts_payable) into new_row;
      update public.financial_transactions set reversed_at=now(),reversed_by=actor,updated_by=actor,notes=concat_ws(E'\n',notes,'Estorno: '||trim(p_payload->>'reason')) where payable_id=entity_id and reversed_at is null;
    end if;
    if new_row is null then raise exception 'record is not settled'; end if;
  elsif p_action in ('receivable.delete','payable.delete') then
    entity_id := (p_payload->>'id')::uuid;
    if p_action = 'receivable.delete' then
      delete from public.accounts_receivable where id=entity_id and status='pending' returning to_jsonb(accounts_receivable) into old_row;
    else
      delete from public.accounts_payable where id=entity_id and status='pending' returning to_jsonb(accounts_payable) into old_row;
    end if;
    if old_row is null then raise exception 'only pending records can be deleted'; end if;
    new_row := jsonb_build_object('deleted',true);
  elsif p_action = 'transaction.save' then
    entity_id := nullif(p_payload->>'id','')::uuid;
    if (p_payload->>'amount_cents')::bigint <= 0 or (p_payload->>'type') not in ('income','expense') then raise exception 'invalid transaction'; end if;
    if nullif(p_payload->>'category_id','') is not null and not exists(
      select 1 from public.financial_categories where id=(p_payload->>'category_id')::uuid and active
        and kind in (p_payload->>'type','both')
    ) then raise exception 'invalid category'; end if;
    if entity_id is null then
      insert into public.financial_transactions(type,description,category_id,account_id,amount,occurred_on,origin,notes,created_by,updated_by)
      values(p_payload->>'type',trim(p_payload->>'description'),nullif(p_payload->>'category_id','')::uuid,(p_payload->>'account_id')::uuid,(p_payload->>'amount_cents')::bigint/100.0,(p_payload->>'occurred_on')::date,'manual',nullif(trim(p_payload->>'notes'),''),actor,actor)
      returning id,to_jsonb(financial_transactions) into entity_id,new_row;
    else
      select to_jsonb(t) into old_row from public.financial_transactions t where id=entity_id and origin='manual' and reversed_at is null for update;
      update public.financial_transactions set type=p_payload->>'type',description=trim(p_payload->>'description'),category_id=nullif(p_payload->>'category_id','')::uuid,account_id=(p_payload->>'account_id')::uuid,amount=(p_payload->>'amount_cents')::bigint/100.0,occurred_on=(p_payload->>'occurred_on')::date,notes=nullif(trim(p_payload->>'notes'),''),updated_by=actor where id=entity_id and origin='manual' and reversed_at is null returning to_jsonb(financial_transactions) into new_row;
    end if;
    if new_row is null then raise exception 'automatic transactions must be edited at their source'; end if;
  elsif p_action = 'transaction.delete' then
    entity_id := (p_payload->>'id')::uuid;
    update public.financial_transactions set reversed_at=now(),reversed_by=actor,updated_by=actor,notes=concat_ws(E'\n',notes,'Exclusão: '||trim(coalesce(p_payload->>'reason','Lançamento manual excluído'))) where id=entity_id and origin='manual' and reversed_at is null returning to_jsonb(financial_transactions) into new_row;
    if new_row is null then raise exception 'automatic transactions cannot be deleted'; end if;
  elsif p_action = 'contribution.save' then
    entity_id := nullif(p_payload->>'id','')::uuid;
    if (p_payload->>'amount_cents')::bigint <= 0 or ((nullif(p_payload->>'partner_id','') is null) = (nullif(p_payload->>'group_id','') is null)) then raise exception 'invalid contribution'; end if;
    if nullif(p_payload->>'partner_id','') is not null and not exists(select 1 from public.financial_partners where id=(p_payload->>'partner_id')::uuid and active) then raise exception 'invalid partner'; end if;
    if nullif(p_payload->>'group_id','') is not null and not exists(select 1 from public.financial_partner_groups where id=(p_payload->>'group_id')::uuid and active) then raise exception 'invalid partner group'; end if;
    if nullif(p_payload->>'category_id','') is not null and not exists(select 1 from public.financial_categories where id=(p_payload->>'category_id')::uuid and active and kind in ('income','both')) then raise exception 'invalid category'; end if;
    if entity_id is null then
      insert into public.partner_contributions(partner_id,group_id,account_id,category_id,contributed_on,amount,description,notes,created_by,updated_by)
      values(nullif(p_payload->>'partner_id','')::uuid,nullif(p_payload->>'group_id','')::uuid,(p_payload->>'account_id')::uuid,nullif(p_payload->>'category_id','')::uuid,(p_payload->>'contributed_on')::date,(p_payload->>'amount_cents')::bigint/100.0,trim(p_payload->>'description'),nullif(trim(p_payload->>'notes'),''),actor,actor)
      returning id,to_jsonb(partner_contributions) into entity_id,new_row;
      insert into public.financial_transactions(type,description,category_id,account_id,amount,occurred_on,origin,contribution_id,notes,created_by,updated_by)
      select 'income',description,category_id,account_id,amount,contributed_on,'contribution',id,notes,actor,actor from public.partner_contributions where id=entity_id;
    else
      select to_jsonb(c) into old_row from public.partner_contributions c where id=entity_id for update;
      update public.partner_contributions set partner_id=nullif(p_payload->>'partner_id','')::uuid,group_id=nullif(p_payload->>'group_id','')::uuid,account_id=(p_payload->>'account_id')::uuid,category_id=nullif(p_payload->>'category_id','')::uuid,contributed_on=(p_payload->>'contributed_on')::date,amount=(p_payload->>'amount_cents')::bigint/100.0,description=trim(p_payload->>'description'),notes=nullif(trim(p_payload->>'notes'),''),updated_by=actor where id=entity_id returning to_jsonb(partner_contributions) into new_row;
      update public.financial_transactions t set description=c.description,category_id=c.category_id,account_id=c.account_id,amount=c.amount,occurred_on=c.contributed_on,notes=c.notes,updated_by=actor from public.partner_contributions c where c.id=entity_id and t.contribution_id=c.id;
    end if;
  elsif p_action = 'export.log' then
    perform private.require_permission('reports.export');
    entity_id := null;
    new_row := jsonb_build_object('scope',p_payload->>'scope','from',p_payload->>'from','to',p_payload->>'to');
  else
    raise exception 'unsupported financial action';
  end if;

  if new_row is null then raise exception 'financial record not found'; end if;

  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,previous_data_sanitized,new_data_sanitized,reason)
  values(actor,private.current_app_role(),p_action,'financial.'||split_part(p_action,'.',1),entity_id,old_row,new_row,nullif(trim(p_payload->>'reason'),''));
  return jsonb_build_object('id',entity_id,'action',p_action);
end;
$$;

revoke all on function public.financial_control_snapshot(date,date) from public, anon;
grant execute on function public.financial_control_snapshot(date,date) to authenticated;
revoke all on function public.financial_control_mutate(text,jsonb) from public, anon;
grant execute on function public.financial_control_mutate(text,jsonb) to authenticated;

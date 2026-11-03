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

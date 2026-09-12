begin;

create table public.financial_integration_settings (
  provider text primary key check (provider in ('mercadopago')),
  account_id uuid not null references public.financial_accounts(id) on delete restrict,
  revenue_category_id uuid not null references public.financial_categories(id) on delete restrict,
  fee_category_id uuid not null references public.financial_categories(id) on delete restrict,
  refund_category_id uuid not null references public.financial_categories(id) on delete restrict,
  active boolean not null default true,
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger touch_financial_integration_settings
before update on public.financial_integration_settings
for each row execute function private.touch_updated_at();

alter table public.financial_integration_settings enable row level security;
alter table public.financial_integration_settings force row level security;

create policy "finance readers integration settings"
on public.financial_integration_settings
for select
to authenticated
using (private.has_permission('financial.read_full'));

revoke insert, update, delete, truncate
on public.financial_integration_settings
from anon, authenticated;

grant select
on public.financial_integration_settings
to authenticated;

grant all privileges
on public.financial_integration_settings
to service_role;

alter table public.accounts_receivable
  add column origin text not null default 'manual'
    check (origin in ('manual','online_store')),
  add column order_id uuid references public.orders(id) on delete restrict,
  add column payment_id uuid references public.payments(id) on delete restrict,
  add column provider_payment_id text,
  add column payment_method text,
  add column gross_amount numeric(14,2)
    check (gross_amount is null or gross_amount >= 0),
  add column provider_fee numeric(14,2)
    check (provider_fee is null or provider_fee >= 0),
  add column net_amount numeric(14,2)
    check (net_amount is null or net_amount >= 0),
  add column provider_installments integer
    check (provider_installments is null or provider_installments > 0),
  add column provider_status text,
  add column received_at timestamptz,
  add column refunded_amount numeric(14,2) not null default 0
    check (refunded_amount >= 0);

create unique index accounts_receivable_order_unique
on public.accounts_receivable(order_id)
where order_id is not null;

create unique index accounts_receivable_payment_unique
on public.accounts_receivable(payment_id)
where payment_id is not null;

create index accounts_receivable_origin_period_idx
on public.accounts_receivable(origin, status, due_on);

alter table public.accounts_payable
  add column origin text not null default 'manual'
    check (origin in ('manual','mercadopago_fee','mercadopago_refund')),
  add column payment_id uuid references public.payments(id) on delete restrict,
  add column payment_refund_id uuid references public.payment_refunds(id) on delete restrict,
  add column provider_reference text;

create unique index accounts_payable_payment_fee_unique
on public.accounts_payable(payment_id)
where origin = 'mercadopago_fee';

create unique index accounts_payable_payment_refund_unique
on public.accounts_payable(payment_refund_id)
where payment_refund_id is not null;

create index accounts_payable_origin_period_idx
on public.accounts_payable(origin, status, due_on);

alter table public.payments
  add column if not exists net_received_amount numeric(12,2)
    check (net_received_amount is null or net_received_amount >= 0),
  add column if not exists provider_fee_confirmed boolean not null default false,
  add column if not exists installments integer
    check (installments is null or installments > 0);

alter table public.payment_refunds
  drop constraint if exists payment_refunds_payment_id_key;

alter table public.payment_refunds
  add column if not exists idempotency_key uuid not null default gen_random_uuid();

alter table public.payment_refunds
  add constraint payment_refunds_idempotency_unique
  unique (idempotency_key);

create index payment_refunds_payment_idx
on public.payment_refunds(payment_id, created_at desc);

create table public.financial_transfers (
  id uuid primary key default gen_random_uuid(),
  source_account_id uuid not null references public.financial_accounts(id) on delete restrict,
  destination_account_id uuid not null references public.financial_accounts(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  occurred_on date not null,
  description text not null check (char_length(trim(description)) between 2 and 240),
  external_reference text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (source_account_id <> destination_account_id)
);

create unique index financial_transfers_external_reference_unique
on public.financial_transfers(lower(external_reference))
where external_reference is not null;

create index financial_transfers_period_idx
on public.financial_transfers(occurred_on desc);

alter table public.financial_transfers enable row level security;
alter table public.financial_transfers force row level security;

create policy "finance readers transfers"
on public.financial_transfers
for select
to authenticated
using (private.has_permission('financial.read_full'));

revoke insert, update, delete, truncate
on public.financial_transfers
from anon, authenticated;

grant select
on public.financial_transfers
to authenticated;

grant all privileges
on public.financial_transfers
to service_role;

alter table public.financial_transactions
  add column affects_result boolean not null default true,
  add column transfer_id uuid references public.financial_transfers(id) on delete restrict;

alter table public.financial_transactions
  drop constraint if exists financial_transactions_origin_check;

alter table public.financial_transactions
  drop constraint if exists financial_transactions_check;

alter table public.financial_transactions
  drop constraint if exists financial_transactions_source_check;

alter table public.financial_transactions
  add constraint financial_transactions_origin_check
    check (
      origin in (
        'manual',
        'receivable',
        'payable',
        'contribution',
        'transfer'
      )
    ),
  add constraint financial_transactions_source_check
    check (
      (
        origin = 'manual'
        and receivable_id is null
        and payable_id is null
        and contribution_id is null
        and transfer_id is null
      )
      or (
        origin = 'receivable'
        and type = 'income'
        and receivable_id is not null
        and payable_id is null
        and contribution_id is null
        and transfer_id is null
      )
      or (
        origin = 'payable'
        and type = 'expense'
        and receivable_id is null
        and payable_id is not null
        and contribution_id is null
        and transfer_id is null
      )
      or (
        origin = 'contribution'
        and type = 'income'
        and receivable_id is null
        and payable_id is null
        and contribution_id is not null
        and transfer_id is null
      )
      or (
        origin = 'transfer'
        and transfer_id is not null
        and receivable_id is null
        and payable_id is null
        and contribution_id is null
        and not affects_result
      )
    );

create unique index financial_transaction_transfer_side_unique
on public.financial_transactions(transfer_id, type)
where transfer_id is not null;

create or replace function private.validate_financial_integration_settings()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.financial_accounts
    where id = new.account_id
      and active
  ) then
    raise exception 'invalid Mercado Pago financial account';
  end if;

  if not exists (
    select 1
    from public.financial_categories
    where id = new.revenue_category_id
      and active
      and not is_group
      and kind in ('income','both')
  ) then
    raise exception 'invalid online sales category';
  end if;

  if not exists (
    select 1
    from public.financial_categories
    where id = new.fee_category_id
      and active
      and not is_group
      and kind in ('expense','both')
  ) then
    raise exception 'invalid Mercado Pago fee category';
  end if;

  if not exists (
    select 1
    from public.financial_categories
    where id = new.refund_category_id
      and active
      and not is_group
      and kind in ('expense','both')
  ) then
    raise exception 'invalid refund category';
  end if;

  return new;
end;
$$;

create trigger validate_financial_integration_settings
before insert or update
on public.financial_integration_settings
for each row
execute function private.validate_financial_integration_settings();

create or replace function private.ensure_mercadopago_financial_settings(
  p_payment_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid;
  account_id uuid;
  revenue_id uuid;
  sales_group_id uuid;
  fee_id uuid;
  refund_id uuid;
begin
  if exists (
    select 1
    from public.financial_integration_settings
    where provider = 'mercadopago'
  ) then
    update public.financial_accounts a
    set active = true,
        name = 'Mercado Pago'
    from public.financial_integration_settings s
    where s.provider = 'mercadopago'
      and a.id = s.account_id;

    update public.financial_categories c
    set active = true
    from public.financial_integration_settings s
    where s.provider = 'mercadopago'
      and c.id in (s.revenue_category_id,s.fee_category_id,s.refund_category_id);

    update public.financial_integration_settings
    set active = true
    where provider = 'mercadopago'
      and not active;

    return;
  end if;

  select coalesce(
    (
      select ur.user_id
      from public.user_roles ur
      where ur.role = 'manager'
      order by ur.created_at
      limit 1
    ),
    o.customer_id
  )
  into actor
  from public.payments p
  join public.orders o on o.id = p.order_id
  where p.id = p_payment_id;

  if actor is null then
    return;
  end if;

  select id
  into account_id
  from public.financial_accounts
  where lower(name) = 'mercado pago'
  limit 1;

  if account_id is null then
    insert into public.financial_accounts(
      name,
      initial_balance,
      active,
      created_by
    )
    values(
      'Mercado Pago',
      0,
      true,
      actor
    )
    on conflict do nothing;

    select id
    into account_id
    from public.financial_accounts
    where lower(name) = 'mercado pago'
    limit 1;
  else
    update public.financial_accounts
    set active = true,
        name = 'Mercado Pago'
    where id = account_id;
  end if;

  select id
  into revenue_id
  from public.financial_categories
  where lower(name) = 'loja online'
    and active
    and not is_group
    and kind in ('income','both')
  limit 1;

  if revenue_id is null then
    select id
    into sales_group_id
    from public.financial_categories
    where lower(name) = 'receita de vendas'
      and active
      and is_group
      and kind in ('income','both')
    limit 1;

    if sales_group_id is null then
      insert into public.financial_categories(
        name,
        kind,
        is_group,
        active,
        created_by,
        updated_by
      )
      values(
        'Receita de vendas',
        'income',
        true,
        true,
        actor,
        actor
      )
      on conflict do nothing;

      select id
      into sales_group_id
      from public.financial_categories
      where lower(name) = 'receita de vendas'
        and active
        and is_group
        and kind in ('income','both')
      limit 1;
    end if;

    insert into public.financial_categories(
      name,
      code,
      kind,
      parent_id,
      is_group,
      active,
      created_by,
      updated_by
    )
    values(
      'Loja online',
      'SITE',
      'income',
      sales_group_id,
      false,
      true,
      actor,
      actor
    )
    on conflict do nothing;

    select id
    into revenue_id
    from public.financial_categories
    where lower(name) = 'loja online'
      and active
      and not is_group
      and kind in ('income','both')
    limit 1;
  end if;

  if revenue_id is null then
    select id
    into revenue_id
    from public.financial_categories
    where active
      and not is_group
      and kind in ('income','both')
    order by created_at
    limit 1;
  end if;

  select id
  into fee_id
  from public.financial_categories
  where lower(name) = 'taxas mercado pago'
    and active
    and not is_group
    and kind in ('expense','both')
  limit 1;

  if fee_id is null then
    insert into public.financial_categories(
      name,
      code,
      kind,
      is_group,
      active,
      created_by,
      updated_by
    )
    values(
      'Taxas Mercado Pago',
      'MP-TAXA',
      'expense',
      false,
      true,
      actor,
      actor
    )
    on conflict do nothing;

    select id
    into fee_id
    from public.financial_categories
    where lower(name) = 'taxas mercado pago'
      and active
      and not is_group
      and kind in ('expense','both')
    limit 1;
  end if;

  if fee_id is null then
    select id
    into fee_id
    from public.financial_categories
    where active
      and not is_group
      and kind in ('expense','both')
    order by created_at
    limit 1;
  end if;

  select id
  into refund_id
  from public.financial_categories
  where lower(name) = 'reembolsos de vendas'
    and active
    and not is_group
    and kind in ('expense','both')
  limit 1;

  if refund_id is null then
    insert into public.financial_categories(
      name,
      code,
      kind,
      is_group,
      active,
      created_by,
      updated_by
    )
    values(
      'Reembolsos de vendas',
      'MP-REEMB',
      'expense',
      false,
      true,
      actor,
      actor
    )
    on conflict do nothing;

    select id
    into refund_id
    from public.financial_categories
    where lower(name) = 'reembolsos de vendas'
      and active
      and not is_group
      and kind in ('expense','both')
    limit 1;
  end if;

  if refund_id is null then
    refund_id := fee_id;
  end if;

  if account_id is null
    or revenue_id is null
    or fee_id is null
    or refund_id is null
  then
    return;
  end if;

  insert into public.financial_integration_settings(
    provider,
    account_id,
    revenue_category_id,
    fee_category_id,
    refund_category_id,
    active,
    updated_by
  )
  values(
    'mercadopago',
    account_id,
    revenue_id,
    fee_id,
    refund_id,
    true,
    actor
  )
  on conflict(provider) do nothing;
end;
$$;

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
      payment_row.paid_at::date,
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
    order_row.created_at::date,
    coalesce(
      payment_row.expires_at::date,
      order_row.created_at::date
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

create or replace function private.sync_mercadopago_refund(
  p_refund_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  refund_row public.payment_refunds%rowtype;
  payment_row public.payments%rowtype;
  order_row public.orders%rowtype;
  settings public.financial_integration_settings%rowtype;
  refund_payable public.accounts_payable%rowtype;
  refund_date date;
begin
  select *
  into refund_row
  from public.payment_refunds
  where id = p_refund_id
    and status = 'completed'
  for update;

  if refund_row.id is null then
    return;
  end if;

  select *
  into settings
  from public.financial_integration_settings
  where provider = 'mercadopago'
    and active;

  if settings.provider is null then
    return;
  end if;

  select *
  into payment_row
  from public.payments
  where id = refund_row.payment_id;

  select *
  into order_row
  from public.orders
  where id = refund_row.order_id;

  refund_date :=
    coalesce(
      refund_row.completed_at::date,
      (now() at time zone 'America/Sao_Paulo')::date
    );

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
    payment_refund_id,
    provider_reference
  )
  values (
    refund_row.id,
    1,
    1,
    coalesce(order_row.customer_name_snapshot,'Cliente'),
    'Reembolso Mercado Pago · Pedido ' ||
      coalesce(
        order_row.public_code,
        refund_row.order_id::text
      ),
    settings.refund_category_id,
    refund_date,
    refund_date,
    refund_date,
    refund_row.provider_refund_id,
    refund_row.amount,
    settings.account_id,
    refund_row.reason,
    'paid',
    settings.updated_by,
    settings.updated_by,
    'mercadopago_refund',
    payment_row.id,
    refund_row.id,
    refund_row.provider_refund_id
  )
  on conflict (payment_refund_id)
  where payment_refund_id is not null
  do update set
    category_id = excluded.category_id,
    amount = excluded.amount,
    paid_on = excluded.paid_on,
    source_account_id = excluded.source_account_id,
    provider_reference = excluded.provider_reference,
    updated_by = settings.updated_by
  returning * into refund_payable;

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
    refund_payable.description,
    settings.refund_category_id,
    settings.account_id,
    refund_payable.amount,
    refund_date,
    'payable',
    refund_payable.id,
    'Reembolso vinculado ao pagamento ' ||
      coalesce(
        payment_row.provider_payment_id,
        payment_row.id::text
      ),
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

  update public.accounts_receivable
  set
    refunded_amount = coalesce(
      (
        select sum(r.amount)
        from public.payment_refunds r
        where r.payment_id = refund_row.payment_id
          and r.status = 'completed'
      ),
      0
    ),
    updated_by = settings.updated_by
  where payment_id = refund_row.payment_id;
end;
$$;

create or replace function private.on_mercadopago_payment_financial_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.provider = 'mercadopago' then
    perform private.sync_mercadopago_financial_payment(new.id);
  end if;

  return new;
end;
$$;

create trigger sync_mercadopago_payment_financial
after insert or update of
  status,
  paid_at,
  provider_payment_id,
  provider_fee,
  provider_fee_confirmed,
  net_received_amount,
  installments,
  payment_method_summary
on public.payments
for each row
execute function private.on_mercadopago_payment_financial_sync();

create or replace function private.on_mercadopago_refund_financial_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'completed' then
    perform private.sync_mercadopago_refund(new.id);
  end if;

  return new;
end;
$$;

create trigger sync_mercadopago_refund_financial
after insert or update of
  status,
  amount,
  provider_refund_id
on public.payment_refunds
for each row
execute function private.on_mercadopago_refund_financial_sync();

alter function public.finalize_mercadopago_payment(
  text,
  text,
  text,
  numeric,
  text,
  public.payment_status,
  timestamptz
)
rename to finalize_mercadopago_payment_commerce_v3;

revoke all
on function public.finalize_mercadopago_payment_commerce_v3(
  text,
  text,
  text,
  numeric,
  text,
  public.payment_status,
  timestamptz
)
from public, anon, authenticated, service_role;

create or replace function public.finalize_mercadopago_payment(
  p_provider_event_id text,
  p_provider_payment_id text,
  p_external_reference text,
  p_amount numeric,
  p_currency text,
  p_status public.payment_status,
  p_paid_at timestamptz default null,
  p_provider_fee numeric default null,
  p_net_received_amount numeric default null,
  p_payment_method text default null,
  p_installments integer default null,
  p_status_detail text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  local_payment public.payments%rowtype;
  previous_order_status public.order_status;
  financial_state_changed boolean;
begin
  select *
  into local_payment
  from public.payments
  where external_reference = p_external_reference
  for update;

  if local_payment.id is null
    or local_payment.amount <> p_amount
    or local_payment.currency <> p_currency
    or (
      local_payment.provider_payment_id is not null
      and local_payment.provider_payment_id <> p_provider_payment_id
    )
    or p_provider_fee < 0
    or p_net_received_amount < 0
    or p_net_received_amount > p_amount
    or p_provider_fee > p_amount
    or (
      p_installments is not null
      and p_installments < 1
    )
  then
    update public.payment_events
    set
      processing_status = 'manual_review',
      processed_at = now(),
      error_summary = 'payment_mismatch'
    where provider = 'mercadopago'
      and provider_event_id = p_provider_event_id;

    return 'manual_review';
  end if;

  if (
    local_payment.status = 'approved'
    and p_status in ('pending','rejected','cancelled')
  )
  or (
    local_payment.status = 'refunded'
    and p_status <> 'refunded'
  )
  then
    update public.payment_events
    set
      processing_status = 'processed',
      processed_at = now(),
      error_summary = null
    where provider = 'mercadopago'
      and provider_event_id = p_provider_event_id;

    return 'processed';
  end if;

  financial_state_changed :=
    local_payment.status is distinct from p_status
    or local_payment.provider_payment_id is distinct from p_provider_payment_id
    or (
      p_provider_fee is not null
      and not local_payment.provider_fee_confirmed
    )
    or (
      p_provider_fee is not null
      and local_payment.provider_fee is distinct from p_provider_fee
    )
    or (
      p_net_received_amount is not null
      and local_payment.net_received_amount is distinct from p_net_received_amount
    )
    or (
      p_installments is not null
      and local_payment.installments is distinct from p_installments
    )
    or (
      p_status = 'approved'
      and p_paid_at is not null
      and local_payment.paid_at is distinct from p_paid_at
    )
    or (
      nullif(trim(p_payment_method),'') is not null
      and local_payment.payment_method_summary is distinct from
        nullif(trim(p_payment_method),'')
    );

  update public.payments
  set
    provider_payment_id = p_provider_payment_id,
    status = p_status,
    status_detail = coalesce(p_status_detail,status_detail),
    provider_fee = coalesce(p_provider_fee,provider_fee),
    provider_fee_confirmed =
      provider_fee_confirmed or p_provider_fee is not null,
    net_received_amount =
      coalesce(p_net_received_amount,net_received_amount),
    payment_method_summary =
      coalesce(
        nullif(trim(p_payment_method),''),
        payment_method_summary
      ),
    installments = coalesce(p_installments,installments),
    paid_at =
      case
        when p_status = 'approved'
          then coalesce(p_paid_at,paid_at,now())
        else paid_at
      end,
    updated_at = now()
  where id = local_payment.id;

  update public.payment_attempts
  set
    status = p_status,
    status_detail = coalesce(p_status_detail,status_detail),
    updated_at = now()
  where provider = 'mercadopago'
    and provider_payment_id = p_provider_payment_id;

  if p_status = 'approved'
    and local_payment.status <> 'approved'
  then
    perform private.convert_order_reservations(local_payment.order_id);

    update public.orders
    set
      status = 'payment_approved',
      payment_status = 'approved',
      placed_at = coalesce(placed_at,now()),
      updated_at = now()
    where id = local_payment.order_id
      and status = 'pending_payment';

  elsif p_status = 'cancelled' then
    select status
    into previous_order_status
    from public.orders
    where id = local_payment.order_id
    for update;

    perform private.release_order_reservations(local_payment.order_id);

    update public.orders
    set
      status = 'cancelled',
      payment_status = 'cancelled',
      updated_at = now()
    where id = local_payment.order_id
      and status = 'pending_payment';

    if previous_order_status = 'pending_payment' then
      insert into public.order_status_history(
        order_id,
        previous_status,
        new_status,
        reason
      )
      values(
        local_payment.order_id,
        previous_order_status,
        'cancelled',
        'Pagamento cancelado pelo provedor'
      );
    end if;

  elsif p_status = 'rejected' then
    update public.orders
    set
      payment_status = 'rejected',
      updated_at = now()
    where id = local_payment.order_id
      and status = 'pending_payment';

  elsif p_status in ('charged_back','in_review') then
    update public.orders
    set
      status = 'manual_review',
      payment_status = p_status,
      updated_at = now()
    where id = local_payment.order_id;

  elsif p_status = 'refunded' then
    update public.orders
    set
      status = 'refunded',
      payment_status = 'refunded',
      updated_at = now()
    where id = local_payment.order_id;

  else
    update public.orders
    set
      payment_status = p_status,
      updated_at = now()
    where id = local_payment.order_id;
  end if;

  if financial_state_changed then
    insert into public.audit_logs(
      action,
      entity_type,
      entity_id,
      new_data_sanitized,
      reason
    )
    values(
      'financial.mercadopago.' || p_status::text,
      'financial.payment',
      local_payment.id,
      jsonb_build_object(
        'order_id',
        local_payment.order_id,
        'provider_payment_id',
        p_provider_payment_id,
        'status',
        p_status,
        'gross_amount',
        p_amount,
        'provider_fee',
        p_provider_fee,
        'net_received_amount',
        p_net_received_amount,
        'payment_method',
        p_payment_method,
        'installments',
        p_installments,
        'provider_event_id',
        p_provider_event_id
      ),
      'Reconciliação automática por backend confiável'
    );
  end if;

  update public.payment_events
  set
    processing_status = 'processed',
    processed_at = now(),
    error_summary = null
  where provider = 'mercadopago'
    and provider_event_id = p_provider_event_id;

  return 'processed';
end;
$$;

revoke all
on function public.finalize_mercadopago_payment(
  text,
  text,
  text,
  numeric,
  text,
  public.payment_status,
  timestamptz,
  numeric,
  numeric,
  text,
  integer,
  text
)
from public, anon, authenticated;

grant execute
on function public.finalize_mercadopago_payment(
  text,
  text,
  text,
  numeric,
  text,
  public.payment_status,
  timestamptz,
  numeric,
  numeric,
  text,
  integer,
  text
)
to service_role;

alter table public.payment_refunds
  alter column requested_by drop not null;

alter table public.payment_refunds
  add column if not exists source text not null default 'manager'
    check (source in ('manager','provider'));

alter function public.finalize_mercadopago_refund(
  uuid,
  text,
  uuid
)
rename to finalize_mercadopago_refund_full_v1;

revoke all
on function public.finalize_mercadopago_refund_full_v1(
  uuid,
  text,
  uuid
)
from public, anon, authenticated, service_role;

create or replace function public.begin_mercadopago_refund(
  p_payment_id uuid,
  p_requested_by uuid,
  p_refund_amount numeric,
  p_idempotency_key uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment_row public.payments%rowtype;
  refund_row public.payment_refunds%rowtype;
  reserved_total numeric(12,2);
begin
  if p_refund_amount <= 0
    or char_length(trim(p_reason)) not between 3 and 500
    or not exists (
      select 1
      from public.user_roles
      where user_id = p_requested_by
        and role = 'manager'
    )
  then
    raise exception 'invalid refund request';
  end if;

  select *
  into payment_row
  from public.payments
  where id = p_payment_id
  for update;

  if payment_row.id is null
    or payment_row.provider <> 'mercadopago'
    or payment_row.status not in ('approved','refunded')
  then
    raise exception 'payment not refundable';
  end if;

  select *
  into refund_row
  from public.payment_refunds
  where idempotency_key = p_idempotency_key
  for update;

  if refund_row.id is not null then
    if refund_row.payment_id <> p_payment_id
      or refund_row.amount <> p_refund_amount
      or refund_row.requested_by is distinct from p_requested_by
    then
      raise exception 'refund idempotency conflict';
    end if;

    if refund_row.status = 'failed' then
      update public.payment_refunds
      set
        status = 'pending',
        attempts = attempts + 1,
        error_summary = null,
        updated_at = now()
      where id = refund_row.id;
    end if;

    return refund_row.id;
  end if;

  select coalesce(sum(amount),0)
  into reserved_total
  from public.payment_refunds
  where payment_id = p_payment_id
    and status in ('pending','completed');

  if reserved_total + p_refund_amount > payment_row.amount then
    raise exception 'refund exceeds payment';
  end if;

  insert into public.payment_refunds(
    payment_id,
    order_id,
    amount,
    currency,
    status,
    reason,
    requested_by,
    attempts,
    idempotency_key,
    source
  )
  values (
    payment_row.id,
    payment_row.order_id,
    p_refund_amount,
    payment_row.currency,
    'pending',
    trim(p_reason),
    p_requested_by,
    1,
    p_idempotency_key,
    'manager'
  )
  returning * into refund_row;

  return refund_row.id;
end;
$$;

revoke all
on function public.begin_mercadopago_refund(
  uuid,
  uuid,
  numeric,
  uuid,
  text
)
from public, anon, authenticated;

grant execute
on function public.begin_mercadopago_refund(
  uuid,
  uuid,
  numeric,
  uuid,
  text
)
to service_role;

create or replace function public.finalize_mercadopago_refund(
  p_payment_id uuid,
  p_provider_refund_id text,
  p_requested_by uuid,
  p_refund_amount numeric,
  p_idempotency_key uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment_row public.payments%rowtype;
  refund_row public.payment_refunds%rowtype;
  actor_role public.app_role;
  refunded_total numeric(12,2);
  previous_order_status public.order_status;
begin
  select *
  into payment_row
  from public.payments
  where id = p_payment_id
  for update;

  select *
  into refund_row
  from public.payment_refunds
  where payment_id = p_payment_id
    and idempotency_key = p_idempotency_key
  for update;

  if refund_row.id is not null
    and refund_row.status = 'completed'
    and refund_row.provider_refund_id = p_provider_refund_id
    and refund_row.amount = p_refund_amount
    and refund_row.requested_by is not distinct from p_requested_by
  then
    return true;
  end if;

  if payment_row.id is null
    or payment_row.status not in ('approved','refunded')
    or refund_row.id is null
    or refund_row.status <> 'pending'
    or refund_row.amount <> p_refund_amount
    or refund_row.requested_by is distinct from p_requested_by
    or p_refund_amount <= 0
  then
    raise exception 'refund state mismatch';
  end if;

  select role
  into actor_role
  from public.user_roles
  where user_id = p_requested_by
    and role = 'manager'
  limit 1;

  if actor_role is null then
    raise exception 'refund actor is not authorized';
  end if;

  select coalesce(sum(amount),0)
  into refunded_total
  from public.payment_refunds
  where payment_id = p_payment_id
    and status = 'completed'
    and id <> refund_row.id;

  if refunded_total + p_refund_amount > payment_row.amount then
    raise exception 'refund exceeds payment';
  end if;

  update public.payment_refunds
  set
    status = 'completed',
    provider_refund_id = p_provider_refund_id,
    completed_at = now(),
    updated_at = now(),
    error_summary = null,
    source = 'manager'
  where id = refund_row.id;

  refunded_total := refunded_total + p_refund_amount;

  if refunded_total = payment_row.amount then
    select status
    into previous_order_status
    from public.orders
    where id = payment_row.order_id
    for update;

    update public.payments
    set
      status = 'refunded',
      updated_at = now()
    where id = payment_row.id;

    update public.orders
    set
      status = 'refunded',
      payment_status = 'refunded',
      updated_at = now()
    where id = payment_row.order_id;

    insert into public.order_status_history(
      order_id,
      previous_status,
      new_status,
      reason,
      changed_by
    )
    values(
      payment_row.order_id,
      previous_order_status,
      'refunded',
      refund_row.reason,
      p_requested_by
    );
  end if;

  insert into public.audit_logs(
    actor_id,
    actor_role,
    action,
    entity_type,
    entity_id,
    new_data_sanitized,
    reason
  )
  values(
    p_requested_by,
    actor_role,
    'payment.refund',
    'payment',
    payment_row.id,
    jsonb_build_object(
      'refund_id',
      refund_row.id,
      'provider_refund_id',
      p_provider_refund_id,
      'amount',
      p_refund_amount,
      'refunded_total',
      refunded_total,
      'currency',
      refund_row.currency
    ),
    refund_row.reason
  );

  return true;
end;
$$;

revoke all
on function public.finalize_mercadopago_refund(
  uuid,
  text,
  uuid,
  numeric,
  uuid
)
from public, anon, authenticated;

grant execute
on function public.finalize_mercadopago_refund(
  uuid,
  text,
  uuid,
  numeric,
  uuid
)
to service_role;

create or replace function public.reconcile_mercadopago_provider_refund(
  p_provider_payment_id text,
  p_provider_refund_id text,
  p_amount numeric,
  p_provider_event_id text,
  p_completed_at timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment_row public.payments%rowtype;
  existing_refund public.payment_refunds%rowtype;
  refund_id uuid;
  refunded_total numeric(12,2);
begin
  if nullif(trim(p_provider_refund_id),'') is null
    or p_amount <= 0
  then
    raise exception 'invalid provider refund';
  end if;

  select *
  into payment_row
  from public.payments
  where provider = 'mercadopago'
    and provider_payment_id = p_provider_payment_id
  for update;

  if payment_row.id is null then
    raise exception 'payment not found';
  end if;

  select *
  into existing_refund
  from public.payment_refunds
  where provider_refund_id = p_provider_refund_id;

  if existing_refund.id is not null then
    if existing_refund.payment_id <> payment_row.id
      or existing_refund.amount <> p_amount
    then
      raise exception 'provider refund conflict';
    end if;

    return true;
  end if;

  insert into public.payment_refunds(
    payment_id,
    order_id,
    provider_refund_id,
    amount,
    currency,
    status,
    reason,
    requested_by,
    idempotency_key,
    source,
    completed_at
  )
  values (
    payment_row.id,
    payment_row.order_id,
    p_provider_refund_id,
    p_amount,
    payment_row.currency,
    'completed',
    'Reembolso confirmado pelo Mercado Pago',
    null,
    gen_random_uuid(),
    'provider',
    coalesce(p_completed_at,now())
  )
  returning id into refund_id;

  select coalesce(sum(amount),0)
  into refunded_total
  from public.payment_refunds
  where payment_id = payment_row.id
    and status = 'completed';

  if refunded_total > payment_row.amount then
    raise exception 'provider refunds exceed payment';
  end if;

  if refunded_total = payment_row.amount then
    update public.payments
    set
      status = 'refunded',
      updated_at = now()
    where id = payment_row.id;

    update public.orders
    set
      status = 'refunded',
      payment_status = 'refunded',
      updated_at = now()
    where id = payment_row.order_id;
  end if;

  insert into public.audit_logs(
    action,
    entity_type,
    entity_id,
    new_data_sanitized,
    reason
  )
  values(
    'financial.mercadopago.refund',
    'financial.payment_refund',
    refund_id,
    jsonb_build_object(
      'payment_id',
      payment_row.id,
      'provider_payment_id',
      p_provider_payment_id,
      'provider_refund_id',
      p_provider_refund_id,
      'provider_event_id',
      p_provider_event_id,
      'amount',
      p_amount,
      'refunded_total',
      refunded_total
    ),
    'Reembolso reconciliado pelo webhook confiável'
  );

  return true;
end;
$$;

revoke all
on function public.reconcile_mercadopago_provider_refund(
  text,
  text,
  numeric,
  text,
  timestamptz
)
from public, anon, authenticated;

grant execute
on function public.reconcile_mercadopago_provider_refund(
  text,
  text,
  numeric,
  text,
  timestamptz
)
to service_role;

alter function public.financial_control_mutate(text,jsonb)
rename to financial_control_mutate_categories_v2;

revoke all
on function public.financial_control_mutate_categories_v2(text,jsonb)
from public, anon, authenticated;

create or replace function public.financial_control_mutate(
  p_action text,
  p_payload jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  account_id uuid;
  transfer_row public.financial_transfers%rowtype;
  settings_row public.financial_integration_settings%rowtype;
  payment_row record;
  refund_row record;
begin
  perform private.require_permission('finance.manage');

  if p_payload is null
    or jsonb_typeof(p_payload) <> 'object'
  then
    raise exception 'invalid payload';
  end if;

  if p_action = 'mercadopago.settings.save' then
    select id
    into account_id
    from public.financial_accounts
    where lower(name) = 'mercado pago'
    for update;

    if account_id is null then
      insert into public.financial_accounts(
        name,
        initial_balance,
        active,
        created_by
      )
      values(
        'Mercado Pago',
        0,
        true,
        actor
      )
      returning id into account_id;
    else
      update public.financial_accounts
      set active = true,
          name = 'Mercado Pago'
      where id = account_id;
    end if;

    insert into public.financial_integration_settings(
      provider,
      account_id,
      revenue_category_id,
      fee_category_id,
      refund_category_id,
      active,
      updated_by
    )
    values (
      'mercadopago',
      account_id,
      (p_payload->>'revenue_category_id')::uuid,
      (p_payload->>'fee_category_id')::uuid,
      (p_payload->>'refund_category_id')::uuid,
      true,
      actor
    )
    on conflict(provider)
    do update set
      account_id = excluded.account_id,
      revenue_category_id = excluded.revenue_category_id,
      fee_category_id = excluded.fee_category_id,
      refund_category_id = excluded.refund_category_id,
      active = true,
      updated_by = actor
    returning * into settings_row;

    for payment_row in
      select id
      from public.payments
      where provider = 'mercadopago'
    loop
      perform private.sync_mercadopago_financial_payment(payment_row.id);
    end loop;

    for refund_row in
      select id
      from public.payment_refunds
      where status = 'completed'
    loop
      perform private.sync_mercadopago_refund(refund_row.id);
    end loop;

    insert into public.audit_logs(
      actor_id,
      actor_role,
      action,
      entity_type,
      entity_id,
      new_data_sanitized
    )
    values(
      actor,
      private.current_app_role(),
      p_action,
      'financial.integration',
      account_id,
      to_jsonb(settings_row)
    );

    return jsonb_build_object(
      'id',
      account_id,
      'action',
      p_action
    );

  elsif p_action = 'transfer.save' then
    if (p_payload->>'amount_cents')::bigint <= 0
      or (p_payload->>'source_account_id')::uuid =
        (p_payload->>'destination_account_id')::uuid
      or not exists (
        select 1
        from public.financial_accounts
        where id = (p_payload->>'source_account_id')::uuid
          and active
      )
      or not exists (
        select 1
        from public.financial_accounts
        where id = (p_payload->>'destination_account_id')::uuid
          and active
      )
    then
      raise exception 'invalid financial transfer';
    end if;

    insert into public.financial_transfers(
      source_account_id,
      destination_account_id,
      amount,
      occurred_on,
      description,
      external_reference,
      created_by
    )
    values (
      (p_payload->>'source_account_id')::uuid,
      (p_payload->>'destination_account_id')::uuid,
      (p_payload->>'amount_cents')::bigint / 100.0,
      (p_payload->>'occurred_on')::date,
      trim(p_payload->>'description'),
      nullif(trim(p_payload->>'external_reference'),''),
      actor
    )
    returning * into transfer_row;

    insert into public.financial_transactions(
      type,
      description,
      account_id,
      amount,
      occurred_on,
      origin,
      transfer_id,
      notes,
      created_by,
      updated_by,
      affects_result
    )
    values
      (
        'expense',
        transfer_row.description,
        transfer_row.source_account_id,
        transfer_row.amount,
        transfer_row.occurred_on,
        'transfer',
        transfer_row.id,
        'Transferência entre contas',
        actor,
        actor,
        false
      ),
      (
        'income',
        transfer_row.description,
        transfer_row.destination_account_id,
        transfer_row.amount,
        transfer_row.occurred_on,
        'transfer',
        transfer_row.id,
        'Transferência entre contas',
        actor,
        actor,
        false
      );

    insert into public.audit_logs(
      actor_id,
      actor_role,
      action,
      entity_type,
      entity_id,
      new_data_sanitized
    )
    values(
      actor,
      private.current_app_role(),
      p_action,
      'financial.transfer',
      transfer_row.id,
      to_jsonb(transfer_row)
    );

    return jsonb_build_object(
      'id',
      transfer_row.id,
      'action',
      p_action
    );
  end if;

  if p_action in (
    'receivable.update',
    'receivable.settle',
    'receivable.reverse',
    'receivable.delete'
  )
  and exists (
    select 1
    from public.accounts_receivable
    where id = (p_payload->>'id')::uuid
      and origin <> 'manual'
  )
  then
    raise exception 'automatic receivable must be reconciled by provider';
  end if;

  if p_action in (
    'payable.update',
    'payable.settle',
    'payable.reverse',
    'payable.delete'
  )
  and exists (
    select 1
    from public.accounts_payable
    where id = (p_payload->>'id')::uuid
      and origin <> 'manual'
  )
  then
    raise exception 'automatic payable must be reconciled by provider';
  end if;

  if p_action = 'account.save'
    and nullif(p_payload->>'id','') is not null
    and exists (
      select 1
      from public.financial_integration_settings
      where account_id = (p_payload->>'id')::uuid
    )
    and (
      not coalesce((p_payload->>'active')::boolean,true)
      or lower(trim(p_payload->>'name')) <> 'mercado pago'
    )
  then
    raise exception 'Mercado Pago integration account must remain active';
  end if;

  if p_action = 'category.save'
    and nullif(p_payload->>'id','') is not null
    and (
      not coalesce((p_payload->>'active')::boolean,true)
      or coalesce((p_payload->>'is_group')::boolean,false)
      or exists (
        select 1
        from public.financial_integration_settings s
        where (
          s.revenue_category_id = (p_payload->>'id')::uuid
          and p_payload->>'kind' not in ('income','both')
        )
        or (
          (s.fee_category_id = (p_payload->>'id')::uuid
            or s.refund_category_id = (p_payload->>'id')::uuid)
          and p_payload->>'kind' not in ('expense','both')
        )
      )
    )
    and exists (
      select 1
      from public.financial_integration_settings s
      where (p_payload->>'id')::uuid in (
        s.revenue_category_id,
        s.fee_category_id,
        s.refund_category_id
      )
    )
  then
    raise exception 'Mercado Pago integration category must remain compatible';
  end if;

  return public.financial_control_mutate_categories_v2(
    p_action,
    p_payload
  );
end;
$$;

revoke all
on function public.financial_control_mutate(text,jsonb)
from public, anon;

grant execute
on function public.financial_control_mutate(text,jsonb)
to authenticated;

alter function public.financial_control_snapshot(date,date)
rename to financial_control_snapshot_categories_v2;

revoke all
on function public.financial_control_snapshot_categories_v2(date,date)
from public, anon, authenticated;

create or replace function public.financial_control_snapshot(
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
          from public.financial_transactions
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
          from public.financial_transactions
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
          from public.financial_transactions
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
          from public.financial_transactions
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
    from public.financial_transactions
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
    from public.financial_transactions
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
          from public.accounts_payable p
          where p.origin = 'mercadopago_fee'
            and p.status = 'paid'
            and p.paid_on between p_date_from and p_date_to
        ),
        0
      ) as fees,
      coalesce(
        (
          select sum(p.amount)
          from public.accounts_payable p
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
    from public.accounts_receivable r
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
    from public.accounts_receivable
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
                from public.financial_transactions t
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
        left join public.accounts_receivable r
          on r.id = (item->>'id')::uuid
        left join public.orders o
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
$$;

revoke all
on function public.financial_control_snapshot(date,date)
from public, anon;

grant execute
on function public.financial_control_snapshot(date,date)
to authenticated;

commit;

notify pgrst, 'reload schema';

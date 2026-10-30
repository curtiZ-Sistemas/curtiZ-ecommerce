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


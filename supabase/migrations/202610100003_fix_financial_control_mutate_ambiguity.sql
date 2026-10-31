begin;

-- O wrapper declara a variável PL/pgSQL account_id e a usava sem qualificação em
-- financial_integration_settings: o IF era planejado com "column reference account_id is ambiguous"
-- (42702) e toda ação de public.financial_control_mutate que chegava a ele falhava.
-- Corpo idêntico ao de 202609110003; somente a coluna passa a ser qualificada pelo alias.
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
      from public.financial_integration_settings s
      where s.account_id = (p_payload->>'id')::uuid
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

commit;

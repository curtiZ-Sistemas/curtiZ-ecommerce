create function private.transfer_representative_kit_inventory(
  o private.representative_kit_orders, p_count integer, p_operation text,
  p_reason text, p_reference_type text, p_reference_id uuid, p_operator uuid
) returns void language plpgsql set search_path = ''
as $$
declare
  line record;
  available integer;
  reserved integer;
begin
  if p_count is null or p_count not between 1 and o.quantity
    or p_operation is null or p_operation not in ('release','sell','restock') then
    raise exception 'kit_stock_operation_invalid' using errcode='23514';
  end if;

  for line in
    select stock.variant_id, stock.pairs*p_count as units
    from (
      select o.variant_id as variant_id, 1 as pairs where o.grade_lines is null
      union all
      select (item ->> 'variantId')::uuid, (item ->> 'pairs')::integer
      from jsonb_array_elements(o.grade_lines) item
    ) stock
    order by stock.variant_id
  loop
    update public.inventory
      set reserved_quantity=reserved_quantity-case when p_operation='restock' then 0 else line.units end,
        available_quantity=available_quantity+case when p_operation='sell' then 0 else line.units end,
        version=version+1,updated_at=now()
      where variant_id=line.variant_id and (p_operation='restock' or reserved_quantity>=line.units)
      returning available_quantity,reserved_quantity into available,reserved;
    if not found then raise exception 'kit_stock_inconsistent' using errcode='23514'; end if;
    if p_operation='sell' then
      insert into public.inventory_movements(variant_id,movement_type,quantity,previous_quantity,new_quantity,
        reason,reference_type,reference_id,performed_by)
      values(line.variant_id,'sale',-line.units,available+reserved+line.units,available+reserved,
        p_reason,p_reference_type,p_reference_id,p_operator);
    elsif p_operation='restock' then
      insert into public.inventory_movements(variant_id,movement_type,quantity,previous_quantity,new_quantity,
        reason,reference_type,reference_id,performed_by)
      values(line.variant_id,'return',line.units,available-line.units,available,
        p_reason,p_reference_type,p_reference_id,p_operator);
    end if;
  end loop;
end;
$$;
revoke all on function private.transfer_representative_kit_inventory(
  private.representative_kit_orders,integer,text,text,text,uuid,uuid
) from public, anon, authenticated, service_role;

create or replace function public.cancel_unstarted_representative_kit_order(p_actor uuid, p_order uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  order_row private.representative_kit_orders;
begin
  select * into order_row from private.representative_kit_orders where id = p_order for update;
  if not found or (p_actor is not null and order_row.actor_id <> p_actor) then return false; end if;
  if order_row.state = 'cancelled' then return true; end if;
  if order_row.state <> 'reserved' or order_row.stock_state <> 'reserved'
    or order_row.payment_started_at is not null
    or (p_actor is null and order_row.reserved_until > clock_timestamp()) then return false; end if;

  perform private.transfer_representative_kit_inventory(order_row,order_row.quantity,'release',null,null,null,null);
  update private.representative_kit_orders set state = 'cancelled', stock_state = 'released' where id = p_order;
  return true;
end;
$$;

create or replace function public.settle_representative_kit_payment(
  p_order uuid, p_payment_id text, p_reference text, p_amount bigint, p_currency text,
  p_status text, p_paid_at timestamptz, p_refunds jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  o private.representative_kit_orders;
  refund jsonb;
  refund_total bigint;
  refunded_now bigint;
  next_state text;
  next_stock text;
begin
  select * into o from private.representative_kit_orders where id = p_order for update;
  if not found or o.payment_started_at is null or p_reference is distinct from ('KITMG-' || p_order::text)
    or p_amount is distinct from (o.unit_price_cents * o.quantity + o.shipping_cents)
    or p_currency is distinct from 'BRL' or p_payment_id is null or p_payment_id !~ '^[0-9]{1,30}$'
    or (o.provider_payment_id is not null and o.provider_payment_id <> p_payment_id)
    or p_status is null or jsonb_typeof(p_refunds) is distinct from 'array' or jsonb_array_length(p_refunds) > 100 then
    raise exception 'kit_payment_identity_mismatch' using errcode = '23514';
  end if;

  for refund in select value from jsonb_array_elements(p_refunds) loop
    if coalesce(refund ->> 'id', '') !~ '^[0-9]{1,30}$' or coalesce(refund ->> 'amountInCents','') !~ '^[0-9]{1,15}$' then
      raise exception 'kit_refund_identity_mismatch' using errcode = '23514';
    end if;
    refunded_now := (refund ->> 'amountInCents')::bigint;
    insert into private.representative_kit_provider_refunds(provider_refund_id,order_id,amount_cents)
      values (refund ->> 'id',p_order,refunded_now) on conflict do nothing;
    if not exists (select 1 from private.representative_kit_provider_refunds r
      where r.provider_refund_id = refund ->> 'id' and r.order_id = p_order and r.amount_cents = refunded_now) then
      raise exception 'kit_refund_identity_mismatch' using errcode = '23514';
    end if;
  end loop;
  select coalesce(sum(amount_cents),0) into refund_total from private.representative_kit_provider_refunds where order_id = p_order;
  if refund_total > p_amount then raise exception 'kit_refund_amount_mismatch' using errcode = '23514'; end if;

  next_state := o.state;
  next_stock := o.stock_state;
  if refund_total = p_amount then
    next_state := 'refunded';
    if o.stock_state = 'reserved' then next_stock := 'released'; end if;
  elsif o.state in ('reserved','payment_pending') then
    if p_status = 'approved' and refund_total = 0 and p_paid_at is not null and private.representative_kit_payment_allowed(o) then
      next_state := 'paid';
      next_stock := 'sold';
    elsif p_status in ('cancelled','expired','rejected') and refund_total = 0 then
      next_state := 'cancelled';
      next_stock := 'released';
    elsif p_status in ('pending','in_process') and refund_total = 0 then
      next_state := 'payment_pending';
    else
      next_state := 'manual_review';
    end if;
  elsif (o.state = 'cancelled' and p_status in ('approved','refunded','charged_back'))
    or (o.state = 'paid' and (p_status in ('cancelled','refunded','charged_back','in_mediation') or refund_total > 0)) then
    next_state := 'manual_review';
  end if;

  if o.stock_state = 'reserved' and next_stock <> 'reserved' then
    perform private.transfer_representative_kit_inventory(o,o.quantity,
      case when next_stock='sold' then 'sell' else 'release' end,
      'Pagamento confirmado de kit de revenda MG','representative_kit_order',p_order,o.actor_id);
  end if;

  update private.representative_kit_orders set state = next_state, stock_state = next_stock,
    provider_payment_id = p_payment_id, payment_checked_at = clock_timestamp(),
    paid_at = coalesce(paid_at, case when p_status = 'approved' then p_paid_at end)
    where id = p_order returning * into o;
  return private.representative_kit_order_summary(o) || jsonb_build_object('refundedInCents',refund_total);
end;
$$;

create or replace function private.restore_cancelled_representative_kit_stock()
returns trigger language plpgsql set search_path = '' as $$
declare
  o private.representative_kit_orders;
begin
  if old.provider_refund_id is not null or new.provider_refund_id is null or new.reason <> 'undispatched_cancellation' then return new; end if;
  select * into o from private.representative_kit_orders where id=new.order_id for update;
  if not found or o.state <> 'refunded' or o.stock_state <> 'sold' or o.returned_kit_count <> 0 then return new; end if;
  perform private.transfer_representative_kit_inventory(o,o.quantity,'restock',
    'Estorno confirmado antes da expedição de kit de revenda MG','representative_kit_refund',new.id,o.actor_id);
  update private.representative_kit_orders set stock_state='released',returned_kit_count=o.quantity where id=o.id;
  return new;
end;
$$;

create or replace function private.finalize_representative_kit_return()
returns trigger language plpgsql set search_path = '' as $$
declare
  r private.representative_kit_returns;
  o private.representative_kit_orders;
begin
  if new.reason <> 'accepted_return' then return new; end if;
  if tg_when='BEFORE' then
    if old.started_at is null and new.started_at is not null and not exists(
      select 1 from private.representative_kit_returns q where q.id=new.kit_return_id and q.order_id=new.order_id
        and q.state='refund_pending' and q.invoice_key=new.return_invoice_key and q.refund_cents=new.amount_cents
        and q.invoice_protocol is not null and q.invoice_sha256 is not null
    ) then raise exception 'kit_return_verification_required' using errcode='23514'; end if;
    return new;
  end if;
  if old.provider_refund_id is not null or new.provider_refund_id is null then return new; end if;
  select * into o from private.representative_kit_orders where id=new.order_id for update;
  select * into r from private.representative_kit_returns where id=new.kit_return_id for update;
  if not found or r.state<>'refund_pending' or r.order_id<>o.id or o.returned_kit_count+r.quantity>o.quantity
    then raise exception 'kit_return_stock_mismatch' using errcode='23514'; end if;
  update private.representative_kit_orders set returned_kit_count=returned_kit_count+r.quantity,
    stock_state=case when returned_kit_count+r.quantity=quantity then 'released' else stock_state end where id=o.id;
  if r.restock_quantity>0 then
    perform private.transfer_representative_kit_inventory(o,r.restock_quantity,'restock',
      'Devolução inspecionada de kit de revenda MG','representative_kit_return',r.id,r.inspected_by);
  end if;
  update private.representative_kit_returns set state='completed' where id=r.id;
  return new;
end;
$$;

create or replace function private.representative_kit_payment_allowed(o private.representative_kit_orders)
returns boolean language sql stable set search_path = '' as $$
  select coalesce(private.find_representative_kit_approval_by_fingerprint(o.actor_id,
    coalesce(o.grade_fiscal_fingerprint,public.read_representative_resale_product_fingerprint(o.variant_id)),
    o.shipping_snapshot ->> 'originPostalCode')=o.rule_version_id,false)
  and exists (
    select 1 from public.profiles p join public.representatives r on r.user_id=p.id
    join public.addresses a on a.user_id=p.id
    join private.representative_kit_checkout_approvals buyer on buyer.actor_id=p.id and buyer.rule_version_id=o.rule_version_id
    where p.id=o.actor_id and p.status='active' and r.status in ('approved_waiting_kit','active','unqualified')
      and a.id=o.address_id and a.state='MG' and a.country='BR'
      and a.updated_at=(o.shipping_snapshot -> 'address' ->> 'version')::timestamptz
      and regexp_replace(a.postal_code,'[^0-9]','','g')=o.shipping_snapshot -> 'address' ->> 'postalCode'
      and o.buyer_snapshot=jsonb_build_object('name',buyer.buyer_legal_name,'document',buyer.buyer_document,
        'registration',buyer.buyer_state_registration,'address',buyer.buyer_fiscal_address)
  );
$$;

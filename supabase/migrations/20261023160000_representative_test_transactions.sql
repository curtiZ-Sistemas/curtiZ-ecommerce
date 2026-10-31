-- Separate, TEST-only aggregate. Never creates B2C orders/payments or releases fiscal jobs.
alter table public.kit_orders alter column kit_id drop not null;
alter table public.kit_orders add column catalog_variant_id uuid references public.product_variants(id);
alter table public.kit_orders add constraint kit_order_catalog_or_offer check (kit_id is not null or catalog_variant_id is not null);

create table private.kit_test_transactions (
  order_id uuid primary key,
  actor_id uuid not null references public.profiles(id),
  variant_id uuid not null references public.product_variants(id),
  quantity integer not null check(quantity between 1 and 99),
  unit_price_cents bigint not null check(unit_price_cents>0),
  shipping_cents bigint not null check(shipping_cents>=0),
  shipping_quote_id uuid not null unique references public.shipping_quotes(id),
  idempotency_key uuid not null,
  state text not null default 'reserved' check(state in('reserved','paid','cancelled','refunded','reconciliation_required')),
  stock_state text not null default 'reserved' check(stock_state in('reserved','sold','released')),
  provider_payment_id text unique,
  payment_key uuid not null default gen_random_uuid(),
  payment_fingerprint text,
  payment_started_at timestamptz,
  lock_id uuid,
  locked_until timestamptz,
  refunded_cents bigint not null default 0,
  created_at timestamptz not null default now(),
  unique(actor_id,idempotency_key),
  check(refunded_cents between 0 and unit_price_cents*quantity+shipping_cents)
);
alter table private.kit_test_transactions enable row level security;
alter table private.kit_test_transactions force row level security;
revoke all on private.kit_test_transactions from public,anon,authenticated,service_role;

create table private.kit_test_refunds (
  order_id uuid not null references private.kit_test_transactions(order_id),
  idempotency_key uuid not null,
  amount_cents bigint not null check(amount_cents>0),
  provider_refund_id text unique,
  state text not null default 'pending' check(state in('pending','completed')),
  created_at timestamptz not null default now(),
  primary key(order_id,idempotency_key)
);
alter table private.kit_test_refunds enable row level security;
alter table private.kit_test_refunds force row level security;
revoke all on private.kit_test_refunds from public,anon,authenticated,service_role;

create table private.kit_test_events (
  order_id uuid not null references private.kit_test_transactions(order_id),
  kind text not null check(kind in('payment_confirmed','cancelled','refund_confirmed')),
  event_key text not null,
  payload jsonb not null,
  -- Consumers require a separate fiscal decision and recipient validation.
  dispatch_state text not null default 'blocked_validation' check(dispatch_state='blocked_validation'),
  created_at timestamptz not null default now(),
  primary key(order_id,event_key)
);
alter table private.kit_test_events enable row level security;
alter table private.kit_test_events force row level security;
revoke all on private.kit_test_events from public,anon,authenticated,service_role;

create or replace function private.guard_representative_resale_homologation()
returns trigger language plpgsql security definer set search_path='' as $$
declare tx private.kit_test_transactions;
begin
  select * into tx from private.kit_test_transactions where order_id=new.id;
  if found then
    if new.kit_id is not null or new.catalog_variant_id is distinct from tx.variant_id
      or new.total_in_cents<>tx.unit_price_cents*tx.quantity+tx.shipping_cents
      or not exists(select 1 from public.representatives r where r.id=new.representative_id and r.user_id=tx.actor_id)
      or new.shipped_at is not null or new.delivered_at is not null
      or new.status::text<>(case tx.state when 'paid' then 'paid' when 'refunded' then 'refunded'
        when 'cancelled' then 'cancelled' else 'pending_payment' end) then
      raise exception 'resale_not_homologated' using errcode='23514';
    end if;
    return new;
  end if;
  if tg_op='INSERT' or (new.status is distinct from old.status and new.status not in('cancelled','refunded'))
    or new.paid_at is distinct from old.paid_at or new.payment_reference is distinct from old.payment_reference
    or new.shipped_at is distinct from old.shipped_at or new.delivered_at is distinct from old.delivered_at then
    raise exception 'resale_not_homologated' using errcode='23514';
  end if;
  return new;
end;
$$;

create function public.create_kit_test_transaction(p_actor uuid,p_variant uuid,p_quantity integer,p_quote uuid,p_fingerprint text,p_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare tx private.kit_test_transactions; rep public.representatives; variant public.product_variants;
  product public.products; quote public.shipping_quotes; cents bigint; identifier uuid:=gen_random_uuid();
begin
  if p_actor is null or p_key is null or p_quantity is null or p_quantity not between 1 and 99 then raise exception 'invalid_kit_request'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text||p_key::text,0));
  select * into tx from private.kit_test_transactions where actor_id=p_actor and idempotency_key=p_key for update;
  if found then
    if tx.variant_id<>p_variant or tx.quantity<>p_quantity or tx.shipping_quote_id<>p_quote then raise exception 'kit_idempotency_conflict'; end if;
    return jsonb_build_object('orderId',tx.order_id,'mode','test','state',tx.state);
  end if;
  select r.* into rep from public.representatives r join public.profiles p on p.id=r.user_id
    where r.user_id=p_actor and p.status='active' and r.status in('approved_waiting_kit','active','unqualified') for share of r,p;
  if not found then raise exception 'kit_access_denied' using errcode='42501'; end if;
  select * into variant from public.product_variants where id=p_variant and active for share;
  if not found then raise exception 'kit_unavailable'; end if;
  select * into product from public.products where id=variant.product_id and status='active' for share;
  if not found or not exists(select 1 from private.bling_catalog_metadata where product_id=product.id and pairs_per_sku>1) then raise exception 'kit_unavailable'; end if;
  cents:=round(coalesce(variant.price_override,product.base_price)*100)::bigint;
  if cents<=0 then raise exception 'kit_invalid_price'; end if;
  select * into quote from public.shipping_quotes where id=p_quote and customer_id=p_actor and provider_environment='sandbox'
    and used_at is null and expires_at>now() and cart_fingerprint=p_fingerprint for update;
  if not found or nullif(p_fingerprint,'') is null or quote.amount<0 then raise exception 'kit_quote_expired'; end if;
  perform 1 from public.inventory where variant_id=p_variant for update;
  update public.inventory set available_quantity=available_quantity-p_quantity,reserved_quantity=reserved_quantity+p_quantity,
    version=version+1,updated_at=now() where variant_id=p_variant and available_quantity>=p_quantity;
  if not found then raise exception 'insufficient stock'; end if;
  insert into private.kit_test_transactions(order_id,actor_id,variant_id,quantity,unit_price_cents,shipping_cents,shipping_quote_id,idempotency_key)
    values(identifier,p_actor,p_variant,p_quantity,cents,round(quote.amount*100)::bigint,p_quote,p_key);
  insert into public.kit_orders(id,representative_id,kit_id,catalog_variant_id,total_in_cents,kit_snapshot,shipping_snapshot,idempotency_key)
    values(identifier,rep.id,null,p_variant,cents*p_quantity+round(quote.amount*100)::bigint,
      jsonb_build_object('mode','test','sku',variant.sku,'name',product.name,'quantity',p_quantity,'unitPriceInCents',cents),
      jsonb_build_object('quoteId',quote.id,'serviceId',quote.service_id,'environment','sandbox','packages',quote.packages),p_key::text);
  insert into public.kit_order_items(kit_order_id,variant_id,quantity,unit_price_in_cents,item_snapshot)
    values(identifier,p_variant,p_quantity,cents,jsonb_build_object('sku',variant.sku,'name',product.name));
  update public.shipping_quotes set used_at=now() where id=p_quote;
  return jsonb_build_object('orderId',identifier,'mode','test','state','reserved');
end;
$$;

create function public.claim_kit_test_payment(p_actor uuid,p_order uuid,p_fingerprint text,p_lock uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare tx private.kit_test_transactions;
begin
  select * into tx from private.kit_test_transactions where order_id=p_order and actor_id=p_actor for update;
  if not found or tx.state='reconciliation_required' then raise exception 'kit_not_payable'; end if;
  if tx.state='reserved' and not exists(select 1 from public.profiles p join public.representatives r on r.user_id=p.id
    where p.id=p_actor and p.status='active' and r.status in('approved_waiting_kit','active','unqualified')) then
    raise exception 'kit_access_denied' using errcode='42501';
  end if;
  if p_lock is null or p_fingerprint is null or p_fingerprint !~ '^[0-9a-f]{64}$' then raise exception 'invalid_kit_payment'; end if;
  if tx.locked_until>now() then raise exception 'kit_payment_busy'; end if;
  if tx.payment_fingerprint is not null and tx.payment_fingerprint<>p_fingerprint then raise exception 'kit_payment_conflict'; end if;
  if tx.payment_started_at<now()-interval '23 hours' and tx.provider_payment_id is null then raise exception 'kit_reconciliation_required'; end if;
  update private.kit_test_transactions set lock_id=p_lock,locked_until=now()+interval '2 minutes',
    payment_fingerprint=p_fingerprint,payment_started_at=coalesce(payment_started_at,now()) where order_id=p_order;
  return jsonb_build_object('orderId',p_order,'reference','KITTEST-'||p_order::text,'amountInCents',tx.unit_price_cents*tx.quantity+tx.shipping_cents,
    'currency','BRL','mode','test','idempotencyKey',tx.payment_key,'providerPaymentId',tx.provider_payment_id);
end;
$$;

-- Called exclusively after an authenticated provider read. Browser redirects cannot call this RPC.
create function public.settle_kit_test_payment(p_order uuid,p_lock uuid,p_provider text,p_reference text,p_amount bigint,p_currency text,p_live boolean,p_status text)
returns boolean language plpgsql security definer set search_path='' as $$
declare tx private.kit_test_transactions; target text;
begin
  select * into tx from private.kit_test_transactions where order_id=p_order for update;
  if not found or p_lock is null or tx.lock_id is distinct from p_lock or tx.locked_until is null or tx.locked_until<=now() then return false; end if;
  if p_live is distinct from false or p_currency is distinct from 'BRL' or p_reference is distinct from 'KITTEST-'||p_order::text
    or p_amount is distinct from tx.unit_price_cents*tx.quantity+tx.shipping_cents or p_provider is null or p_provider !~ '^[0-9]{1,30}$'
    or (tx.provider_payment_id is not null and tx.provider_payment_id<>p_provider) then raise exception 'kit_provider_mismatch'; end if;
  if p_status is null or p_status not in('pending','in_process','approved','cancelled','rejected') then raise exception 'kit_provider_status'; end if;
  target:=case when p_status='approved' then 'paid' when p_status in('cancelled','rejected') then 'cancelled' else 'reserved' end;
  if tx.state in('cancelled','refunded') and target='paid' then
    update private.kit_test_transactions set state='reconciliation_required',lock_id=null,locked_until=null where order_id=p_order;
    return false;
  end if;
  if (tx.state='paid' and target<>'paid') or (tx.state='cancelled' and target<>'cancelled') or tx.state='refunded' then return false; end if;
  if tx.stock_state='reserved' and target in('paid','cancelled') then
    update public.inventory set reserved_quantity=reserved_quantity-tx.quantity,
      available_quantity=available_quantity+case when target='cancelled' then tx.quantity else 0 end,
      version=version+1,updated_at=now() where variant_id=tx.variant_id and reserved_quantity>=tx.quantity;
    if not found then raise exception 'kit_stock_conflict'; end if;
  end if;
  update private.kit_test_transactions set state=target,provider_payment_id=p_provider,lock_id=null,locked_until=null,
    stock_state=case when target='paid' then 'sold' when target='cancelled' then 'released' else stock_state end where order_id=p_order;
  update public.kit_orders set status=case target when 'paid' then 'paid'::public.kit_order_status when 'cancelled' then 'cancelled'::public.kit_order_status else 'pending_payment'::public.kit_order_status end,
    paid_at=case when target='paid' then coalesce(paid_at,now()) else paid_at end,payment_reference=p_provider where id=p_order;
  if target in('paid','cancelled') then
    insert into private.kit_test_events(order_id,kind,event_key,payload) values(p_order,
      case target when 'paid' then 'payment_confirmed' else 'cancelled' end,'payment:'||p_provider||':'||target,
      jsonb_build_object('aggregate','kit_orders','mode','test','amountInCents',p_amount)) on conflict do nothing;
  end if;
  return true;
end;
$$;

create function public.prepare_kit_test_refund(p_actor uuid,p_order uuid,p_key uuid,p_amount bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare tx private.kit_test_transactions; refund private.kit_test_refunds; pending_amount bigint;
begin
  select * into tx from private.kit_test_transactions where order_id=p_order and actor_id=p_actor for update;
  if not found or tx.state not in('paid','refunded') or p_key is null or p_amount is null or p_amount<=0 then raise exception 'kit_refund_not_allowed'; end if;
  select * into refund from private.kit_test_refunds where order_id=p_order and idempotency_key=p_key;
  if found then
    if refund.amount_cents<>p_amount then raise exception 'kit_refund_conflict'; end if;
  else
    select coalesce(sum(amount_cents),0) into pending_amount from private.kit_test_refunds where order_id=p_order and state='pending';
    if tx.state<>'paid' or pending_amount>0 or p_amount>tx.unit_price_cents*tx.quantity+tx.shipping_cents-tx.refunded_cents then
      raise exception 'kit_refund_balance';
    end if;
    insert into private.kit_test_refunds(order_id,idempotency_key,amount_cents) values(p_order,p_key,p_amount) returning * into refund;
  end if;
  return jsonb_build_object('mode','test','providerPaymentId',tx.provider_payment_id,'reference','KITTEST-'||p_order::text,
    'totalInCents',tx.unit_price_cents*tx.quantity+tx.shipping_cents,'amountInCents',refund.amount_cents,
    'idempotencyKey',refund.idempotency_key,'providerRefundId',refund.provider_refund_id,'state',refund.state);
end;
$$;

create function public.finish_kit_test_refund(p_order uuid,p_key uuid,p_provider_refund text,p_amount bigint)
returns boolean language plpgsql security definer set search_path='' as $$
declare tx private.kit_test_transactions; refund private.kit_test_refunds; complete boolean;
begin
  select * into tx from private.kit_test_transactions where order_id=p_order for update;
  select * into refund from private.kit_test_refunds where order_id=p_order and idempotency_key=p_key for update;
  if not found or p_amount is distinct from refund.amount_cents or p_provider_refund is null or p_provider_refund !~ '^[0-9]{1,30}$' then return false; end if;
  if refund.state='completed' then return refund.provider_refund_id=p_provider_refund; end if;
  if tx.state<>'paid' or tx.refunded_cents+p_amount>tx.unit_price_cents*tx.quantity+tx.shipping_cents then return false; end if;
  complete:=tx.refunded_cents+p_amount=tx.unit_price_cents*tx.quantity+tx.shipping_cents;
  update private.kit_test_refunds set state='completed',provider_refund_id=p_provider_refund where order_id=p_order and idempotency_key=p_key;
  if complete and tx.stock_state='sold' then
    update public.inventory set available_quantity=available_quantity+tx.quantity,version=version+1,updated_at=now() where variant_id=tx.variant_id;
    if not found then raise exception 'kit_stock_conflict'; end if;
  end if;
  update private.kit_test_transactions set refunded_cents=refunded_cents+p_amount,
    state=case when complete then 'refunded' else state end,stock_state=case when complete then 'released' else stock_state end where order_id=p_order;
  if complete then update public.kit_orders set status='refunded' where id=p_order; end if;
  insert into private.kit_test_events(order_id,kind,event_key,payload) values(p_order,'refund_confirmed','refund:'||p_provider_refund,
    jsonb_build_object('aggregate','kit_orders','mode','test','amountInCents',p_amount,'remainingInCents',tx.unit_price_cents*tx.quantity+tx.shipping_cents-tx.refunded_cents-p_amount)) on conflict do nothing;
  return true;
end;
$$;

revoke all on function public.create_kit_test_transaction(uuid,uuid,integer,uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.claim_kit_test_payment(uuid,uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.settle_kit_test_payment(uuid,uuid,text,text,bigint,text,boolean,text) from public,anon,authenticated;
grant execute on function public.create_kit_test_transaction(uuid,uuid,integer,uuid,text,uuid) to service_role;
grant execute on function public.claim_kit_test_payment(uuid,uuid,text,uuid) to service_role;
grant execute on function public.settle_kit_test_payment(uuid,uuid,text,text,bigint,text,boolean,text) to service_role;
revoke all on function public.prepare_kit_test_refund(uuid,uuid,uuid,bigint) from public,anon,authenticated;
revoke all on function public.finish_kit_test_refund(uuid,uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.prepare_kit_test_refund(uuid,uuid,uuid,bigint) to service_role;
grant execute on function public.finish_kit_test_refund(uuid,uuid,text,bigint) to service_role;

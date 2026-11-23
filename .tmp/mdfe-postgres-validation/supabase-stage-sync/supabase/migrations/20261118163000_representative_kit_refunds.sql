-- Only a recorded operational decision can start a refund. Buyer endpoints
-- cannot issue one. Refunds and physical returns are distinct events.
create table private.representative_kit_refund_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references private.representative_kit_orders(id),
  amount_cents bigint not null check (amount_cents > 0),
  reason text not null check (reason in ('undispatched_cancellation', 'accepted_return')),
  operational_evidence text not null check (length(btrim(operational_evidence)) >= 10),
  fiscal_evidence text not null check (length(btrim(fiscal_evidence)) >= 10),
  original_invoice_key text check (original_invoice_key ~ '^31[0-9]{42}$'),
  return_invoice_key text unique check (return_invoice_key ~ '^31[0-9]{42}$'),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  checked_at timestamptz,
  baseline_refund_ids text[],
  provider_ack_id text unique check (provider_ack_id ~ '^[0-9]{1,30}$'),
  provider_refund_id text unique references private.representative_kit_provider_refunds(provider_refund_id),
  check (reason <> 'accepted_return' or (original_invoice_key is not null and return_invoice_key is not null
    and original_invoice_key <> return_invoice_key))
);
create unique index representative_kit_one_open_refund on private.representative_kit_refund_requests(order_id)
  where provider_refund_id is null;
create index representative_kit_refund_requests_order on private.representative_kit_refund_requests(order_id);
alter table private.representative_kit_refund_requests enable row level security;
alter table private.representative_kit_refund_requests force row level security;
revoke all on private.representative_kit_refund_requests from public, anon, authenticated, service_role;

create function public.due_representative_kit_refunds()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(due)),'[]'::jsonb) from (
    select r.id as "refundId", o.id as "orderId", o.provider_payment_id as "paymentId",
      r.amount_cents as "amountInCents", r.started_at as "startedAt", r.provider_ack_id as "providerAckId"
    from private.representative_kit_refund_requests r join private.representative_kit_orders o on o.id = r.order_id
    where r.provider_refund_id is null and o.provider_payment_id is not null
      and (r.checked_at is null or r.checked_at < now() - interval '5 minutes')
    order by r.checked_at nulls first, r.id limit 3
  ) due;
$$;

create function public.claim_representative_kit_refund(p_refund uuid, p_baseline_ids text[])
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  r private.representative_kit_refund_requests;
  o private.representative_kit_orders;
  f private.representative_kit_fulfillment;
  confirmed_ids text[];
  refunded bigint;
begin
  select * into r from private.representative_kit_refund_requests where id = p_refund for update;
  if not found or r.started_at is not null or r.provider_refund_id is not null then return false; end if;
  select * into o from private.representative_kit_orders where id = r.order_id for update;
  if o.state not in ('paid','manual_review') or o.provider_payment_id is null then return false; end if;
  select * into f from private.representative_kit_fulfillment where order_id = r.order_id for update;
  select coalesce(array_agg(provider_refund_id order by provider_refund_id),'{}'), coalesce(sum(amount_cents),0)
    into confirmed_ids,refunded from private.representative_kit_provider_refunds where order_id = r.order_id;
  if p_baseline_ids is distinct from confirmed_ids or refunded + r.amount_cents > o.unit_price_cents * o.quantity + o.shipping_cents
    or r.original_invoice_key is distinct from f.invoice_access_key then return false; end if;
  if r.reason = 'undispatched_cancellation' and (coalesce(f.shipment_rank, 0) >= 4 or
    (f.shipment_id is not null and f.shipment_status is distinct from 'cancelled') or f.invoice_confirmed_at is not null)
    then return false; end if;
  update private.representative_kit_refund_requests set started_at = clock_timestamp(), checked_at = clock_timestamp(),
    baseline_refund_ids = confirmed_ids where id = p_refund;
  update private.representative_kit_orders set state = 'manual_review' where id = r.order_id;
  return true;
end;
$$;

create function public.finish_representative_kit_refund(p_refund uuid, p_provider_refund text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update private.representative_kit_refund_requests r
    set provider_refund_id = p_provider_refund, checked_at = clock_timestamp()
    where r.id = p_refund and r.started_at is not null
      and r.provider_ack_id = p_provider_refund
      and (r.provider_refund_id is null or r.provider_refund_id = p_provider_refund)
      and not (p_provider_refund = any(r.baseline_refund_ids))
      and exists(select 1 from private.representative_kit_provider_refunds a
        where a.provider_refund_id = p_provider_refund and a.order_id = r.order_id and a.amount_cents = r.amount_cents);
  return found;
end;
$$;

create function public.acknowledge_representative_kit_refund(p_refund uuid, p_provider_refund text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update private.representative_kit_refund_requests set provider_ack_id = p_provider_refund
    where id = p_refund and started_at is not null and p_provider_refund ~ '^[0-9]{1,30}$'
      and (provider_ack_id is null or provider_ack_id = p_provider_refund);
  return found;
end;
$$;

create function public.defer_representative_kit_refund(p_refund uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update private.representative_kit_refund_requests set checked_at = clock_timestamp()
    where id = p_refund and provider_refund_id is null;
  return found;
end;
$$;

revoke all on function public.due_representative_kit_refunds(), public.claim_representative_kit_refund(uuid,text[]),
  public.finish_representative_kit_refund(uuid,text), public.defer_representative_kit_refund(uuid),
  public.acknowledge_representative_kit_refund(uuid,text)
  from public, anon, authenticated;
grant execute on function public.due_representative_kit_refunds(), public.claim_representative_kit_refund(uuid,text[]),
  public.finish_representative_kit_refund(uuid,text), public.defer_representative_kit_refund(uuid),
  public.acknowledge_representative_kit_refund(uuid,text) to service_role;

alter table private.representative_kit_fulfillment
  alter column bling_sale_id drop not null,
  alter column bling_invoice_id drop not null,
  add column invoice_cancellation_confirmed_at timestamptz;
alter table private.representative_kit_orders add column returned_kit_count integer not null default 0,
  add check (returned_kit_count between 0 and quantity);

create function private.can_cancel_unshipped_representative_kit(o private.representative_kit_orders)
returns boolean language sql stable set search_path = '' as $$
  select o.state='paid' and o.stock_state='sold'
    and not exists(select 1 from private.representative_kit_fulfillment f where f.order_id=o.id
      and (f.bling_sale_id is not null or f.bling_invoice_id is not null or f.shipment_id is not null))
    and not exists(select 1 from private.representative_kit_fulfillment_writes w where w.order_id=o.id)
    and not exists(select 1 from private.representative_kit_refund_requests r where r.order_id=o.id)
    and not exists(select 1 from private.representative_kit_provider_refunds r where r.order_id=o.id);
$$;
revoke all on function private.can_cancel_unshipped_representative_kit(private.representative_kit_orders)
  from public,anon,authenticated,service_role;

create function private.queue_unshipped_representative_kit_refund(p_order uuid)
returns boolean language plpgsql set search_path = '' as $$
declare
  o private.representative_kit_orders;
  f private.representative_kit_fulfillment;
begin
  select * into o from private.representative_kit_orders where id=p_order for update;
  if not found or o.state <> 'paid' or o.stock_state <> 'sold' or o.cancellation_requested_at is null then return false; end if;
  select * into f from private.representative_kit_fulfillment where order_id=p_order for update;
  if not private.can_cancel_unshipped_representative_kit(o) then return false; end if;
  insert into private.representative_kit_refund_requests(order_id,amount_cents,reason,operational_evidence,fiscal_evidence)
    values(p_order,o.unit_price_cents*o.quantity+o.shipping_cents,'undispatched_cancellation',
      'Solicitação autenticada do titular antes da expedição','Sem operação fiscal ou logística iniciada no pedido');
  return true;
end;
$$;

create function private.enqueue_representative_kit_after_payment()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.state='paid' and old.state is distinct from new.state then
    if not private.queue_unshipped_representative_kit_refund(new.id) then
      insert into private.representative_kit_fulfillment(order_id) values(new.id) on conflict do nothing;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.queue_unshipped_representative_kit_refund(uuid),
  private.enqueue_representative_kit_after_payment() from public, anon, authenticated, service_role;
create trigger enqueue_representative_kit_after_payment after update of state on private.representative_kit_orders
  for each row execute function private.enqueue_representative_kit_after_payment();

create or replace function public.read_representative_kit_payment(p_actor uuid, p_order uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select private.representative_kit_order_summary(o) ||
    jsonb_build_object('providerPaymentId',o.provider_payment_id,'startedAt',o.payment_started_at,
      'cancellationRequested',o.cancellation_requested_at is not null,
      'customerCanPay',o.state='payment_pending' and private.representative_kit_payment_allowed(o),
      'canCancelPaid',o.cancellation_requested_at is null and private.can_cancel_unshipped_representative_kit(o))
  from private.representative_kit_orders o where o.id=p_order and o.actor_id=p_actor;
$$;

create or replace function public.request_representative_kit_payment_cancellation(p_actor uuid, p_order uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  o private.representative_kit_orders;
begin
  select * into o from private.representative_kit_orders where actor_id=p_actor and id=p_order for update;
  if not found then return null; end if;
  if o.state='paid' and o.cancellation_requested_at is null and not private.can_cancel_unshipped_representative_kit(o) then
    raise exception 'kit_requires_cancellation_review' using errcode='23514';
  end if;
  if o.payment_started_at is null then
    perform public.cancel_unstarted_representative_kit_order(p_actor,p_order);
  elsif o.state in ('reserved','payment_pending','paid') then
    update private.representative_kit_orders set cancellation_requested_at=coalesce(cancellation_requested_at,now()) where id=p_order;
    if o.state = 'paid' then perform private.queue_unshipped_representative_kit_refund(p_order); end if;
  end if;
  return public.read_representative_kit_payment(p_actor,p_order);
end;
$$;

create function public.observe_representative_kit_invoice_cancellation(p_order uuid, p_invoice bigint, p_key text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update private.representative_kit_fulfillment set invoice_cancellation_confirmed_at=clock_timestamp(),invoice_confirmed_at=null
    where order_id=p_order and bling_invoice_id=p_invoice and invoice_access_key is not distinct from nullif(p_key,'');
  return found;
end;
$$;
revoke all on function public.observe_representative_kit_invoice_cancellation(uuid,bigint,text) from public, anon, authenticated;
grant execute on function public.observe_representative_kit_invoice_cancellation(uuid,bigint,text) to service_role;

create function private.restore_cancelled_representative_kit_stock()
returns trigger language plpgsql set search_path = '' as $$
declare
  o private.representative_kit_orders;
  restored integer;
begin
  if old.provider_refund_id is not null or new.provider_refund_id is null or new.reason <> 'undispatched_cancellation' then return new; end if;
  select * into o from private.representative_kit_orders where id=new.order_id for update;
  if not found or o.state <> 'refunded' or o.stock_state <> 'sold' or o.returned_kit_count <> 0 then return new; end if;
  update public.inventory set available_quantity=available_quantity+o.quantity,version=version+1,updated_at=now()
    where variant_id=o.variant_id returning available_quantity into restored;
  if not found then raise exception 'kit_stock_inconsistent' using errcode='23514'; end if;
  update private.representative_kit_orders set stock_state='released',returned_kit_count=o.quantity where id=o.id;
  insert into public.inventory_movements(variant_id,movement_type,quantity,previous_quantity,new_quantity,reason,reference_type,reference_id,performed_by)
    values(o.variant_id,'return',o.quantity,restored-o.quantity,restored,
      'Estorno confirmado antes da expedição de kit de revenda MG','representative_kit_refund',new.id,o.actor_id);
  return new;
end;
$$;
revoke all on function private.restore_cancelled_representative_kit_stock() from public, anon, authenticated, service_role;
create trigger restore_cancelled_representative_kit_stock after update of provider_refund_id on private.representative_kit_refund_requests
  for each row execute function private.restore_cancelled_representative_kit_stock();

-- The original claim protects balances and acknowledges prior provider refunds.
-- This additional guard requires positive fiscal cancellation evidence, even
-- when an invoice poll failed or a provider write lost its response.
create function private.guard_representative_kit_refund_dispatch()
returns trigger language plpgsql set search_path = '' as $$
declare
  f private.representative_kit_fulfillment;
begin
  if old.started_at is not null or new.started_at is null or new.reason <> 'undispatched_cancellation' then return new; end if;
  select * into f from private.representative_kit_fulfillment where order_id=new.order_id for update;
  if (f.bling_invoice_id is not null or f.invoice_access_key is not null
    or exists(select 1 from private.representative_kit_fulfillment_writes w where w.order_id=new.order_id
      and w.operation in ('bling_invoice_draft','bling_invoice_send')))
    and f.invoice_cancellation_confirmed_at is null then
    raise exception 'kit_invoice_cancellation_unconfirmed' using errcode='23514';
  end if;
  if f.shipment_status is distinct from 'cancelled' and (f.shipment_id is not null
    or exists(select 1 from private.representative_kit_fulfillment_writes w where w.order_id=new.order_id and w.operation='shipment_cart'))
    then raise exception 'kit_shipment_cancellation_unconfirmed' using errcode='23514'; end if;
  return new;
end;
$$;
revoke all on function private.guard_representative_kit_refund_dispatch() from public, anon, authenticated, service_role;
create trigger guard_representative_kit_refund_dispatch before update of started_at on private.representative_kit_refund_requests
  for each row execute function private.guard_representative_kit_refund_dispatch();

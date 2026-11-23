-- Automatic NF-e for kit orders (MG02 no-credit rule), with the manual invoice kept as a fallback.
--
-- Owner decision (2026-11-23): "the invoice must be issued automatically, when paid in the store
-- or at the time of the sale". Until now MG02 kit orders used a MANUAL NF-e: the owner issued it
-- in Bling and confirmed it in the panel (advancePixWithManualInvoice = true).
--
-- Depends on 20261124020000 (applied in production) and on everything before it
-- (20261122191000 manual invoice, 20261123120000 cash without routes). It works with or without
-- 20261124021000: it does not redefine ensure_representative_kit_*, the commercial configuration,
-- the Pix claim or the buyer approvals. The buyer (name, CNPJ, state registration, fiscal address)
-- is read only from private.representative_kit_orders.buyer_snapshot, as before.
--
-- Design
--  * Rule versions are immutable and the approvals point to them, so the rule flag
--    advancePixWithManualInvoice is NOT rewritten (it keeps meaning "Pix may be paid before the
--    NF-e exists"). The invoice mode is a single setting instead: private.representative_kit_fiscal_mode,
--    default 'automatic'. CFOP 5102, CSOSN 102, series 3, nature 15111725693 and values are untouched.
--  * Automatic: the existing kit worker (due_representative_kit_fulfillment, every 15 minutes, up to
--    3 orders) creates the Bling sale, generates the NF-e draft, rebuilds the fiscal mirror, approves
--    the draft hash itself and sends it. Pix: when the order is paid. Cash on receipt: when the
--    delivery date is set (the NF-e must exist before the goods leave: dispatch requires it).
--  * One invoice per order: every Bling write is claimed once in representative_kit_fulfillment_writes
--    (an unchanged claim never repeats), the sale is found by KITMG-<order> and the fulfillment row
--    stores the sale and invoice ids.
--  * Failure: the worker records a reason code. A non-retryable failure (or 3 retryable ones) puts the
--    order in "NF-e com erro" (auto_invoice_failed_at). Then the operator can request a new automatic
--    attempt (request_representative_kit_auto_invoice_retry) or, while no automatic draft/send was
--    claimed, submit the NF-e issued by hand in Bling (the manual functions work only for that case).
--  * Cash needs a Bling payment method id for "dinheiro" (environment BLING_CASH_PAYMENT_METHOD_ID).

create table private.representative_kit_fiscal_mode (
  singleton boolean primary key default true check (singleton),
  mode text not null check (mode in ('automatic','manual')),
  changed_at timestamptz not null default clock_timestamp()
);
insert into private.representative_kit_fiscal_mode(singleton,mode) values (true,'automatic');
alter table private.representative_kit_fiscal_mode enable row level security;
alter table private.representative_kit_fiscal_mode force row level security;
revoke all on private.representative_kit_fiscal_mode from public,anon,authenticated,service_role;

alter table private.representative_kit_fulfillment
  add column auto_invoice_error text check (auto_invoice_error ~ '^[a-z0-9_]{3,80}$'),
  add column auto_invoice_failed_at timestamptz,
  add column auto_invoice_attempts integer not null default 0 check (auto_invoice_attempts >= 0),
  add constraint representative_kit_auto_invoice_failure
    check (auto_invoice_failed_at is null or auto_invoice_error is not null);

create function public.set_representative_kit_fiscal_mode(p_mode text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.internal_mfa_satisfied() or not private.has_permission('technical.integrations.manage')
    then raise exception 'permission_denied' using errcode='42501'; end if;
  if p_mode is null or p_mode not in ('automatic','manual') then return false; end if;
  update private.representative_kit_fiscal_mode set mode=p_mode,changed_at=clock_timestamp()
    where singleton and mode is distinct from p_mode;
  if found then
    insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
      values(auth.uid(),private.current_app_role(),'representative.kit.fiscal_mode_changed',
        'representative_kit_fiscal_mode',null,jsonb_build_object('mode',p_mode));
  end if;
  return true;
end;
$$;
revoke all on function public.set_representative_kit_fiscal_mode(text) from public,anon,service_role;
grant execute on function public.set_representative_kit_fiscal_mode(text) to authenticated;

-- The previous manual_fiscal: the order follows the MG02 no-credit rule (own delivery, Pix or cash).
-- It no longer says by itself that the NF-e is manual.
create function private.representative_kit_mg02_flow(o private.representative_kit_orders)
returns boolean language sql stable set search_path = '' as $$
  select (o.collection_method is null
      or o.collection_method='cash' and o.collection_route_id is null and o.collection_bling_method is null)
    and private.representative_kit_is_own_delivery(o)
    and private.representative_kit_manual_rule(o.actor_id,o.rule_version_id);
$$;
revoke all on function private.representative_kit_mg02_flow(private.representative_kit_orders)
  from public,anon,authenticated,service_role;

-- 'manual' | 'automatic' | null (order is not under the MG02 rule).
create function private.representative_kit_invoice_mode(o private.representative_kit_orders)
returns text language sql stable set search_path = '' as $$
  select case
    when not private.representative_kit_manual_rule(o.actor_id,o.rule_version_id) then null
    when (select m.mode from private.representative_kit_fiscal_mode m where m.singleton)='manual'
      or exists(select 1 from private.representative_kit_fulfillment f where f.order_id=o.id and f.manual_invoice_id is not null)
      then 'manual'
    else 'automatic' end;
$$;
revoke all on function private.representative_kit_invoice_mode(private.representative_kit_orders)
  from public,anon,authenticated,service_role;

-- Manual NF-e is allowed only when the mode is manual or the automatic issue failed.
create or replace function private.representative_kit_manual_fiscal(o private.representative_kit_orders)
returns boolean language sql stable set search_path = '' as $$
  select private.representative_kit_mg02_flow(o) and (
    (select m.mode from private.representative_kit_fiscal_mode m where m.singleton)='manual'
    or exists(select 1 from private.representative_kit_fulfillment f where f.order_id=o.id and f.auto_invoice_failed_at is not null));
$$;

-- Pix and cash checkout of the MG02 rule no longer depend on the NF-e being manual.
create or replace function public.can_start_representative_kit_manual_pix(p_actor uuid,p_order uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from private.representative_kit_orders o where o.id=p_order and o.actor_id=p_actor
    and o.collection_method is null and private.representative_kit_mg02_flow(o));
$$;

create or replace function public.reserve_representative_kit_manual_pix(
  p_actor uuid,p_selection uuid,p_template text,p_quantity integer,p_quote uuid,p_address uuid,p_key uuid,p_origin text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare order_summary jsonb;
begin
  order_summary := public.reserve_representative_kit_own_delivery(
    p_actor,p_selection,p_template,p_quantity,p_quote,p_address,p_key,p_origin);
  if not exists(select 1 from private.representative_kit_orders o where o.id=(order_summary->>'orderId')::uuid
    and o.actor_id=p_actor and private.representative_kit_mg02_flow(o))
    then raise exception 'kit_manual_pix_not_approved' using errcode='23514'; end if;
  return order_summary;
end;
$$;

-- Same body as 20261123120000, with mg02_flow in place of manual_fiscal.
create or replace function private.representative_kit_fiscal_ready(o private.representative_kit_orders)
returns boolean language sql stable set search_path = ''
as $$
  select (o.state='paid' and o.stock_state='sold'
      or o.state='awaiting_receipt' and o.stock_state='reserved' and (o.collection_route_id is not null
        or o.collection_method='cash' and o.collection_due_on is not null
          and (o.collection_bling_method=private.representative_kit_direct_cash_method(
              o.actor_id,o.shipping_snapshot->>'originPostalCode',o.rule_version_id)
            or o.collection_bling_method is null and private.representative_kit_mg02_flow(o))
          and (
          o.collection_due_on >= (statement_timestamp() at time zone 'America/Sao_Paulo')::date
          or exists(select 1 from private.representative_kit_fulfillment f where f.order_id=o.id and f.bling_invoice_id is not null)
        )))
    and private.representative_kit_payment_allowed(o);
$$;

-- Same as 20261120133000 plus the invoice mode. An order whose automatic issue failed leaves the
-- worker queue until the operator asks to retry or submits the manual NF-e.
create or replace function public.due_representative_kit_fulfillment()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(due)),'[]'::jsonb) from (
    select f.order_id as "orderId", f.bling_sale_id as "saleId", f.bling_invoice_id as "invoiceId",
      f.shipment_id as "shipmentId", f.shipment_status as "shipmentStatus", o.variant_id as "variantId",
      o.sku, o.product_name as "productName", o.quantity, coalesce(o.paid_at,o.created_at) as "paidAt", o.grade_lines as "gradeLines",
      private.representative_kit_is_own_delivery(o) as "ownDelivery", o.collection_method as "collectionMethod", o.collection_bling_method as "collectionBlingMethod", o.created_at as "createdAt",
      o.shipping_snapshot ->> 'estimatedDays' as "deliveryDays", o.collection_due_on as "collectionDueOn",
      o.unit_price_cents as "unitPriceInCents", o.shipping_cents as "shippingInCents",
      o.unit_price_cents * o.quantity + o.shipping_cents as "amountInCents",
      o.shipping_snapshot ->> 'serviceId' as "serviceId",
      o.shipping_snapshot ->> 'originPostalCode' as "originPostalCode",
      o.shipping_snapshot -> 'address' ->> 'postalCode' as "postalCode",
      a.buyer_profile as "buyerProfile", a.buyer_document as "buyerDocument", a.buyer_state_registration as "buyerStateRegistration",
      r.fiscal_parameters as "fiscalParameters",
      private.representative_kit_invoice_mode(o) as "invoiceMode",
      f.auto_invoice_failed_at is not null as "autoInvoiceFailed",
      f.auto_invoice_attempts as "autoInvoiceAttempts"
    from private.representative_kit_fulfillment f
    join private.representative_kit_orders o on o.id = f.order_id
    join private.representative_kit_checkout_approvals a on a.actor_id = o.actor_id and a.rule_version_id = o.rule_version_id
    join private.representative_resale_fiscal_rule_versions r on r.id = o.rule_version_id
    where private.representative_kit_fiscal_ready(o)
      and not exists (
        select 1 from jsonb_array_elements(o.grade_lines) item
        where private.bling_kit_source_hash((item ->> 'variantId')::uuid) is distinct from item ->> 'fiscalHash'
      )
      and coalesce(f.shipment_status,'pending') not in ('returned','cancelled','delivered')
      and (f.auto_invoice_failed_at is null or f.manual_invoice_id is not null)
      and (f.checked_at is null or f.checked_at < now() - interval '15 minutes')
      and not exists(select 1 from private.bling_order_links b
        where b.invoice_id = f.bling_invoice_id or b.external_order_id = f.bling_sale_id)
    order by f.checked_at nulls first, f.order_id limit 3
  ) due;
$$;

-- Worker only. The draft hash was just rebuilt from the Bling preview and the fiscal mirror
-- (CFOP 5102, CSOSN 102, series 3, nature 15111725693); this replaces the operator's review.
create function public.auto_approve_representative_kit_bling_draft(p_order uuid,p_hash text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare o private.representative_kit_orders;
begin
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then return false; end if;
  select * into o from private.representative_kit_orders where id=p_order for update;
  if not found or private.representative_kit_invoice_mode(o) is distinct from 'automatic'
    or public.read_representative_kit_bling_order(p_order) is null then return false; end if;
  update private.representative_kit_fulfillment set
      reviewed_draft_hash=p_hash,
      reviewed_draft_evidence='Aprovação automática: espelho fiscal MG02 conferido pelo worker.'
    where order_id=p_order and bling_invoice_id is not null and invoice_access_key is null
      and manual_invoice_id is null and auto_invoice_failed_at is null and invoice_draft_hash=p_hash
      and reviewed_draft_hash is distinct from p_hash
      and not exists(select 1 from private.representative_kit_fulfillment_writes w
        where w.order_id=p_order and w.operation='bling_invoice_send');
  if not found then
    return exists(select 1 from private.representative_kit_fulfillment f
      where f.order_id=p_order and f.reviewed_draft_hash=p_hash and f.invoice_draft_hash=p_hash);
  end if;
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
    values(null,null,'integration.bling.kit_draft_auto_approved','representative_kit_order',p_order,
      jsonb_build_object('draftHash',p_hash));
  return true;
end;
$$;

-- Worker only. The reason is a code (never personal data). A non-final failure keeps the order in
-- the queue; a final one (non-retryable, or the third attempt) shows "NF-e com erro".
create function public.record_representative_kit_auto_invoice_error(p_order uuid,p_reason text,p_final boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare o private.representative_kit_orders; attempts integer; is_final boolean;
begin
  if p_reason is null or p_reason !~ '^[a-z0-9_]{3,80}$' then return false; end if;
  select * into o from private.representative_kit_orders where id=p_order for update;
  if not found or private.representative_kit_invoice_mode(o) is distinct from 'automatic' then return false; end if;
  select f.auto_invoice_attempts+1 into attempts from private.representative_kit_fulfillment f
    where f.order_id=p_order and f.invoice_confirmed_at is null and f.manual_invoice_id is null for update;
  if not found then return false; end if;
  is_final := coalesce(p_final,false) or attempts>=3;
  update private.representative_kit_fulfillment set auto_invoice_error=p_reason,auto_invoice_attempts=attempts,
      auto_invoice_failed_at=case when is_final then coalesce(auto_invoice_failed_at,clock_timestamp()) else auto_invoice_failed_at end
    where order_id=p_order;
  if is_final then
    insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
      values(null,null,'representative.kit.auto_invoice_failed','representative_kit_order',p_order,
        jsonb_build_object('reason',p_reason,'attempts',attempts));
  end if;
  return true;
end;
$$;

-- Operator action "Reemitir": clears the error and puts the order back in the worker queue.
-- It never creates a second invoice: the Bling sale/draft/send claims and the KITMG-<order>
-- reference are reused, and a submitted manual NF-e blocks it.
create function public.request_representative_kit_auto_invoice_retry(p_order uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare o private.representative_kit_orders;
begin
  if auth.uid() is null or not private.internal_mfa_satisfied()
    or not (private.has_permission('orders.update_operational_status') or private.has_permission('technical.integrations.manage'))
    then raise exception 'permission_denied' using errcode='42501'; end if;
  select * into o from private.representative_kit_orders where id=p_order for update;
  if not found or o.cancellation_requested_at is not null or not private.representative_kit_fiscal_ready(o)
    or private.representative_kit_invoice_mode(o) is distinct from 'automatic' then return false; end if;
  update private.representative_kit_fulfillment set auto_invoice_error=null,auto_invoice_failed_at=null,
      auto_invoice_attempts=0,checked_at=null
    where order_id=p_order and auto_invoice_failed_at is not null and invoice_confirmed_at is null
      and invoice_access_key is null and manual_invoice_id is null;
  if not found then return false; end if;
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
    values(auth.uid(),private.current_app_role(),'representative.kit.auto_invoice_retry','representative_kit_order',p_order,'{}'::jsonb);
  return true;
end;
$$;

revoke all on function public.auto_approve_representative_kit_bling_draft(uuid,text),
  public.record_representative_kit_auto_invoice_error(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.auto_approve_representative_kit_bling_draft(uuid,text),
  public.record_representative_kit_auto_invoice_error(uuid,text,boolean) to service_role;
revoke all on function public.request_representative_kit_auto_invoice_retry(uuid) from public,anon,service_role;
grant execute on function public.request_representative_kit_auto_invoice_retry(uuid) to authenticated;

-- Same as 20261122191000 plus the automatic invoice status. manualFiscal is true only when the manual
-- confirmation is allowed (mode manual, or the automatic issue failed).
create or replace function public.list_representative_kit_fiscal_work()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not (private.has_permission('orders.update_operational_status') or private.has_permission('technical.integrations.manage'))
    then raise exception 'permission_denied' using errcode='42501'; end if;
  return (select coalesce(jsonb_agg(work.summary),'[]'::jsonb) from (
    select jsonb_build_object('orderId',o.id,'state',o.state,'sku',o.sku,'quantity',o.quantity,'productName',o.product_name,
      'invoiceId',f.bling_invoice_id,'saleId',f.bling_sale_id,'draftHash',f.invoice_draft_hash,
      'draftApproved',f.reviewed_draft_hash is not null and f.reviewed_draft_hash=f.invoice_draft_hash,
      'invoiceAuthorized',f.invoice_confirmed_at is not null,'shipmentStatus',f.shipment_status,
      'cancellationRequested',o.cancellation_requested_at is not null,'collectionMethod',o.collection_method,
      'ownDelivery',private.representative_kit_is_own_delivery(o),'manualFiscal',private.representative_kit_manual_fiscal(o),
      'manualInvoiceId',f.manual_invoice_id,
      'invoiceMode',private.representative_kit_invoice_mode(o),
      'invoiceKey',f.invoice_access_key,
      'invoiceNumber',case when f.invoice_access_key is not null then ltrim(substr(f.invoice_access_key,26,9),'0') end,
      'autoInvoiceStatus',case
        when private.representative_kit_invoice_mode(o) is distinct from 'automatic' then null
        when f.invoice_confirmed_at is not null then 'issued'
        when f.auto_invoice_failed_at is not null then 'error'
        when private.representative_kit_fiscal_ready(o) then 'pending'
        else null end,
      'autoInvoiceError',f.auto_invoice_error,'autoInvoiceAttempts',f.auto_invoice_attempts,
      'autoInvoiceFailedAt',f.auto_invoice_failed_at) as summary
    from private.representative_kit_orders o join private.representative_kit_fulfillment f on f.order_id=o.id
    order by o.created_at desc,o.id limit 50
  ) work);
end;
$$;

-- Same as 20261122191000: the buyer sees "awaiting fiscal issuance" while the NF-e (automatic or
-- manual) is not authorized yet.
create or replace function public.read_representative_kit_tracking(p_actor uuid,p_order uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('status',f.shipment_status,'trackingCode',f.tracking_code) ||
    case when o.state='paid' and private.representative_kit_mg02_flow(o) and f.invoice_confirmed_at is null
      then jsonb_build_object('fiscalStatus','awaiting_fiscal_issuance') else '{}'::jsonb end
  from private.representative_kit_orders o join private.representative_kit_fulfillment f on f.order_id=o.id
  where o.id=p_order and o.actor_id=p_actor and (f.shipment_status is not null
    or (o.state='paid' and private.representative_kit_mg02_flow(o) and f.invoice_confirmed_at is null));
$$;

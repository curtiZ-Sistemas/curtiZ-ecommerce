create table private.representative_kit_returns (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references private.representative_kit_orders(id),
  request_key uuid not null,
  quantity integer not null check (quantity between 1 and 99),
  reason text not null check (length(btrim(reason)) between 5 and 500),
  state text not null default 'requested' check (state in ('requested','approved','received','verified','refund_pending','completed','rejected')),
  instructions text check (length(btrim(instructions)) between 5 and 500),
  reviewed_by uuid references public.profiles(id),
  inspected_by uuid references public.profiles(id),
  inspection_reference text check (length(btrim(inspection_reference)) between 10 and 200),
  restock_quantity integer not null default 0 check (restock_quantity between 0 and quantity),
  bling_invoice_id bigint unique check (bling_invoice_id > 0),
  document_origin text check (document_origin in ('buyer_outflow','own_inflow')),
  invoice_key text unique check (invoice_key ~ '^31[0-9]{42}$'),
  invoice_protocol text unique check (invoice_protocol ~ '^[0-9]{15}$'),
  invoice_sha256 text check (invoice_sha256 ~ '^[0-9a-f]{64}$'),
  refund_cents bigint check (refund_cents > 0),
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  unique(order_id,request_key)
);
create index representative_kit_returns_review on private.representative_kit_returns(state,created_at);
create index representative_kit_returns_inspector on private.representative_kit_returns(inspected_by);
create index representative_kit_returns_reviewer on private.representative_kit_returns(reviewed_by);
alter table private.representative_kit_returns enable row level security;
alter table private.representative_kit_returns force row level security;
revoke all on private.representative_kit_returns from public,anon,authenticated,service_role;

alter table private.representative_kit_refund_requests add column kit_return_id uuid unique
  references private.representative_kit_returns(id);

create function private.representative_kit_return_summary(r private.representative_kit_returns)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id',r.id,'orderId',r.order_id,'quantity',r.quantity,'state',r.state,
    'instructions',r.instructions,'createdAt',r.created_at);
$$;
revoke all on function private.representative_kit_return_summary(private.representative_kit_returns) from public,anon,authenticated,service_role;

create function public.request_representative_kit_return(p_actor uuid,p_order uuid,p_quantity integer,p_reason text,p_key uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  o private.representative_kit_orders;
  r private.representative_kit_returns;
begin
  select * into o from private.representative_kit_orders where id=p_order and actor_id=p_actor for update;
  if not found or not exists(select 1 from public.profiles where id=p_actor and status='active') then return null; end if;
  if p_quantity is null or p_quantity not between 1 and 99 or length(btrim(coalesce(p_reason,''))) not between 5 and 500 or p_key is null
    then raise exception 'invalid_kit_return' using errcode='22023'; end if;
  select * into r from private.representative_kit_returns where order_id=p_order and request_key=p_key;
  if found then
    if r.quantity is distinct from p_quantity or r.reason is distinct from btrim(p_reason)
      then raise exception 'kit_return_idempotency_conflict' using errcode='23505'; end if;
    return private.representative_kit_return_summary(r);
  end if;
  if o.state not in ('paid','manual_review') or o.stock_state <> 'sold'
    or not exists(select 1 from private.representative_kit_fulfillment f where f.order_id=p_order
      and f.shipment_status in ('delivered','returned') and f.invoice_access_key is not null and f.invoice_cancellation_confirmed_at is null)
    or p_quantity + coalesce((select sum(quantity) from private.representative_kit_returns
      where order_id=p_order and state <> 'rejected'),0) > o.quantity then
      raise exception 'kit_return_unavailable' using errcode='23514';
  end if;
  insert into private.representative_kit_returns(order_id,request_key,quantity,reason) values(p_order,p_key,p_quantity,btrim(p_reason))
    returning * into r;
  return private.representative_kit_return_summary(r);
end;
$$;

create function public.list_representative_kit_returns(p_actor uuid,p_order uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(private.representative_kit_return_summary(r) order by r.created_at desc),'[]'::jsonb)
  from private.representative_kit_returns r join private.representative_kit_orders o on o.id=r.order_id
  where o.id=p_order and o.actor_id=p_actor;
$$;

create function public.list_representative_kit_return_work()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_permission('returns.read');
  return (select coalesce(jsonb_agg(pending.summary),'[]'::jsonb) from (
    select private.representative_kit_return_summary(r) || jsonb_build_object('reason',r.reason,'sku',o.sku,
      'productName',o.product_name,'originalInvoiceKey',f.invoice_access_key,'refundInCents',r.refund_cents,
      'invoiceKey',r.invoice_key) as summary
    from private.representative_kit_returns r join private.representative_kit_orders o on o.id=r.order_id
    join private.representative_kit_fulfillment f on f.order_id=o.id
    order by r.created_at desc, r.id limit 50
  ) pending);
end;
$$;

create function public.manage_representative_kit_return(p_return uuid,p_action text,p_details jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r private.representative_kit_returns;
  o private.representative_kit_orders;
  f private.representative_kit_fulfillment;
  amount bigint;
begin
  perform private.require_permission(case p_action when 'receive' then 'returns.inspect' when 'refund' then 'returns.refund'
    else 'returns.approve' end);
  select order_id into r.order_id from private.representative_kit_returns where id=p_return;
  if not found then return null; end if;
  select * into o from private.representative_kit_orders where id=r.order_id for update;
  select * into r from private.representative_kit_returns where id=p_return for update;
  select * into f from private.representative_kit_fulfillment where order_id=o.id for update;
  if not found or f.invoice_access_key is null or f.invoice_cancellation_confirmed_at is not null then return null; end if;
  if p_action='approve' and r.state='requested' then
    if length(btrim(coalesce(p_details->>'instructions',''))) not between 5 and 500 then return null; end if;
    update private.representative_kit_returns set state='approved',instructions=btrim(p_details->>'instructions'),reviewed_by=auth.uid() where id=p_return;
  elsif p_action='reject' and r.state='requested' then
    if length(btrim(coalesce(p_details->>'instructions',''))) not between 5 and 500 then return null; end if;
    update private.representative_kit_returns set state='rejected',instructions=btrim(p_details->>'instructions'),reviewed_by=auth.uid() where id=p_return;
  elsif p_action='receive' and r.state='approved' then
    if coalesce(p_details->>'invoiceId','') !~ '^[1-9][0-9]{0,15}$'
      or coalesce(p_details->>'refundInCents','') !~ '^[1-9][0-9]{0,14}$'
      or coalesce(p_details->>'restockQuantity','') !~ '^[0-9]{1,2}$'
      or coalesce(p_details->>'invoiceKey','') !~ '^31[0-9]{42}$'
      or coalesce(p_details->>'documentOrigin','') not in ('buyer_outflow','own_inflow')
      or length(btrim(coalesce(p_details->>'inspectionReference',''))) not between 10 and 200 then return null; end if;
    amount := (p_details->>'refundInCents')::bigint;
    if (p_details->>'restockQuantity')::integer > r.quantity or amount > o.unit_price_cents*o.quantity+o.shipping_cents
      or p_details->>'invoiceKey'=f.invoice_access_key then return null; end if;
    update private.representative_kit_returns set state='received',inspected_by=auth.uid(),
      inspection_reference=btrim(p_details->>'inspectionReference'),restock_quantity=(p_details->>'restockQuantity')::integer,
      bling_invoice_id=(p_details->>'invoiceId')::bigint,invoice_key=p_details->>'invoiceKey',document_origin=p_details->>'documentOrigin',
      refund_cents=amount where id=p_return;
  elsif p_action='refund' and r.state='verified' then
    if r.invoice_protocol is null or r.invoice_sha256 is null or r.inspected_by is null or o.stock_state<>'sold'
      or r.refund_cents + coalesce((select sum(amount_cents) from private.representative_kit_provider_refunds
        where order_id=o.id),0) > o.unit_price_cents*o.quantity+o.shipping_cents then return null; end if;
    if exists(select 1 from private.representative_kit_refund_requests x where x.order_id=o.id and x.provider_refund_id is null)
      then return null; end if;
    insert into private.representative_kit_refund_requests(order_id,kit_return_id,amount_cents,reason,operational_evidence,fiscal_evidence,
      original_invoice_key,return_invoice_key)
      values(o.id,r.id,r.refund_cents,'accepted_return',r.inspection_reference,'Protocolo NF-e '||r.invoice_protocol,f.invoice_access_key,r.invoice_key);
    update private.representative_kit_returns set state='refund_pending' where id=p_return;
  else
    return null;
  end if;
  select * into r from private.representative_kit_returns where id=p_return;
  return private.representative_kit_return_summary(r);
end;
$$;

create function public.due_representative_kit_return_invoices()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(due)),'[]'::jsonb) from (
    select r.id as "returnId",r.quantity as "returnQuantity",r.document_origin as "documentOrigin",
      r.bling_invoice_id as "invoiceId",r.invoice_key as "invoiceKey",r.refund_cents as "refundInCents",
      o.quantity as "originalQuantity",a.buyer_document as "buyerDocument",
      rule.fiscal_parameters ->> 'issuerDocument' as "issuerDocument",
      rule.fiscal_parameters -> 'returnRules' -> r.document_origin as "returnRule",
      f.invoice_access_key as "originalKey",f.invoice_xml_sha256 as "originalHash",f.bling_invoice_id as "originalInvoiceId"
    from private.representative_kit_returns r join private.representative_kit_orders o on o.id=r.order_id
    join private.representative_kit_fulfillment f on f.order_id=o.id
    join private.representative_kit_checkout_approvals a on a.actor_id=o.actor_id and a.rule_version_id=o.rule_version_id
    join private.representative_resale_fiscal_rule_versions rule on rule.id=o.rule_version_id
    where r.state='received' and f.invoice_cancellation_confirmed_at is null
      and (r.checked_at is null or r.checked_at<now()-interval '15 minutes')
    order by r.checked_at nulls first,r.id limit 3
  ) due;
$$;

create function public.record_representative_kit_return_invoice(p_return uuid,p_key text,p_protocol text,p_hash text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update private.representative_kit_returns set state='verified',invoice_protocol=p_protocol,invoice_sha256=p_hash,checked_at=now()
    where id=p_return and invoice_key=p_key and p_protocol ~ '^[0-9]{15}$' and p_hash ~ '^[0-9a-f]{64}$' and state='received';
  return found;
end;
$$;
create function public.defer_representative_kit_return_invoice(p_return uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update private.representative_kit_returns set checked_at=clock_timestamp() where id=p_return and state='received';
  return found;
end;
$$;

create function private.finalize_representative_kit_return()
returns trigger language plpgsql set search_path = '' as $$
declare
  r private.representative_kit_returns;
  o private.representative_kit_orders;
  restored integer;
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
    update public.inventory set available_quantity=available_quantity+r.restock_quantity,version=version+1,updated_at=now()
      where variant_id=o.variant_id returning available_quantity into restored;
    if not found then raise exception 'kit_stock_inconsistent' using errcode='23514'; end if;
    insert into public.inventory_movements(variant_id,movement_type,quantity,previous_quantity,new_quantity,reason,reference_type,reference_id,performed_by)
      values(o.variant_id,'return',r.restock_quantity,restored-r.restock_quantity,restored,
        'Devolução inspecionada de kit de revenda MG','representative_kit_return',r.id,r.inspected_by);
  end if;
  update private.representative_kit_returns set state='completed' where id=r.id;
  return new;
end;
$$;
revoke all on function private.finalize_representative_kit_return() from public,anon,authenticated,service_role;
create trigger guard_representative_kit_return_refund before update of started_at on private.representative_kit_refund_requests
  for each row execute function private.finalize_representative_kit_return();
create trigger finalize_representative_kit_return after update of provider_refund_id on private.representative_kit_refund_requests
  for each row execute function private.finalize_representative_kit_return();

revoke all on function public.request_representative_kit_return(uuid,uuid,integer,text,uuid),public.list_representative_kit_returns(uuid,uuid),
  public.due_representative_kit_return_invoices(),public.record_representative_kit_return_invoice(uuid,text,text,text),
  public.defer_representative_kit_return_invoice(uuid) from public,anon,authenticated;
grant execute on function public.request_representative_kit_return(uuid,uuid,integer,text,uuid),public.list_representative_kit_returns(uuid,uuid),
  public.due_representative_kit_return_invoices(),public.record_representative_kit_return_invoice(uuid,text,text,text),
  public.defer_representative_kit_return_invoice(uuid) to service_role;
revoke all on function public.list_representative_kit_return_work(),public.manage_representative_kit_return(uuid,text,jsonb)
  from public,anon,service_role;
grant execute on function public.list_representative_kit_return_work(),public.manage_representative_kit_return(uuid,text,jsonb) to authenticated;

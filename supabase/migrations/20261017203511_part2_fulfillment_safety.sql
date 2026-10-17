begin;

-- No commercial activation or historical backfill. Every new stage is durable.
create function private.enqueue_shipping_stage() returns trigger
language plpgsql security definer set search_path='' as $$
declare stage text;
begin
  if new.provider<>'melhorenvio' or new.external_id is null then return new; end if;
  if tg_op='UPDATE' and old.operation_state=new.operation_state then return new; end if;
  stage:=case new.operation_state when 'created' then 'purchase' when 'purchased' then 'generate'
    when 'generated' then 'sync' when 'posted' then 'sync' when 'reconciliation_required' then 'sync' else null end;
  if new.operation_state in ('created','purchased','generated') and exists(select 1 from public.orders
    where id=new.order_id and status in ('cancellation_requested','refund_pending','cancelled','refunded')) then
    stage:='cancel';
  end if;
  if stage is not null then
    insert into public.background_jobs(queue,job_type,payload_sanitized,idempotency_key)
      values('shipping','melhorenvio.'||stage,jsonb_build_object('shipmentId',new.id),'melhorenvio:'||stage||':'||new.id)
      on conflict(idempotency_key) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function private.enqueue_shipping_stage() from public,anon,authenticated;
create trigger enqueue_shipping_stage after insert or update of operation_state on public.shipments
  for each row execute function private.enqueue_shipping_stage();

create function public.request_shipping_action(p_shipment_id uuid,p_action text,p_actor_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare shipment public.shipments%rowtype; job public.background_jobs%rowtype;
begin
  if p_action not in ('create','purchase','generate','sync','cancel') or p_action is null then
    raise exception 'invalid_shipping_action' using errcode='22023'; end if;
  if not exists(select 1 from public.profiles p join public.user_roles r on r.user_id=p.id
    where p.id=p_actor_id and p.status='active' and r.role in ('admin','operational','technical')) then
    raise exception 'permission_denied' using errcode='42501'; end if;
  select * into shipment from public.shipments where id=p_shipment_id and provider='melhorenvio' for update;
  if shipment.id is null then raise exception 'shipment_not_found' using errcode='P0002'; end if;
  if p_action<>'sync' and (shipment.operation_state='reconciliation_required' or exists(
    select 1 from public.background_jobs where queue='shipping' and status='running'
      and payload_sanitized->>'shipmentId'=p_shipment_id::text)) then
    raise exception 'shipping_reconciliation_required' using errcode='55000'; end if;
  if p_action='create' and shipment.operation_state not in ('pending','failed','awaiting_invoice')
    or p_action='purchase' and shipment.operation_state<>'created'
    or p_action='generate' and shipment.operation_state<>'purchased'
    or p_action='sync' and shipment.external_id is null
    or p_action='cancel' and shipment.operation_state not in ('created','purchased','generated') then
    raise exception 'shipping_state_conflict' using errcode='55000'; end if;
  insert into public.background_jobs(queue,job_type,payload_sanitized,idempotency_key)
    values('shipping','melhorenvio.'||p_action,jsonb_build_object('shipmentId',shipment.id),
      'melhorenvio:'||p_action||':'||shipment.id) on conflict(idempotency_key) do nothing;
  select * into job from public.background_jobs where idempotency_key='melhorenvio:'||p_action||':'||shipment.id for update;
  if job.status='failed' and coalesce(job.error_summary,'') not in
    ('uncertain_write','lease_expired_reconciliation_required') or (p_action='sync' and job.status='completed') then
    update public.background_jobs set status='pending',attempts=0,available_at=now(),completed_at=null,error_summary=null
      where id=job.id;
  end if;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,new_data_sanitized)
    values(p_actor_id,'shipping.melhorenvio.'||p_action,'shipment',shipment.id,jsonb_build_object('jobId',job.id));
  return job.id;
end;
$$;
revoke all on function public.request_shipping_action(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.request_shipping_action(uuid,text,uuid) to service_role;

create function public.claim_melhor_envio_fulfillment_job(p_lock_id uuid,p_purchase_enabled boolean default false,
  p_generation_enabled boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare selected public.background_jobs%rowtype;
begin
  if p_lock_id is null then raise exception 'lock_required' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('shipping-account-claim'));
  -- An expired lease may have made an external write. Never replay it blindly.
  update public.shipments s set operation_state='reconciliation_required',last_error_code='lease_expired_reconciliation_required'
    where s.operation_state in ('creating','purchasing','generating','cancelling') and exists(
      select 1 from public.background_jobs j where j.queue='shipping' and j.status='running'
        and j.locked_at<now()-interval '5 minutes' and j.payload_sanitized->>'shipmentId'=s.id::text);
  update public.background_jobs set status='failed',error_summary='lease_expired_reconciliation_required',lock_id=null,locked_at=null
    where queue='shipping' and status='running' and locked_at<now()-interval '5 minutes';
  if exists(select 1 from public.background_jobs where queue='shipping' and status='running') then return null; end if;
  select * into selected from public.background_jobs
    where queue='shipping' and job_type in ('melhorenvio.create','melhorenvio.purchase','melhorenvio.generate','melhorenvio.sync','melhorenvio.cancel')
      and (job_type<>'melhorenvio.purchase' or p_purchase_enabled is true)
      and (job_type<>'melhorenvio.generate' or p_generation_enabled is true)
      and status='pending' and available_at<=now()
    order by available_at,id for update skip locked limit 1;
  if selected.id is null then return null; end if;
  update public.background_jobs set status='running',attempts=attempts+1,locked_at=now(),lock_id=p_lock_id,error_summary=null where id=selected.id;
  return jsonb_build_object('id',selected.id,'jobType',selected.job_type,'payload',selected.payload_sanitized);
end;
$$;
revoke all on function public.claim_melhor_envio_fulfillment_job(uuid,boolean,boolean) from public,anon,authenticated;
grant execute on function public.claim_melhor_envio_fulfillment_job(uuid,boolean,boolean) to service_role;
create or replace function public.claim_melhor_envio_job(p_lock_id uuid) returns jsonb
language sql security definer set search_path='' as $$
  select public.claim_melhor_envio_fulfillment_job(p_lock_id,false,false)
$$;

create or replace function public.finish_melhor_envio_job(p_job_id uuid,p_lock_id uuid,p_success boolean,p_error_code text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare job public.background_jobs%rowtype; repeat_poll boolean; retry_safe boolean;
begin
  select * into job from public.background_jobs where id=p_job_id and status='running' and lock_id=p_lock_id for update;
  if job.id is null then return false; end if;
  repeat_poll:=p_success and job.job_type='melhorenvio.sync' and exists(select 1 from public.shipments
    where id::text=job.payload_sanitized->>'shipmentId' and status not in ('delivered','returned','cancelled'));
  retry_safe:=not p_success and job.attempts<5 and p_error_code in
    ('provider_unavailable','rate_limited','fiscal_shipping_blocked','token_refresh_failed','invalid_response_read','invalid_response','network','timeout');
  update public.background_jobs set status=case when repeat_poll or retry_safe then 'pending'::public.job_status
      when p_success then 'completed'::public.job_status else 'failed'::public.job_status end,
    available_at=now()+case when repeat_poll then interval '30 minutes' else least(1800,30*power(2,least(job.attempts,6))) * interval '1 second' end,
    attempts=case when repeat_poll then 0 else attempts end,completed_at=case when p_success and not repeat_poll then now() else null end,
    error_summary=case when p_success then null else left(coalesce(p_error_code,'shipping_job_failed'),120) end,
    locked_at=null,lock_id=null where id=p_job_id;
  insert into public.audit_logs(action,entity_type,entity_id,new_data_sanitized)
    values('shipping.job.finished','shipment',(job.payload_sanitized->>'shipmentId')::uuid,
      jsonb_build_object('jobId',job.id,'jobType',job.job_type,'attempt',job.attempts,'success',p_success,'errorCode',p_error_code));
  return true;
end;
$$;

-- The old third email cannot be claimed even by a mistakenly enabled binding.
create function private.block_invoice_email_job() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.queue='bling' and new.job_type='bling.invoice.email' and new.status in ('pending','running') then
    new.status:='cancelled'; new.error_summary:='email_kind_not_approved'; new.lock_id:=null; new.locked_at:=null;
  end if;
  return new;
end;
$$;
revoke all on function private.block_invoice_email_job() from public,anon,authenticated;
create trigger block_invoice_email_job before insert or update on public.background_jobs
  for each row execute function private.block_invoice_email_job();
update public.background_jobs set status='cancelled',error_summary='email_kind_not_approved',locked_at=null,lock_id=null
  where queue='bling' and job_type='bling.invoice.email' and status='pending';

-- All volumes must be genuinely delivered. An order marked manually without
-- a carrier shipment is insufficient evidence for a review email.
create or replace function private.transactional_email_eligible(p_order_id uuid,p_kind text)
returns boolean language sql security definer set search_path='' stable as $$
  select exists(select 1 from public.orders o where o.id=p_order_id
    and o.currency='BRL' and o.payment_status='approved' and o.status in ('payment_approved','processing','picking','ready_to_ship','shipped','delivered')
    and exists(select 1 from public.payments p where p.order_id=o.id and p.provider='mercadopago'
      and p.status='approved' and p.provider_payment_id is not null and p.currency=o.currency and p.amount=o.grand_total)
    and (p_kind='purchase_confirmed' or (p_kind='review_requested' and o.customer_id is not null and o.status='delivered'
      and exists(select 1 from public.shipments s where s.order_id=o.id and s.status='delivered' and s.delivered_at is not null)
      and not exists(select 1 from public.shipments s where s.order_id=o.id and s.status<>'delivered')
      and not exists(select 1 from public.shipments s where s.order_id=o.id and not exists(
        select 1 from public.tracking_events t where t.shipment_id=s.id and t.status='delivered' and t.provider_event_id is not null))
      and exists(select 1 from public.order_items i where i.order_id=o.id
        and not exists(select 1 from public.reviews r where r.order_item_id=i.id and r.customer_id=o.customer_id)))))
$$;

alter function public.apply_melhor_envio_webhook(text,text,text,text,text,timestamptz,text) rename to apply_melhor_envio_webhook_base;
revoke all on function public.apply_melhor_envio_webhook_base(text,text,text,text,text,timestamptz,text) from public,anon,authenticated,service_role;
create or replace function public.apply_melhor_envio_webhook_base(
  p_event_key text,p_payload_hash text,p_event_type text,p_external_id text,
  p_status text,p_occurred_at timestamptz,p_tracking_code text default null
)
returns text language plpgsql security definer set search_path = '' as $$
declare webhook public.shipping_webhook_events%rowtype; shipment public.shipments%rowtype;
  current_rank integer; target_rank integer;
begin
  insert into public.shipping_webhook_events(provider,provider_event_key,payload_hash,signature_valid,event_type,occurred_at)
  values('melhorenvio',p_event_key,p_payload_hash,true,p_event_type,p_occurred_at)
  on conflict(provider,provider_event_key) do nothing;
  select * into webhook from public.shipping_webhook_events
    where provider='melhorenvio' and provider_event_key=p_event_key for update;
  if webhook.payload_hash<>p_payload_hash then return 'hash_conflict'; end if;
  if webhook.processing_status in ('processed','ignored') then return 'duplicate'; end if;
  begin
    select * into shipment from public.shipments
      where provider='melhorenvio' and external_id=p_external_id for update;
    if shipment.id is null then
      update public.shipping_webhook_events set processing_status='ignored',processed_at=now()
        where id=webhook.id;
      return 'ignored';
    end if;
    if p_status is not null then
      current_rank := case shipment.status::text when 'pending' then 0 when 'label_created' then 2 when 'ready' then 1
        when 'dispatched' then 4 when 'in_transit' then 5 when 'delayed' then 5 when 'delivered' then 7
        when 'returned' then 8 when 'cancelled' then 8 else 0 end;
      target_rank := case p_status when 'pending' then 0 when 'label_created' then 2 when 'ready' then 1
        when 'dispatched' then 4 when 'in_transit' then 5 when 'delayed' then 5 when 'delivered' then 7
        when 'returned' then 8 when 'cancelled' then 8 else -1 end;
      if target_rank>=current_rank and (target_rank>current_rank or not exists(
        select 1 from public.tracking_events where shipment_id=shipment.id and occurred_at>p_occurred_at)) then
        update public.shipments set status=p_status::public.shipment_status,
          operation_state=case when p_status='delivered' then 'delivered' when p_status='cancelled' then 'cancelled'
            when p_status in ('dispatched','in_transit','delayed','returned') then 'posted' else operation_state end,
          tracking_code=coalesce(nullif(p_tracking_code,''),tracking_code),
          dispatched_at=case when p_status='dispatched' then p_occurred_at else dispatched_at end,
          delivered_at=case when p_status='delivered' then p_occurred_at else delivered_at end,updated_at=now()
        where id=shipment.id;
        insert into public.tracking_events(shipment_id,provider_event_id,status,description,occurred_at)
        values(shipment.id,p_event_key,p_status::public.shipment_status,'Atualização de transporte: '||p_status,p_occurred_at)
        on conflict(shipment_id,provider_event_id) do nothing;
      end if;
    end if;
    update public.shipping_webhook_events set processing_status='processed',error_code=null,processed_at=now()
      where id=webhook.id;
    return 'processed';
  exception when others then
    update public.shipping_webhook_events set processing_status='failed',error_code='webhook_processing_failed'
      where id=webhook.id;
    return 'failed';
  end;
end;
$$;
create function public.apply_melhor_envio_webhook(p_event_key text,p_payload_hash text,p_event_type text,p_external_id text,
  p_status text,p_occurred_at timestamptz,p_tracking_code text default null)
returns text language plpgsql security definer set search_path='' as $$
declare result text; shipment public.shipments%rowtype; previous public.order_status;
begin
  result:=public.apply_melhor_envio_webhook_base(p_event_key,p_payload_hash,p_event_type,p_external_id,p_status,p_occurred_at,p_tracking_code);
  if result<>'processed' then return result; end if;
  select * into shipment from public.shipments where provider='melhorenvio' and external_id=p_external_id for update;
  if shipment.id is null or shipment.status::text is distinct from p_status then return result; end if;
  if p_status='label_created' and shipment.operation_state in ('creating','created','purchasing','purchased','generating','reconciliation_required','failed') then
    update public.shipments set operation_state='generated',label_path='private:'||p_external_id,last_error_code=null where id=shipment.id;
  elsif p_status='ready' and shipment.operation_state in ('created','purchasing','reconciliation_required','failed') then
    update public.shipments set operation_state='purchased',last_error_code=null where id=shipment.id;
  end if;
  if p_status in ('dispatched','in_transit','delayed') then
    select status into previous from public.orders where id=shipment.order_id for update;
    if previous in ('payment_approved','processing','picking','ready_to_ship') then
      update public.orders set status='shipped',updated_at=now() where id=shipment.order_id and payment_status='approved';
      if found then insert into public.order_status_history(order_id,previous_status,new_status,reason)
        values(shipment.order_id,previous,'shipped','Postagem confirmada pelo provedor de transporte'); end if;
    end if;
  end if;
  if p_status='delivered' then perform private.enqueue_transactional_email(shipment.order_id,'review_requested'); end if;
  return result;
end;
$$;
revoke all on function public.apply_melhor_envio_webhook(text,text,text,text,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.apply_melhor_envio_webhook(text,text,text,text,text,timestamptz,text) to service_role;

create function private.enqueue_after_sale() returns trigger
language plpgsql security definer set search_path='' as $$
declare shipment record;
begin
  if new.status not in ('cancellation_requested','refund_pending','cancelled','refunded','return_requested','returned')
    or new.status=old.status then return new; end if;
  if new.status in ('cancellation_requested','refund_pending') then
    insert into public.background_jobs(queue,job_type,payload_sanitized,idempotency_key)
      values('after_sale','order.cancel',jsonb_build_object('orderId',new.id),'after-sale:cancel:'||new.id)
      on conflict(idempotency_key) do nothing;
  end if;
  for shipment in select id,operation_state from public.shipments where order_id=new.id and provider='melhorenvio' and external_id is not null loop
    if shipment.operation_state in ('created','purchased','generated') then
      insert into public.background_jobs(queue,job_type,payload_sanitized,idempotency_key)
        values('shipping','melhorenvio.cancel',jsonb_build_object('shipmentId',shipment.id),'melhorenvio:cancel:'||shipment.id)
        on conflict(idempotency_key) do nothing;
    end if;
  end loop;
  if exists(select 1 from private.bling_order_links where order_id=new.id and external_order_id is not null) then
    -- Fiscal cancellation/returns require the authorized fiscal operation and
    -- provider deadlines. Preserve a durable handoff instead of fabricating it.
    insert into public.background_jobs(queue,job_type,payload_sanitized,idempotency_key,status,error_summary)
      values('after_sale','bling.fiscal_intervention',jsonb_build_object('orderId',new.id,'status',new.status),
        'after-sale:bling:'||new.id||':'||new.status,'failed','fiscal_after_sale_authorization_required')
      on conflict(idempotency_key) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function private.enqueue_after_sale() from public,anon,authenticated;
create trigger enqueue_after_sale after update of status on public.orders for each row execute function private.enqueue_after_sale();

create function public.request_operational_order_cancellation(p_order_id uuid,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare customer uuid; job_id uuid;
begin
  if not private.has_permission('orders.update_operational_status') or not exists(
    select 1 from public.profiles where id=auth.uid() and status='active') then
    raise exception 'permission_denied' using errcode='42501'; end if;
  if length(btrim(coalesce(p_reason,'')))<5 or length(p_reason)>500 then raise exception 'invalid_reason' using errcode='22023'; end if;
  select customer_id into customer from public.orders where id=p_order_id for update;
  if customer is null then raise exception 'order_not_found' using errcode='P0002'; end if;
  perform public.begin_customer_order_cancellation(p_order_id,customer);
  select id into job_id from public.background_jobs where idempotency_key='after-sale:cancel:'||p_order_id;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,new_data_sanitized)
    values(auth.uid(),'order.cancellation.requested','order',p_order_id,jsonb_build_object('reason',p_reason,'jobId',job_id));
  return job_id;
end;
$$;
revoke all on function public.request_operational_order_cancellation(uuid,text) from public,anon;
grant execute on function public.request_operational_order_cancellation(uuid,text) to authenticated;

create function public.claim_after_sale_job(p_lock_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job public.background_jobs%rowtype; customer uuid;
begin
  if p_lock_id is null then raise exception 'lock_required' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('after-sale-claim'));
  update public.background_jobs set status='pending',lock_id=null,locked_at=null,available_at=now()
    where queue='after_sale' and job_type='order.cancel' and status='running' and locked_at<now()-interval '5 minutes';
  update public.background_jobs set status='failed',error_summary='after_sale_reconciliation_required'
    where queue='after_sale' and job_type='order.cancel' and status='pending' and (attempts>=8 or created_at<now()-interval '23 hours');
  if exists(select 1 from public.background_jobs where queue='after_sale' and status='running') then return null; end if;
  select * into job from public.background_jobs where queue='after_sale' and job_type='order.cancel' and status='pending' and available_at<=now()
    order by available_at,id for update skip locked limit 1;
  if job.id is null then return null; end if;
  select customer_id into customer from public.orders where id::text=job.payload_sanitized->>'orderId';
  update public.background_jobs set status='running',lock_id=p_lock_id,locked_at=now(),attempts=attempts+1 where id=job.id;
  return jsonb_build_object('id',job.id,'orderId',job.payload_sanitized->>'orderId','customerId',customer);
end;
$$;
create function public.finish_after_sale_job(p_job_id uuid,p_lock_id uuid,p_completed boolean) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  update public.background_jobs set status=case when p_completed then 'completed'::public.job_status
    when attempts>=8 then 'failed'::public.job_status else 'pending'::public.job_status end,
    error_summary=case when p_completed then null else 'after_sale_pending_verification' end,
    completed_at=case when p_completed then now() else null end,available_at=now()+interval '2 minutes',lock_id=null,locked_at=null
    where id=p_job_id and queue='after_sale' and status='running' and lock_id=p_lock_id;
  return found;
end;
$$;
revoke all on function public.claim_after_sale_job(uuid) from public,anon,authenticated;
revoke all on function public.finish_after_sale_job(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.claim_after_sale_job(uuid) to service_role;
grant execute on function public.finish_after_sale_job(uuid,uuid,boolean) to service_role;

create or replace function public.list_bling_order_issues(p_filter text default 'all',p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path = '' stable as $
declare result jsonb;
begin
  if not (private.has_permission('operations.documents.read') or private.has_permission('orders.read_all')
    or private.has_permission('technical.integrations.manage'))
    then raise exception 'permission_denied' using errcode='42501'; end if;
  if p_filter not in ('all','pending','failed','invoice') or p_limit not between 1 and 100 then
    raise exception 'invalid_filter'; end if;
  select coalesce(jsonb_agg(to_jsonb(items) order by items.placed_at desc),'[]'::jsonb) into result
  from (select o.id as "orderId",o.public_code as "publicCode",o.placed_at,
    link.external_order_id as "externalOrderId",link.invoice_id as "invoiceId",
    link.erp_status as "erpStatus",link.invoice_status as "invoiceStatus",
    link.last_error_code as "lastErrorCode",
    job.status::text as "jobStatus",job.error_summary as "jobError",
    (select coalesce(jsonb_agg(to_jsonb(h)),'[]'::jsonb) from (
      select history.attempt,history.outcome,history.error_code,history.occurred_at
      from private.bling_job_history history join public.background_jobs hj on hj.id=history.job_id
      where hj.queue='bling' and hj.payload_sanitized->>'orderId'=o.id::text
      order by history.occurred_at desc limit 10) h) as history
    from private.bling_order_links link join public.orders o on o.id=link.order_id
    left join lateral (select j.status,j.error_summary from public.background_jobs j
      where j.queue in ('bling','after_sale') and j.payload_sanitized->>'orderId'=o.id::text
      order by (j.status='failed') desc,j.created_at desc limit 1) job on true
    where p_filter='all' or (p_filter='pending' and link.erp_status='pending')
      or (p_filter='failed' and (link.erp_status in ('failed','reconciliation_required') or job.status='failed'))
      or (p_filter='invoice' and link.erp_status='synced' and link.invoice_status not in ('authorized','cancelled'))
    order by o.placed_at desc nulls last limit p_limit) items;
  return result;
end;
$;

-- Creating personal support does not confer any staff permission. Ownership stays auth.uid().
create or replace function public.create_support_conversation(
  p_category text,
  p_subject text,
  p_initial_message text,
  p_related_order_code text default null,
  p_client_request_id uuid default gen_random_uuid()
)
returns public.support_conversations
language plpgsql
security definer
set search_path = ''
as $
declare
  existing_conversation public.support_conversations;
  new_conversation public.support_conversations;
  selected_category public.support_categories;
  selected_order_id uuid;
  category_slug text;
begin
  if auth.uid() is null or not private.is_active_user() then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if char_length(trim(p_subject)) not between 5 and 120
     or char_length(trim(p_initial_message)) not between 10 and 4000 then
    raise exception 'invalid support content' using errcode = '22023';
  end if;

  select c.* into existing_conversation
  from public.support_conversations c
  where c.customer_id = auth.uid() and c.client_request_id = p_client_request_id;
  if found then return existing_conversation; end if;

  category_slug := case p_category
    when 'order' then 'pedido'
    when 'payment' then 'pagamento'
    when 'delivery' then 'entrega'
    when 'return' then 'troca-devolucao'
    when 'product' then 'produto'
    when 'account' then 'conta'
    when 'technical' then 'problema-tecnico'
    else 'outro'
  end;

  select c.* into selected_category
  from public.support_categories c
  where c.slug = category_slug and c.active = true;
  if not found then raise exception 'support category unavailable'; end if;

  if nullif(trim(coalesce(p_related_order_code, '')), '') is not null then
    select o.id into selected_order_id
    from public.orders o
    where o.public_code = trim(p_related_order_code) and o.customer_id = auth.uid();
    if not found then raise exception 'order not found' using errcode = '22023'; end if;
  end if;

  insert into public.support_conversations(
    customer_id, related_order_id, category_id, priority, origin, subject, client_request_id
  ) values (
    auth.uid(), selected_order_id, selected_category.id, selected_category.default_priority,
    'store', trim(p_subject), p_client_request_id
  ) returning * into new_conversation;

  insert into public.support_participants(conversation_id, user_id, participant_role)
  values (new_conversation.id, auth.uid(), 'customer');

  insert into public.support_messages(
    conversation_id, sender_id, sender_role, content_sanitized, is_internal_note
  ) values (
    new_conversation.id, auth.uid(), 'customer', trim(p_initial_message), false
  );

  insert into public.support_status_history(
    conversation_id, previous_status, new_status, reason, changed_by
  ) values (
    new_conversation.id, null, 'queued', 'Chamado criado pelo cliente', auth.uid()
  );

  insert into public.notifications(user_id, type, title, body)
  select distinct ur.user_id, 'support_new', 'Novo atendimento na fila', new_conversation.public_code
  from public.user_roles ur
  join public.profiles p on p.id = ur.user_id and p.status = 'active'
  where ur.role = 'admin';

  return new_conversation;
end;
$;

commit;
notify pgrst,'reload schema';

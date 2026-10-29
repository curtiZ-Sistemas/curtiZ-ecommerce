begin;
-- Count calendar days locally and keep unrelated orders moving during reconciliation.
create function private.return_withdrawal_within_period(p_delivery timestamptz,p_requested timestamptz) returns boolean
language sql immutable set search_path='' as $$
  select p_delivery is null or (p_requested at time zone 'America/Sao_Paulo')::date <= (p_delivery at time zone 'America/Sao_Paulo')::date+7
$$;
revoke all on function private.return_withdrawal_within_period(timestamptz,timestamptz) from public,anon,authenticated;
create or replace function public.request_customer_return_v2(p_order_item_id uuid,p_quantity integer,p_reason text,p_description text,p_resolution text,p_kind text)
returns uuid language plpgsql security definer set search_path='' as $$
declare item public.order_items%rowtype; o public.orders%rowtype; used integer; delivery timestamptz; result_id uuid;
begin
  if auth.uid() is null or not private.is_active_user() then raise exception 'authentication_required' using errcode='42501'; end if;
  select * into item from public.order_items where id=p_order_item_id;
  select * into o from public.orders where id=item.order_id and customer_id=auth.uid() for update;
  if o.id is null or o.status not in ('delivered','return_requested','returned') then raise exception 'delivered_item_not_found' using errcode='P0002'; end if;
  if p_kind is null or p_kind not in ('withdrawal','defect','preference') or p_resolution is null or p_resolution not in ('exchange','refund','store_credit')
    or p_quantity is null or p_quantity<1 or p_quantity>item.quantity or char_length(coalesce(trim(p_reason),''))>120
    or char_length(coalesce(trim(p_description),''))>2000 then raise exception 'invalid_return_request' using errcode='23514'; end if;
  -- Unknown/late dates go to manual review; never silently reclassify a withdrawal or latent defect.
  select max(delivered_at) into delivery from public.shipments where order_id=o.id and status='delivered';
  select coalesce(sum(i.quantity),0) into used from public.return_items i join public.returns r on r.id=i.return_id
    where i.order_item_id=item.id and r.status not in ('rejected','cancelled');
  if used+p_quantity>item.quantity then raise exception 'return_quantity_unavailable' using errcode='23514'; end if;
  insert into public.returns(order_id,customer_id,reason,description,requested_resolution,request_kind,eligibility_snapshot)
    values(o.id,auth.uid(),coalesce(nullif(trim(p_reason),''),case p_kind when 'withdrawal' then 'Arrependimento da compra' when 'defect' then 'Defeito ou divergência' else 'Troca por preferência' end),
      coalesce(trim(p_description),''),p_resolution,p_kind,jsonb_build_object('requiresManualReview',true,'deliveredAt',delivery,
      'withinWithdrawalPeriod',case when delivery is null then null else private.return_withdrawal_within_period(delivery,now()) end,'evaluatedAt',now())) returning id into result_id;
  insert into public.return_items(return_id,order_item_id,quantity) values(result_id,item.id,p_quantity);
  -- Item-level return state must not block the other delivered items or overwrite delivery.
  return result_id;
end;
$$;
create or replace function public.review_customer_return(p_return_id uuid,p_action text,p_message text,p_instructions text default '',p_code text default '')
returns public.returns language plpgsql security definer set search_path='' as $$
declare r public.returns%rowtype; delivery timestamptz; target public.return_status;
begin
  perform private.require_permission(case when p_action='refund' then 'returns.refund' when p_action in ('receive','transit') then 'returns.inspect' else 'returns.approve' end);
  if char_length(coalesce(trim(p_message),'')) not between 5 and 2000 or char_length(coalesce(p_instructions,''))>2000
    or char_length(coalesce(p_code,''))>120 then raise exception 'invalid_return_review' using errcode='23514'; end if;
  -- Consistent order-first locking also serializes refund decisions across returns.
  perform 1 from public.orders where id=(select order_id from public.returns where id=p_return_id) for update;
  select * into r from public.returns where id=p_return_id for update;
  if r.id is null then raise exception 'return_not_found' using errcode='P0002'; end if;
  target:=case p_action when 'review' then 'in_review' when 'photos' then 'waiting_photos' when 'approve' then 'approved'
    when 'reject' then 'rejected' when 'posting' then 'waiting_posting' when 'transit' then 'in_transit'
    when 'receive' then 'received' when 'exchange' then 'exchange_sent' when 'complete' then 'completed'
    when 'refund' then 'refund_requested' else null end;
  if target is null or not (
    (p_action in ('review','photos','approve','reject') and r.status in ('requested','in_review','waiting_photos')) or
    (p_action='posting' and r.status in ('approved','waiting_posting')) or
    (p_action='transit' and r.status='waiting_posting') or
    (p_action='receive' and r.status in ('approved','waiting_posting','in_transit')) or
    (p_action='exchange' and r.status='inspection' and r.requested_resolution='exchange') or
    (p_action='complete' and r.status='exchange_sent') or
    (p_action='refund' and r.status in ('approved','waiting_posting','in_transit','received','inspection') and r.requested_resolution='refund')
  ) then raise exception 'return_transition_not_allowed' using errcode='23514'; end if;
  select max(delivered_at) into delivery from public.shipments where order_id=r.order_id and status='delivered';
  if p_action in ('reject','photos') and r.request_kind='withdrawal' and
    (delivery is null or private.return_withdrawal_within_period(delivery,r.requested_at)) then
    raise exception 'withdrawal_cannot_be_blocked' using errcode='23514'; end if;
  if p_action='posting' and (char_length(trim(coalesce(p_code,'')))<3 or char_length(trim(coalesce(p_instructions,'')))<10) then
    raise exception 'posting_instructions_required' using errcode='23514'; end if;
  if p_action in ('transit','exchange') and char_length(trim(coalesce(p_code,'')))<3 then raise exception 'tracking_required' using errcode='23514'; end if;
  if p_action='exchange' and exists(select 1 from public.return_items where return_id=r.id and inspection_result is null) then
    raise exception 'inspection_required' using errcode='23514'; end if;
  update public.returns set status=target,customer_message=trim(p_message),reviewed_at=now(),
    approved_by=case when p_action='approve' then auth.uid() else approved_by end,
    return_instructions=case when p_action='posting' then trim(p_instructions) else return_instructions end,
    reverse_logistics_code=case when p_action='posting' then trim(p_code) else reverse_logistics_code end,
    reverse_tracking_code=case when p_action='transit' then trim(p_code) else reverse_tracking_code end,
    exchange_tracking_code=case when p_action='exchange' then trim(p_code) else exchange_tracking_code end,
    resolved_at=case when target in ('rejected','completed') then now() else resolved_at end where id=r.id returning * into r;
  if p_action='refund' then insert into private.return_jobs(return_id,kind) values(r.id,'refund') on conflict do nothing; end if;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,new_data_sanitized)
    values(auth.uid(),'returns.'||p_action,'return',r.id,jsonb_build_object('status',target));
  return r;
end;
$$;
create or replace function public.claim_return_job_base(p_kind text,p_lock_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j private.return_jobs%rowtype; r public.returns%rowtype; o public.orders%rowtype; p public.payments%rowtype;
  item public.order_items%rowtype; qty integer; used integer; offset_value numeric; total_value numeric; amount_cents bigint;
begin
  if p_kind not in ('refund','email') or p_lock_id is null then raise exception 'invalid_job_claim'; end if;
  perform pg_advisory_xact_lock(hashtext('return-jobs-'||p_kind));
  -- External writes with expired leases require reconciliation, never a blind replay.
  update private.return_jobs set state='review',error_code='lease_expired' where kind=p_kind and state='running' and locked_at<now()-interval '5 minutes';
  select candidate.* into j from private.return_jobs candidate where candidate.kind=p_kind and candidate.state='pending' and candidate.due_at<=now()
    and (p_kind<>'refund' or not exists(select 1 from private.return_jobs other join public.returns other_return on other_return.id=other.return_id
      join public.returns this_return on this_return.id=candidate.return_id where other_return.order_id=this_return.order_id
      and other.kind='refund' and other.id<>candidate.id and other.state in ('running','review')))
    order by candidate.due_at,candidate.id for update of candidate skip locked limit 1;
  if j.id is null then return null; end if;
  perform 1 from public.orders where id=(select order_id from public.returns where id=j.return_id) for update;
  select * into r from public.returns where id=j.return_id for update;
  select * into o from public.orders where id=r.order_id;
  if p_kind='refund' then
    if r.status<>'refund_requested' or exists(select 1 from private.return_jobs other join public.returns rr on rr.id=other.return_id
      where rr.order_id=r.order_id and other.kind='refund' and other.id<>j.id and other.state in ('running','review')) then return null; end if;
    select * into p from public.payments where order_id=o.id and provider='mercadopago' and status='approved' order by created_at desc limit 1 for update;
    select oi.* into item from public.order_items oi join public.return_items ri on ri.order_item_id=oi.id where ri.return_id=r.id;
    select quantity into qty from public.return_items where return_id=r.id and order_item_id=item.id;
    select coalesce(sum(ri.quantity),0) into used from public.return_items ri join public.returns rr on rr.id=ri.return_id
      where ri.order_item_id=item.id and rr.id<>r.id and rr.refund_provider_id is not null;
    select sum(total) into total_value from public.order_items where order_id=o.id;
    select coalesce(sum(total),0) into offset_value from public.order_items where order_id=o.id and id<item.id;
    -- Cumulative integer allocation conserves every cent across items/quantities, including original shipping.
    amount_cents:=floor(o.grand_total*100*(offset_value+item.total*(used+qty)/item.quantity)/nullif(total_value,0))
      -floor(o.grand_total*100*(offset_value+item.total*used/item.quantity)/nullif(total_value,0));
    if p.id is null or p.amount<>o.grand_total or p.currency<>'BRL' or p.provider_payment_id is null
      or amount_cents is null or amount_cents<=0 or used+qty>item.quantity or
      amount_cents+(select coalesce(sum(refund_amount*100),0) from public.returns where order_id=o.id and refund_provider_id is not null)>p.amount*100
      or exists(select 1 from public.payment_refunds where order_id=o.id and status<>'failed') then
      update private.return_jobs set state='review',error_code='refund_requires_review' where id=j.id;
      update public.returns set refund_error='refund_requires_review' where id=r.id; return null;
    end if;
    update public.returns set refund_amount=amount_cents/100.0,refund_error=null where id=r.id;
  end if;
  update private.return_jobs set state='running',lock_id=p_lock_id,locked_at=now(),attempts=attempts+1 where id=j.id;
  return jsonb_build_object('id',j.id,'returnId',r.id,'code',r.public_code,'orderId',o.id,'orderCode',o.public_code,'customerId',r.customer_id,
    'email',o.customer_email_snapshot,'name',o.customer_name_snapshot,'status',r.status,'eventId',j.event_id,'providerId',j.provider_id,
    'paymentId',p.provider_payment_id,'amountInCents',amount_cents,'paymentAmountInCents',p.amount*100,'idempotencyKey','return:'||j.id::text,
    'knownRefundIds',(select coalesce(jsonb_agg(refund_provider_id),'[]') from public.returns where order_id=o.id and refund_provider_id is not null));
end;
$$;
create or replace function public.claim_return_job(p_kind text,p_lock_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j private.return_jobs%rowtype; r public.returns%rowtype; o public.orders%rowtype; p public.payments%rowtype;
begin
  update public.returns r set refund_error='refund_requires_review' where r.status='refund_requested' and exists(
    select 1 from private.return_jobs j where j.return_id=r.id and j.kind='refund' and
      (j.state='review' or (j.state='running' and j.locked_at<now()-interval '5 minutes')));
  if p_kind<>'refund' then return public.claim_return_job_base(p_kind,p_lock_id); end if;
  if p_lock_id is null then raise exception 'invalid_job_claim'; end if;
  perform pg_advisory_xact_lock(hashtext('return-jobs-refund'));
  select * into j from private.return_jobs where kind='refund' and state='pending' and provider_id is not null and due_at<=now()
    order by due_at,id for update skip locked limit 1;
  if j.id is null then return public.claim_return_job_base(p_kind,p_lock_id); end if;
  perform 1 from public.orders where id=(select order_id from public.returns where id=j.return_id) for update;
  select * into r from public.returns where id=j.return_id for update;
  select * into o from public.orders where id=r.order_id;
  select * into p from public.payments where order_id=o.id and provider='mercadopago' and provider_payment_id is not null order by created_at desc limit 1;
  if r.status<>'refund_requested' or r.refund_amount is null or p.id is null then
    update private.return_jobs set state='review',error_code='refund_requires_review' where id=j.id; return null; end if;
  update private.return_jobs set state='running',lock_id=p_lock_id,locked_at=now(),attempts=attempts+1 where id=j.id;
  return jsonb_build_object('id',j.id,'returnId',r.id,'orderId',o.id,'orderCode',o.public_code,'customerId',r.customer_id,
    'paymentId',p.provider_payment_id,'amountInCents',r.refund_amount*100,'paymentAmountInCents',p.amount*100,'providerId',j.provider_id,
    'idempotencyKey','return:'||j.id::text,'knownRefundIds','[]'::jsonb);
end;
$$;
notify pgrst,'reload schema';
commit;

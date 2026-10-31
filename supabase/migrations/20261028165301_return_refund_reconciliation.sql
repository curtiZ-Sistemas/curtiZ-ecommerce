begin;
-- Reconciliation only reads the payment provider; it never issues another refund.
create function public.request_return_refund_reconciliation(p_return_id uuid,p_provider_id text,p_message text)
returns boolean language plpgsql security definer set search_path='' as $$
declare j private.return_jobs%rowtype; r public.returns%rowtype;
begin
  perform private.require_permission('returns.refund');
  if char_length(trim(coalesce(p_provider_id,''))) not between 1 and 120 or char_length(trim(coalesce(p_message,''))) not between 5 and 2000 then
    raise exception 'invalid_reconciliation' using errcode='23514'; end if;
  select * into j from private.return_jobs where return_id=p_return_id and kind='refund' and state='review' for update;
  if j.id is null then raise exception 'reconciliation_not_available' using errcode='23514'; end if;
  perform 1 from public.orders where id=(select order_id from public.returns where id=p_return_id) for update;
  select * into r from public.returns where id=p_return_id and status='refund_requested' for update;
  if r.id is null or r.refund_amount is null or (j.provider_id is not null and j.provider_id<>trim(p_provider_id)) then
    raise exception 'reconciliation_not_available' using errcode='23514'; end if;
  update private.return_jobs set state='pending',provider_id=trim(p_provider_id),due_at=now(),lock_id=null,locked_at=null where id=j.id;
  update public.returns set customer_message=trim(p_message) where id=r.id;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,new_data_sanitized)
    values(auth.uid(),'returns.refund.reconcile_requested','return',r.id,jsonb_build_object('providerRefundId',trim(p_provider_id)));
  return true;
end;
$$;
revoke all on function public.request_return_refund_reconciliation(uuid,text,text) from public,anon;
grant execute on function public.request_return_refund_reconciliation(uuid,text,text) to authenticated;

alter function public.claim_return_job(text,uuid) rename to claim_return_job_base;
revoke all on function public.claim_return_job_base(text,uuid) from public,anon,authenticated,service_role;
create function public.claim_return_job(p_kind text,p_lock_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j private.return_jobs%rowtype; r public.returns%rowtype; o public.orders%rowtype; p public.payments%rowtype;
begin
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
revoke all on function public.claim_return_job(text,uuid) from public,anon,authenticated;
grant execute on function public.claim_return_job(text,uuid) to service_role;
notify pgrst,'reload schema';
commit;

begin;
-- Explicit aliases avoid collision with PL/pgSQL row variables.
create or replace function public.claim_return_job(p_kind text,p_lock_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j private.return_jobs%rowtype; r public.returns%rowtype; o public.orders%rowtype; p public.payments%rowtype;
begin
  update public.returns pending_return set refund_error='refund_requires_review' where pending_return.status='refund_requested' and exists(
    select 1 from private.return_jobs queue_job where queue_job.return_id=pending_return.id and queue_job.kind='refund' and
      (queue_job.state='review' or (queue_job.state='running' and queue_job.locked_at<now()-interval '5 minutes')));
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

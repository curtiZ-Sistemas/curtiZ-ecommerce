-- Isolated database only. Queue fixtures are transaction-local; no provider runs.
begin;
select no_plan();
do $$ begin
  if exists(select 1 from public.background_jobs where queue='shipping' and status='running') then
    raise exception 'scope_test_requires_idle_isolated_queue'; end if;
end $$;
select ok(not has_function_privilege('anon','public.claim_melhor_envio_shipment_job(uuid,uuid,boolean,boolean)','execute'),'Anonymous cannot claim a shipment');
select ok(not has_function_privilege('authenticated','public.claim_melhor_envio_shipment_job(uuid,uuid,boolean,boolean)','execute'),'Browser roles cannot claim a shipment');
select ok(has_function_privilege('service_role','public.claim_melhor_envio_shipment_job(uuid,uuid,boolean,boolean)','execute'),'Worker may claim a shipment');
select ok(not has_function_privilege('service_role','private.claim_melhor_envio_fulfillment_job(uuid,boolean,boolean,uuid)','execute'),'Private implementation is not granted to runtime callers');
select throws_ok($$select public.claim_melhor_envio_shipment_job(null,'f3000000-0000-4000-8000-000000000090')$$,'22023','shipment_scope_required','Null scope cannot fall back to the global queue');
select throws_ok($$select public.claim_melhor_envio_shipment_job('f3000000-0000-4000-8000-000000000010',null)$$,'22023','lock_required','Scoped claims retain the lock requirement');
insert into public.background_jobs(id,queue,job_type,payload_sanitized,available_at,idempotency_key) values
('f3000000-0000-4000-8000-000000000001','shipping','melhorenvio.create','{"shipmentId":"f3000000-0000-4000-8000-000000000020"}','1999-01-01','scope-test:other'),
('f3000000-0000-4000-8000-000000000002','shipping','melhorenvio.create','{"shipmentId":"f3000000-0000-4000-8000-000000000010"}','2000-01-01','scope-test:create'),
('f3000000-0000-4000-8000-000000000003','shipping','melhorenvio.purchase','{"shipmentId":"f3000000-0000-4000-8000-000000000010"}','2000-01-02','scope-test:purchase'),
('f3000000-0000-4000-8000-000000000004','shipping','melhorenvio.generate','{"shipmentId":"f3000000-0000-4000-8000-000000000010"}','2000-01-03','scope-test:generate'),
('f3000000-0000-4000-8000-000000000005','shipping','melhorenvio.cancel','{"shipmentId":"f3000000-0000-4000-8000-000000000010"}','1999-01-02','scope-test:cancel');
select is(public.claim_melhor_envio_shipment_job('f3000000-0000-4000-8000-000000000010','f3000000-0000-4000-8000-000000000090',false,false)->>'id','f3000000-0000-4000-8000-000000000002','Scoped claim skips the older unrelated shipment');
select is((select status::text from public.background_jobs where id='f3000000-0000-4000-8000-000000000001'),'pending','Unrelated queue entry remains untouched');
select is((select status::text from public.background_jobs where id='f3000000-0000-4000-8000-000000000005'),'pending','Scoped homologation never cancels');
select ok(public.claim_melhor_envio_shipment_job('f3000000-0000-4000-8000-000000000010','f3000000-0000-4000-8000-000000000091',true,true) is null,'An active account lease blocks another claim');
update public.background_jobs set status='completed',lock_id=null,locked_at=null where id='f3000000-0000-4000-8000-000000000002';
select ok(public.claim_melhor_envio_shipment_job('f3000000-0000-4000-8000-000000000010','f3000000-0000-4000-8000-000000000090',false,false) is null,'Purchase and generation remain gated');
select is(public.claim_melhor_envio_shipment_job('f3000000-0000-4000-8000-000000000010','f3000000-0000-4000-8000-000000000090',false,true)->>'id','f3000000-0000-4000-8000-000000000004','Generation flag enables only generation');
select is((select status::text from public.background_jobs where id='f3000000-0000-4000-8000-000000000003'),'pending','Purchase remains pending without its flag');
update public.background_jobs set status='completed',lock_id=null,locked_at=null where id='f3000000-0000-4000-8000-000000000004';
select is(public.claim_melhor_envio_shipment_job('f3000000-0000-4000-8000-000000000010','f3000000-0000-4000-8000-000000000090',true,true)->>'id','f3000000-0000-4000-8000-000000000003','Purchase uses its existing job');
update public.background_jobs set status='completed',lock_id=null,locked_at=null where id='f3000000-0000-4000-8000-000000000003';
select ok(public.claim_melhor_envio_shipment_job('f3000000-0000-4000-8000-000000000010','f3000000-0000-4000-8000-000000000090',true,true) is null,'No fallback to unrelated work or cancellation');
select is(public.claim_melhor_envio_fulfillment_job('f3000000-0000-4000-8000-000000000090',true,true)->>'id','f3000000-0000-4000-8000-000000000001','Normal worker preserves global queue behavior');
update public.background_jobs set status='completed',lock_id=null,locked_at=null where id='f3000000-0000-4000-8000-000000000001';
insert into public.background_jobs(id,queue,job_type,payload_sanitized,status,locked_at,lock_id,idempotency_key) values
('f3000000-0000-4000-8000-000000000007','shipping','melhorenvio.purchase','{"shipmentId":"f3000000-0000-4000-8000-000000000020"}','running',now()-interval '8 minutes','f3000000-0000-4000-8000-000000000091','scope-test:other-expired');
select ok(public.claim_melhor_envio_shipment_job('f3000000-0000-4000-8000-000000000010','f3000000-0000-4000-8000-000000000090',true,true) is null,'Unrelated expired lease remains an account-wide blocker');
select is((select status::text from public.background_jobs where id='f3000000-0000-4000-8000-000000000007'),'running','Scoped housekeeping never changes another shipment lease');
update public.background_jobs set status='completed',lock_id=null,locked_at=null where id='f3000000-0000-4000-8000-000000000007';
insert into public.background_jobs(id,queue,job_type,payload_sanitized,status,locked_at,lock_id,idempotency_key) values
('f3000000-0000-4000-8000-000000000008','shipping','melhorenvio.purchase','{"shipmentId":"f3000000-0000-4000-8000-000000000010"}','running',now()-interval '8 minutes','f3000000-0000-4000-8000-000000000091','scope-test:own-expired');
select ok(public.claim_melhor_envio_shipment_job('f3000000-0000-4000-8000-000000000010','f3000000-0000-4000-8000-000000000090',true,true) is null,'Scoped expired write is not replayed');
select is((select error_summary from public.background_jobs where id='f3000000-0000-4000-8000-000000000008'),'lease_expired_reconciliation_required','Uncertain write retains reconciliation requirement');
select is(public.claim_melhor_envio_fulfillment_job('f3000000-0000-4000-8000-000000000090',false,false)->>'id','f3000000-0000-4000-8000-000000000005','Normal queue retains its cancellation contract');
set local role authenticated;
select throws_ok($$select public.claim_melhor_envio_shipment_job('f3000000-0000-4000-8000-000000000010','f3000000-0000-4000-8000-000000000090')$$,'42501',null,'Authenticated actor cannot invoke the worker RPC');
reset role;
select * from finish(true);
rollback;

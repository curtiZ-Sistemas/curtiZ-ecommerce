-- Isolated database only; all synthetic jobs roll back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);
select ok(not has_function_privilege('anon','public.claim_bling_order_job(uuid,boolean,boolean,boolean,boolean,boolean,boolean,boolean,uuid)','execute'),'Anonymous callers cannot claim a scoped job');
select ok(not has_function_privilege('authenticated','public.claim_bling_order_job(uuid,boolean,boolean,boolean,boolean,boolean,boolean,boolean,uuid)','execute'),'Browser callers cannot claim a scoped job');
select ok(has_function_privilege('service_role','public.claim_bling_order_job(uuid,boolean,boolean,boolean,boolean,boolean,boolean,boolean,uuid)','execute'),'Trusted server can claim a scoped job');
select ok(not has_function_privilege('service_role','private.claim_bling_job(uuid,boolean,boolean,boolean,boolean,boolean,boolean,boolean,uuid)','execute'),'Server cannot bypass public claim contracts');
insert into public.background_jobs(id,queue,job_type,payload_sanitized,idempotency_key,status,available_at,attempts,locked_at,lock_id) values
('d3100000-0000-4000-8000-000000000001','bling','bling.order.create','{"orderId":"d3000000-0000-4000-8000-000000000001"}','homologation-scope:target','pending',now(),0,null,null),
('d3100000-0000-4000-8000-000000000002','bling','bling.order.create','{"orderId":"d3000000-0000-4000-8000-000000000002"}','homologation-scope:other','pending',now()-interval '1 day',0,null,null),
('d3100000-0000-4000-8000-000000000003','bling','bling.order.reconcile','{"orderId":"d3000000-0000-4000-8000-000000000002"}','homologation-scope:other-expired','running',now(),5,now()-interval '10 minutes','d3200000-0000-4000-8000-000000000003'),
('d3100000-0000-4000-8000-000000000004','bling','bling.stock.sync','{"orderId":"d3000000-0000-4000-8000-000000000001","variantId":"d3300000-0000-4000-8000-000000000001"}','homologation-scope:catalog-expired','running',now(),5,now()-interval '10 minutes','d3200000-0000-4000-8000-000000000004');
select is(public.claim_bling_order_job('d3200000-0000-4000-8000-000000000001',true,true,true,true,true,true,true,null),null::jsonb,'Null scope never selects the global queue');
select is(public.claim_bling_order_job('d3200000-0000-4000-8000-000000000001',false,false,false,false,false,false,false,'d3000000-0000-4000-8000-000000000001'),null::jsonb,'Scope does not enable disabled flags');
create temporary table scoped_claim as select public.claim_bling_order_job('d3200000-0000-4000-8000-000000000001',true,true,true,true,true,true,true,'d3000000-0000-4000-8000-000000000001') as value;
select is((select value->'payload'->>'orderId' from scoped_claim),'d3000000-0000-4000-8000-000000000001','Only the selected order is claimed even when another is older');
select is((select attempts from public.background_jobs where id='d3100000-0000-4000-8000-000000000001'),1,'Claim advances the selected lease attempt');
select ok((select status='pending' and attempts=0 from public.background_jobs where id='d3100000-0000-4000-8000-000000000002'),'Other pending order is untouched');
select is((select status::text from public.background_jobs where id='d3100000-0000-4000-8000-000000000003'),'running','Other exhausted lease is not modified by the scoped claim');
select is((select status::text from public.background_jobs where id='d3100000-0000-4000-8000-000000000004'),'running','Catalog lease is not modified even with a matching order field');
select is(public.claim_bling_order_job('d3200000-0000-4000-8000-000000000002',true,true,true,true,true,true,true,'d3000000-0000-4000-8000-000000000001'),null::jsonb,'Active lease prevents a second claim');
select ok(public.finish_bling_job('d3100000-0000-4000-8000-000000000001','d3200000-0000-4000-8000-000000000001','completed',null),'Existing finalizer completes the selected job');
select is(public.claim_bling_order_job('d3200000-0000-4000-8000-000000000002',true,true,true,true,true,true,true,'d3000000-0000-4000-8000-000000000001'),null::jsonb,'Completed scope does not pick another order or catalog job');
select is(public.claim_bling_job('d3200000-0000-4000-8000-000000000002',true,true,true,true,true,true,true)->'payload'->>'orderId','d3000000-0000-4000-8000-000000000002','Legacy API keeps global queue behavior');
select is((select status::text from public.background_jobs where id='d3100000-0000-4000-8000-000000000003'),'failed','Legacy API still expires exhausted leases globally');
select * from finish();
rollback;

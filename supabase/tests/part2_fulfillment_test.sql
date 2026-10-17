-- Isolated CI database only. All fixtures roll back; no provider is called.
begin;
select no_plan();
select ok(not has_function_privilege('authenticated','public.request_shipping_action(uuid,text,uuid)','execute'),'Actor IDs cannot be forged from the browser');
select ok(not has_function_privilege('anon','public.claim_after_sale_job(uuid)','execute'),'After-sale workers are service-only');
select ok(not has_function_privilege('authenticated','public.apply_melhor_envio_webhook_base(text,text,text,text,text,timestamptz,text)','execute'),'Legacy webhook implementation remains private');
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
values('f2000000-0000-4000-8000-000000000001','part2-customer@example.invalid','{}','{}'),
('f2000000-0000-4000-8000-000000000002','part2-staff@example.invalid','{}','{}');
update public.profiles set status='active' where id in ('f2000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000002');
insert into public.user_roles(user_id,role) values('f2000000-0000-4000-8000-000000000002','operational') on conflict do nothing;
insert into public.orders(id,public_code,customer_id,customer_email_snapshot,customer_name_snapshot,status,payment_status,subtotal,grand_total,shipping_address_snapshot)
values('f2100000-0000-4000-8000-000000000001','PART2-CI','f2000000-0000-4000-8000-000000000001','part2-customer@example.invalid','Part2 CI','picking','approved',50,50,'{}');
insert into public.payments(order_id,provider,provider_payment_id,external_reference,status,amount)
values('f2100000-0000-4000-8000-000000000001','mercadopago','part2-test-payment','PART2-CI','approved',50);
select public.set_bling_shipping_policy(false);
insert into public.shipments(id,order_id,provider,service,external_id,status,operation_state)
values('f2200000-0000-4000-8000-000000000001','f2100000-0000-4000-8000-000000000001','melhorenvio','CI','part2-external','pending','created');
select is((select count(*) from public.background_jobs where idempotency_key='melhorenvio:purchase:f2200000-0000-4000-8000-000000000001'),1::bigint,'Cart creation durably schedules purchase once');
select is(public.claim_melhor_envio_fulfillment_job('f2000000-0000-4000-8000-000000000010'),null::jsonb,'Default flags cannot buy labels');
select throws_ok($$select public.request_shipping_action('f2200000-0000-4000-8000-000000000001','purchase','f2000000-0000-4000-8000-000000000001')$$,'42501','permission_denied','Customer cannot request internal shipping operations');
select is(public.request_shipping_action('f2200000-0000-4000-8000-000000000001','purchase','f2000000-0000-4000-8000-000000000002'),
  public.request_shipping_action('f2200000-0000-4000-8000-000000000001','purchase','f2000000-0000-4000-8000-000000000002'),'Repeated panel requests reuse one persistent job');
create temporary table part2_claim as select public.claim_melhor_envio_fulfillment_job('f2000000-0000-4000-8000-000000000010',true,true) job;
select is((select job->>'jobType' from part2_claim),'melhorenvio.purchase','Enabled worker claims the correct stage');
select is(public.claim_melhor_envio_fulfillment_job('f2000000-0000-4000-8000-000000000011',true,true),null::jsonb,'Concurrent worker cannot claim another stage');
select ok(not public.finish_melhor_envio_job((select (job->>'id')::uuid from part2_claim),'f2000000-0000-4000-8000-000000000011',true),'Wrong lease cannot acknowledge a job');
select ok(public.finish_melhor_envio_job((select (job->>'id')::uuid from part2_claim),'f2000000-0000-4000-8000-000000000010',false,'provider_unavailable'),'Safe transient failure can be retried');
select is((select status::text from public.background_jobs where id=(select (job->>'id')::uuid from part2_claim)),'pending','Transient failure retains the same job');
update public.background_jobs set available_at=now() where id=(select (job->>'id')::uuid from part2_claim);
select public.claim_melhor_envio_fulfillment_job('f2000000-0000-4000-8000-000000000010',true,true);
select public.finish_melhor_envio_job((select (job->>'id')::uuid from part2_claim),'f2000000-0000-4000-8000-000000000010',false,'uncertain_write');
select is((select status::text from public.background_jobs where id=(select (job->>'id')::uuid from part2_claim)),'failed','Uncertain purchase is never retried automatically');
update public.shipments set operation_state='reconciliation_required' where id='f2200000-0000-4000-8000-000000000001';
select throws_ok($$select public.request_shipping_action('f2200000-0000-4000-8000-000000000001','purchase','f2000000-0000-4000-8000-000000000002')$$,'55000','shipping_reconciliation_required','Panel cannot replay an uncertain charge');
select is((select count(*) from public.background_jobs where idempotency_key='melhorenvio:sync:f2200000-0000-4000-8000-000000000001'),1::bigint,'Uncertain write schedules read-only reconciliation');
select is(public.apply_melhor_envio_webhook('part2-paid','hash1','order.released','part2-external','ready',now()),'processed','Authenticated provider observation reconciles payment');
select is((select operation_state from public.shipments where id='f2200000-0000-4000-8000-000000000001'),'purchased','Confirmed carrier payment unlocks generation');
select is((select count(*) from public.background_jobs where idempotency_key='melhorenvio:generate:f2200000-0000-4000-8000-000000000001'),1::bigint,'Generation is durably scheduled');
select is(public.apply_melhor_envio_webhook('part2-generated','hash2','order.generated','part2-external','label_created',now()),'processed','Generated label advances after payment');
select is((select operation_state from public.shipments where id='f2200000-0000-4000-8000-000000000001'),'generated','Label generation is confirmed, not inferred');
select public.apply_melhor_envio_webhook('part2-posted','hash3','order.posted','part2-external','dispatched',now());
select is((select status::text from public.orders where id='f2100000-0000-4000-8000-000000000001'),'shipped','Carrier posting advances customer order');
select public.apply_melhor_envio_webhook('part2-delivered','hash4','order.delivered','part2-external','delivered',now());
select is((select status::text from public.orders where id='f2100000-0000-4000-8000-000000000001'),'delivered','Carrier delivery advances complete order');
select public.apply_melhor_envio_webhook('part2-old','hash5','order.posted','part2-external','dispatched',now()-interval '1 day');
select is((select status::text from public.shipments where id='f2200000-0000-4000-8000-000000000001'),'delivered','Out-of-order event cannot regress delivery');
insert into public.background_jobs(queue,job_type,payload_sanitized,idempotency_key)
values('bling','bling.invoice.email','{}','part2-unapproved-email');
select is((select status::text from public.background_jobs where idempotency_key='part2-unapproved-email'),'cancelled','Third email kind cannot be activated by legacy flags');
select ok(not private.transactional_email_eligible('f2100000-0000-4000-8000-000000000001','invoice'),'Unknown email type is ineligible');
select set_config('request.jwt.claims','{"sub":"f2000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select ok(private.user_has_role('customer') and private.user_has_role('operational'),'Customer and employee roles coexist without replacing either');
select lives_ok($$select public.create_support_conversation('order','Personal support for employee','A personal request from the employee customer account',null,'f2000000-0000-4000-8000-000000000099')$$,'Employee can open personal support without impersonating another customer');
select throws_ok($$select public.request_operational_order_cancellation('f2100000-0000-4000-8000-000000000001','CI cancellation')$$,'23514','cancellation_not_allowed','Delivered order requires return flow, never ordinary cancellation');
reset role;
insert into public.orders(id,public_code,customer_id,customer_email_snapshot,customer_name_snapshot,status,payment_status,subtotal,grand_total,shipping_address_snapshot)
values('f2100000-0000-4000-8000-000000000002','PART2-CANCEL-CI','f2000000-0000-4000-8000-000000000001','part2-customer@example.invalid','Part2 CI','pending_payment','pending',50,50,'{}');
insert into public.payments(order_id,provider,external_reference,status,amount)
values('f2100000-0000-4000-8000-000000000002','mercadopago','PART2-CANCEL-CI','pending',50);
set local role authenticated;
select ok(public.request_operational_order_cancellation('f2100000-0000-4000-8000-000000000002','Cancellation requested for CI') is not null,'Authorized staff starts the same durable cancellation flow');
reset role;
select is((select count(*) from public.background_jobs where idempotency_key='after-sale:cancel:f2100000-0000-4000-8000-000000000002'),1::bigint,'Cancellation transition schedules one recovery job');
create temporary table part2_after_claim as select public.claim_after_sale_job('f2000000-0000-4000-8000-000000000012') job;
select is((select job->>'customerId' from part2_after_claim),'f2000000-0000-4000-8000-000000000001','Worker uses the actual order owner, not the requesting staff identity');
select is(public.claim_after_sale_job('f2000000-0000-4000-8000-000000000013'),null::jsonb,'Concurrent refund worker is excluded');
select ok(not public.finish_after_sale_job((select (job->>'id')::uuid from part2_after_claim),'f2000000-0000-4000-8000-000000000013',true),'Wrong refund lease cannot finalize');
select ok(public.finish_after_sale_job((select (job->>'id')::uuid from part2_after_claim),'f2000000-0000-4000-8000-000000000012',false),'Unconfirmed refund remains pending verification');
select is((select status::text from public.background_jobs where id=(select (job->>'id')::uuid from part2_after_claim)),'pending','Failure cannot mark a refund as completed');
select * from finish();
rollback;

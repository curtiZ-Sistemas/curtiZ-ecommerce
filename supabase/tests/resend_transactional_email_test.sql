-- Run with supabase test db against an isolated, fully migrated database.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select ok(not has_function_privilege('anon','public.claim_transactional_email(uuid)','execute'),'Anonymous callers cannot trigger send jobs');
select ok(not has_function_privilege('authenticated','public.begin_transactional_email(uuid,uuid,jsonb)','execute'),'Customers cannot choose recipients');
select ok(not has_function_privilege('authenticated','public.sync_transactional_email_runtime(boolean,boolean)','execute'),'Customers cannot enable sending');
select ok(not has_function_privilege('authenticated','public.reconcile_transactional_email(uuid,text)','execute'),'Customers cannot forge provider acceptance');
select ok(not has_table_privilege('authenticated','private.transactional_emails','select'),'Email payloads remain private');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='private.transactional_emails'::regclass),'Email storage has forced RLS');

insert into auth.users(id,instance_id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('ee000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','email-test@example.invalid','{}','{"full_name":"Email test"}',now(),now());
update public.profiles set status='active' where id='ee000000-0000-4000-8000-000000000001';
insert into public.categories(id,name,slug) values('ee200000-0000-4000-8000-000000000001','Email SQL test','email-sql-test');
insert into public.products(id,name,slug,category_id,status,base_price)
values('ee200000-0000-4000-8000-000000000002','Sandália teste','email-sql-test','ee200000-0000-4000-8000-000000000001','draft',50);
-- A guarda de publicação exige imagem real concluída: o produto nasce rascunho e é publicado depois.
insert into public.product_images(product_id,storage_path,alt_text,width,height,is_primary)
select id,'test/'||slug||'.webp',name,720,720,true from public.products where id in ('ee200000-0000-4000-8000-000000000002');
update public.products set status='active' where id in ('ee200000-0000-4000-8000-000000000002');
insert into public.product_variants(id,product_id,sku,color_name,size)
values('ee200000-0000-4000-8000-000000000003','ee200000-0000-4000-8000-000000000002','EMAIL-SQL-37','Vinho','37');
insert into public.orders(id,customer_id,customer_email_snapshot,customer_name_snapshot,status,payment_status,subtotal,grand_total,shipping_address_snapshot)
values('ee100000-0000-4000-8000-000000000001','ee000000-0000-4000-8000-000000000001','email-test@example.invalid','Email test','pending_payment','pending',50,50,'{}');
insert into public.order_items(id,order_id,product_id,variant_id,product_name_snapshot,sku_snapshot,color_snapshot,size_snapshot,quantity,unit_price,total)
values('ee300000-0000-4000-8000-000000000001','ee100000-0000-4000-8000-000000000001','ee200000-0000-4000-8000-000000000002','ee200000-0000-4000-8000-000000000003','Sandália teste','EMAIL-SQL-37','Vinho','37',1,50,50);
insert into public.payments(order_id,provider,provider_payment_id,external_reference,status,amount)
values('ee100000-0000-4000-8000-000000000001','mercadopago','email-payment-test','email-payment-test','pending',50);
insert into public.orders(id,customer_id,customer_email_snapshot,customer_name_snapshot,status,payment_status,subtotal,grand_total,shipping_address_snapshot)
values('ee100000-0000-4000-8000-000000000009','ee000000-0000-4000-8000-000000000001','email-test@example.invalid','Historical order','processing','approved',50,50,'{}');
insert into public.payments(order_id,provider,provider_payment_id,external_reference,status,amount)
values('ee100000-0000-4000-8000-000000000009','mercadopago','email-historical-test','email-historical-test','approved',50);
select public.sync_transactional_email_runtime(false,false);
select is((select count(*) from private.transactional_emails),0::bigint,'Disabled runtime queues nothing');
select public.sync_transactional_email_runtime(true,true);
select is((select count(*) from private.transactional_emails),0::bigint,'Activation does not backfill existing orders');
select ok(not private.transactional_email_eligible('ee100000-0000-4000-8000-000000000001','purchase_confirmed'),'Pending payment cannot send confirmation');
update public.payments set status='approved' where external_reference='email-payment-test';
select is((select count(*) from private.transactional_emails),0::bigint,'Provider approval alone cannot send before persisted order confirmation');
update public.orders set status='processing',payment_status='approved' where id='ee100000-0000-4000-8000-000000000001';
select is((select count(*) from private.transactional_emails where kind='purchase_confirmed'),1::bigint,'Later reconciled approval enqueues once');
select ok(exists(select 1 from private.transactional_emails e join public.background_jobs j on j.id=e.job_id
  where e.kind='purchase_confirmed' and j.queue='transactional_email'
    and j.idempotency_key='resend:purchase_confirmed:ee100000-0000-4000-8000-000000000001'),
  'Confirmation references its idempotent background job');
update public.payments set status='approved' where external_reference='email-payment-test';
update public.orders set status='picking' where id='ee100000-0000-4000-8000-000000000001';
select is((select count(*) from private.transactional_emails where kind='purchase_confirmed'),1::bigint,'Repeated payment and subsequent states cannot duplicate confirmation');

create temporary table email_claim as select public.claim_transactional_email('ee000000-0000-4000-8000-000000000002') as job;
select ok((select job is not null from email_claim),'Eligible confirmation can be leased');
select is(public.claim_transactional_email('ee000000-0000-4000-8000-000000000003'),null::jsonb,'Second execution cannot acquire active lease');
select ok(not public.finish_transactional_email((select (job->>'id')::uuid from email_claim),'ee000000-0000-4000-8000-000000000003','accepted','provider-test'),'Wrong lease cannot persist receipt');
select throws_ok(format('select public.begin_transactional_email(%L,%L,%L::jsonb)',
  (select job->>'id' from email_claim),'ee000000-0000-4000-8000-000000000002','{"to":["arbitrary@example.invalid"]}'),
  'P0001','invalid_email_payload','Recipient must match order snapshot');
select ok(public.begin_transactional_email((select (job->>'id')::uuid from email_claim),'ee000000-0000-4000-8000-000000000002',
  '{"to":["email-test@example.invalid"],"subject":"stable"}') is not null,'First attempt freezes trusted payload');
select ok(public.finish_transactional_email((select (job->>'id')::uuid from email_claim),'ee000000-0000-4000-8000-000000000002','uncertain',null,'email_acceptance_uncertain'),'Uncertain result schedules safe retry');
update public.background_jobs set available_at=now() where queue='transactional_email';
update email_claim set job=public.claim_transactional_email('ee000000-0000-4000-8000-000000000002');
select is(public.begin_transactional_email((select (job->>'id')::uuid from email_claim),'ee000000-0000-4000-8000-000000000002',
  '{"to":["changed@example.invalid"],"subject":"changed"}')->'payload',
  '{"to":["email-test@example.invalid"],"subject":"stable"}'::jsonb,'Retry uses original payload, not new sender/content/recipient');
select ok(public.finish_transactional_email((select (job->>'id')::uuid from email_claim),'ee000000-0000-4000-8000-000000000002','accepted','email-provider-test'),'Acceptance receipt persisted');
select is((select state from private.transactional_emails where kind='purchase_confirmed'),'accepted','Acceptance is not falsely marked delivered');
update public.background_jobs set available_at=now() where queue='transactional_email';
update email_claim set job=public.claim_transactional_email('ee000000-0000-4000-8000-000000000002');
select ok(public.finish_transactional_email((select (job->>'id')::uuid from email_claim),'ee000000-0000-4000-8000-000000000002','observed',null,null,0,'delivered'),'Verified delivery recorded separately');

insert into public.shipments(id,order_id,provider,service,external_id,status)
values('ee400000-0000-4000-8000-000000000001','ee100000-0000-4000-8000-000000000001','melhorenvio','test','email-shipment-1','pending'),
('ee400000-0000-4000-8000-000000000002','ee100000-0000-4000-8000-000000000001','melhorenvio','test','email-shipment-2','pending');
select public.apply_melhor_envio_webhook('email-event-1','hash-1','order.delivered','email-shipment-1','delivered',now());
select is((select status::text from public.orders where id='ee100000-0000-4000-8000-000000000001'),'picking','Partial shipment delivery cannot deliver entire order');
select is((select count(*) from private.transactional_emails where kind='review_requested'),0::bigint,'Partial delivery cannot schedule review');
select public.apply_melhor_envio_webhook('email-event-2','hash-2','order.delivered','email-shipment-2','delivered',now());
select is((select status::text from public.orders where id='ee100000-0000-4000-8000-000000000001'),'delivered','Final delivery makes existing review feature available');
select is((select count(*) from private.transactional_emails where kind='review_requested'),1::bigint,'Full delivery schedules one review');
select ok((select due_at=event_at+interval '24 hours' from private.transactional_emails where kind='review_requested'),'Review is due 24h after confirmed complete delivery');
select is(public.claim_transactional_email('ee000000-0000-4000-8000-000000000002'),null::jsonb,'Review cannot execute before 24h');
select public.apply_melhor_envio_webhook('email-event-2','hash-2','order.delivered','email-shipment-2','delivered',now());
select public.apply_melhor_envio_webhook('email-event-old','hash-old','order.posted','email-shipment-2','dispatched',now()-interval '2 days');
select is((select status::text from public.shipments where id='ee400000-0000-4000-8000-000000000002'),'delivered','Out-of-order webhook cannot regress delivered shipment');
select is((select count(*) from private.transactional_emails where kind='review_requested'),1::bigint,'Duplicate/out-of-order events cannot reschedule review');
update private.transactional_emails set event_at=now()-interval '25 hours',due_at=now()-interval '1 hour' where kind='review_requested';
update public.background_jobs set available_at=now()-interval '1 hour' where job_type='resend.review_requested';
update email_claim set job=public.claim_transactional_email('ee000000-0000-4000-8000-000000000002');
select is((select job->>'kind' from email_claim),'review_requested','Review can execute after due time');
select ok(public.begin_transactional_email((select (job->>'id')::uuid from email_claim),'ee000000-0000-4000-8000-000000000002',
  '{"to":["email-test@example.invalid"],"subject":"review"}') is not null,'Delivered eligible review starts');
-- Recover a task that was interrupted before saving a receipt.
update public.background_jobs set locked_at=now()-interval '6 minutes' where job_type='resend.review_requested';
select ok(public.claim_transactional_email('ee000000-0000-4000-8000-000000000003') is not null,'Expired lease can be recovered inside idempotency window');
select is((select count(*) from private.transactional_email_attempts where outcome='interrupted'),1::bigint,'Interrupted attempt is audited');
update private.transactional_emails set first_attempt_at=now()-interval '24 hours' where kind='review_requested';
select is(public.claim_transactional_email('ee000000-0000-4000-8000-000000000002'),null::jsonb,'Expired uncertain request cannot be resent');
select is((select state from private.transactional_emails where kind='review_requested'),'reconciliation_required','Uncertain old result awaits safe reconciliation');
select ok(public.reconcile_transactional_email((select id from private.transactional_emails where kind='review_requested'),'reconciled-provider-test'),'Verified receipt can be attached without new send');
select is((select provider_id from private.transactional_emails where kind='review_requested'),'reconciled-provider-test','Reconciliation persists provider identifier');
update email_claim set job=public.claim_transactional_email('ee000000-0000-4000-8000-000000000002');
select ok(public.finish_transactional_email((select (job->>'id')::uuid from email_claim),
  'ee000000-0000-4000-8000-000000000002','observed',null,'email_delivery_failed',0,'suppressed'),
  'Provider suppression can be recorded without sending again');
select is((select state from private.transactional_emails where kind='review_requested'),'suppressed','Suppression is distinct from acceptance and delivery');
select is((select status::text from public.background_jobs where job_type='resend.review_requested'),'failed','Suppression stops automatic status polling');

insert into public.reviews(product_id,customer_id,order_item_id,rating,status,content)
values('ee200000-0000-4000-8000-000000000002','ee000000-0000-4000-8000-000000000001','ee300000-0000-4000-8000-000000000001',5,'pending','Produto recebido');
select ok(not private.transactional_email_eligible('ee100000-0000-4000-8000-000000000001','review_requested'),'Even pending moderation counts as already submitted');
update public.orders set status='refunded',payment_status='refunded' where id='ee100000-0000-4000-8000-000000000001';
select ok(not private.transactional_email_eligible('ee100000-0000-4000-8000-000000000001','purchase_confirmed'),'Refund prohibits pending confirmation');
select ok(not private.transactional_email_eligible('ee100000-0000-4000-8000-000000000001','review_requested'),'Refund prohibits pending review');

-- A second delivered order is reviewed while its 24h task is still pending.
insert into public.orders(id,customer_id,customer_email_snapshot,customer_name_snapshot,status,payment_status,subtotal,grand_total,shipping_address_snapshot)
values('ee100000-0000-4000-8000-000000000008','ee000000-0000-4000-8000-000000000001','email-test@example.invalid','Reviewed order','processing','approved',50,50,'{}');
insert into public.order_items(id,order_id,product_id,variant_id,product_name_snapshot,sku_snapshot,color_snapshot,size_snapshot,quantity,unit_price,total)
values('ee300000-0000-4000-8000-000000000008','ee100000-0000-4000-8000-000000000008','ee200000-0000-4000-8000-000000000002','ee200000-0000-4000-8000-000000000003','Sandália teste','EMAIL-SQL-37','Vinho','37',1,50,50);
insert into public.payments(order_id,provider,provider_payment_id,external_reference,status,amount)
values('ee100000-0000-4000-8000-000000000008','mercadopago','email-reviewed-test','email-reviewed-test','approved',50);
update public.orders set status='delivered' where id='ee100000-0000-4000-8000-000000000008';
insert into public.reviews(product_id,customer_id,order_item_id,rating,status,content)
values('ee200000-0000-4000-8000-000000000002','ee000000-0000-4000-8000-000000000001','ee300000-0000-4000-8000-000000000008',5,'pending','Recebido');
update public.background_jobs set status='completed' where queue='transactional_email' and job_type='resend.purchase_confirmed';
update private.transactional_emails set due_at=now()-interval '1 hour' where order_id='ee100000-0000-4000-8000-000000000008' and kind='review_requested';
update public.background_jobs j set available_at=now()-interval '2 hours' from private.transactional_emails m
  where m.job_id=j.id and m.order_id='ee100000-0000-4000-8000-000000000008' and m.kind='review_requested';
select is(public.claim_transactional_email('ee000000-0000-4000-8000-000000000002')->>'skipped','true','Already reviewed pending task is skipped');
select is((select state from private.transactional_emails where order_id='ee100000-0000-4000-8000-000000000008' and kind='review_requested'),'cancelled','All reviewed products cancel the pending request');
select public.sync_transactional_email_runtime(false,false);
select is(public.claim_transactional_email('ee000000-0000-4000-8000-000000000002'),null::jsonb,'Disabled runtime cannot claim tasks');
select * from finish();
rollback;

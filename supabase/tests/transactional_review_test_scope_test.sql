-- Isolated fixtures only; all writes are rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select public.sync_transactional_email_runtime(false,false);
select ok(not has_function_privilege('authenticated','public.configure_transactional_review_test_scope(uuid,uuid,timestamptz,uuid)','execute'),'Customers cannot configure the review TEST scope');
select ok(not has_function_privilege('anon','public.configure_transactional_review_test_scope(uuid,uuid,timestamptz,uuid)','execute'),'Anonymous callers cannot configure the review TEST scope');
select ok(not has_table_privilege('authenticated','private.transactional_review_test_orders','select'),'TEST markers remain private');

insert into auth.users(id,instance_id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('ef000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','review-fixture@example.invalid','{}','{"full_name":"Review fixture"}',now(),now());
update public.profiles set status='active' where id='ef000000-0000-4000-8000-000000000001';
insert into public.categories(id,name,slug) values('ef200000-0000-4000-8000-000000000001','Review fixture','review-fixture');
insert into public.products(id,name,slug,category_id,status,base_price)
values('ef200000-0000-4000-8000-000000000002','Review fixture','review-fixture','ef200000-0000-4000-8000-000000000001','draft',50);
insert into public.product_images(product_id,storage_path,alt_text,width,height,is_primary)
values('ef200000-0000-4000-8000-000000000002','test/review-fixture.webp','Review fixture',720,720,true);
update public.products set status='active' where id='ef200000-0000-4000-8000-000000000002';
insert into public.product_variants(id,product_id,sku,color_name,size)
values('ef200000-0000-4000-8000-000000000003','ef200000-0000-4000-8000-000000000002','REVIEW-FIXTURE-37','Test','37');
insert into public.orders(id,customer_id,customer_email_snapshot,customer_name_snapshot,status,payment_status,subtotal,grand_total,shipping_address_snapshot,commercial_rules_snapshot,created_at)
values('58c273d0-f41e-4188-9c8c-3805b8a305aa','ef000000-0000-4000-8000-000000000001','sistemas.curtiz@gmail.com','TEST','processing','approved',50,50,'{}','{"paymentMode":"test"}',now()-interval '2 days');
insert into public.order_items(id,order_id,product_id,variant_id,product_name_snapshot,sku_snapshot,color_snapshot,size_snapshot,quantity,unit_price,total)
values('ef300000-0000-4000-8000-000000000001','58c273d0-f41e-4188-9c8c-3805b8a305aa','ef200000-0000-4000-8000-000000000002','ef200000-0000-4000-8000-000000000003','Fixture','REVIEW-FIXTURE-37','Test','37',1,50,50);
insert into public.idempotency_keys(key,scope,resource_id,expires_at)
values('ef900000-0000-4000-8000-000000000001','mercadopago.checkout.test','58c273d0-f41e-4188-9c8c-3805b8a305aa',now()+interval '1 day');
insert into public.payments(order_id,provider,provider_payment_id,external_reference,status,amount)
values('58c273d0-f41e-4188-9c8c-3805b8a305aa','mercadopago','review-fixture-payment','review-fixture-payment','approved',50);
insert into public.shipments(id,order_id,provider,service,external_id,status)
values('ef400000-0000-4000-8000-000000000001','58c273d0-f41e-4188-9c8c-3805b8a305aa','melhorenvio','test','review-fixture-shipment','pending');
select public.apply_melhor_envio_webhook('review-fixture-event','review-fixture-hash','order.delivered','review-fixture-shipment','delivered',now()-interval '23 hours');
select is((select count(*) from private.transactional_emails where order_id='58c273d0-f41e-4188-9c8c-3805b8a305aa'),0::bigint,'Disabled runtime has not queued an email');
select throws_ok($q$select public.configure_transactional_review_test_scope('ef000000-0000-4000-8000-000000000001','ef900000-0000-4000-8000-000000000001',now(),'58c273d0-f41e-4188-9c8c-3805b8a305aa')$q$,'23514','review_test_scope_invalid','Less than 24 hours is rejected');
-- Replace the isolated shipment fixture to exercise a second, older delivery without
-- bypassing the trigger that protects real delivery timestamps.
delete from public.tracking_events where shipment_id='ef400000-0000-4000-8000-000000000001';
delete from public.shipments where id='ef400000-0000-4000-8000-000000000001';
insert into public.shipments(id,order_id,provider,service,external_id,status)
values('ef400000-0000-4000-8000-000000000001','58c273d0-f41e-4188-9c8c-3805b8a305aa','melhorenvio','test','review-fixture-shipment-old','pending');
select public.apply_melhor_envio_webhook('review-fixture-event-old','review-fixture-hash-old','order.delivered','review-fixture-shipment-old','delivered',now()-interval '25 hours');
update public.orders set customer_email_snapshot='original@example.invalid' where id='58c273d0-f41e-4188-9c8c-3805b8a305aa';
select throws_ok($q$select public.configure_transactional_review_test_scope('ef000000-0000-4000-8000-000000000001','ef900000-0000-4000-8000-000000000001',now(),'ef100000-0000-4000-8000-000000000009')$q$,'23514','review_test_scope_invalid','Other orders are rejected');
update public.orders set commercial_rules_snapshot='{"paymentMode":"production"}' where id='58c273d0-f41e-4188-9c8c-3805b8a305aa';
select throws_ok($q$select public.configure_transactional_review_test_scope('ef000000-0000-4000-8000-000000000001','ef900000-0000-4000-8000-000000000001',now(),'58c273d0-f41e-4188-9c8c-3805b8a305aa')$q$,'23514','review_test_scope_invalid','Production orders are rejected');
update public.orders set commercial_rules_snapshot='{"paymentMode":"test"}' where id='58c273d0-f41e-4188-9c8c-3805b8a305aa';
select throws_ok($q$select public.configure_transactional_review_test_scope('ef000000-0000-4000-8000-000000000001','ef900000-0000-4000-8000-000000000001',now()-interval '15 minutes','58c273d0-f41e-4188-9c8c-3805b8a305aa')$q$,'23514','review_test_scope_invalid','Expired windows cannot be opened');
select throws_ok($q$select public.configure_transactional_review_test_scope('ef000000-0000-4000-8000-000000000001','ef900000-0000-4000-8000-000000000009',now(),'58c273d0-f41e-4188-9c8c-3805b8a305aa')$q$,'23514','review_test_scope_invalid','Other checkout keys are rejected');
delete from public.tracking_events where shipment_id='ef400000-0000-4000-8000-000000000001';
select throws_ok($q$select public.configure_transactional_review_test_scope('ef000000-0000-4000-8000-000000000001','ef900000-0000-4000-8000-000000000001',now(),'58c273d0-f41e-4188-9c8c-3805b8a305aa')$q$,'23514','review_test_scope_invalid','A delivery without a carrier event is rejected');
insert into public.tracking_events(shipment_id,provider_event_id,status,description,occurred_at)
values('ef400000-0000-4000-8000-000000000001','review-fixture-recreated','delivered','Isolated fixture',now()-interval '25 hours');
select ok(public.configure_transactional_review_test_scope('ef000000-0000-4000-8000-000000000001','ef900000-0000-4000-8000-000000000001',now(),'58c273d0-f41e-4188-9c8c-3805b8a305aa'),'Eligible TEST order may open a restricted window');
select ok(public.configure_transactional_review_test_scope('ef000000-0000-4000-8000-000000000001','ef900000-0000-4000-8000-000000000001',now(),'58c273d0-f41e-4188-9c8c-3805b8a305aa'),'Repeated configuration is idempotent');
select is((select count(*) from private.transactional_emails where order_id='58c273d0-f41e-4188-9c8c-3805b8a305aa' and kind='review_requested'),1::bigint,'Exactly one review message');
select is((select count(*) from public.background_jobs where idempotency_key='resend:review_requested:58c273d0-f41e-4188-9c8c-3805b8a305aa'),1::bigint,'Exactly one review job');
select ok((select due_at=event_at+interval '24 hours' and due_at<=now() from private.transactional_emails where order_id='58c273d0-f41e-4188-9c8c-3805b8a305aa' and kind='review_requested'),'Due time reflects the real recorded delivery plus 24 hours');
select ok(not (select enabled from private.transactional_email_runtime),'Commercial email remains disabled');
select private.enqueue_transactional_email('58c273d0-f41e-4188-9c8c-3805b8a305aa','purchase_confirmed');
select is((select count(*) from private.transactional_emails where order_id='58c273d0-f41e-4188-9c8c-3805b8a305aa' and kind='purchase_confirmed'),0::bigint,'Review-only scope cannot enqueue a purchase message');
select is(public.claim_test_transactional_email('ef000000-0000-4000-8000-000000000002','ef900000-0000-4000-8000-000000000009'),null::jsonb,'Wrong key cannot claim');
create temporary table review_scope_claim as select public.claim_test_transactional_email('ef000000-0000-4000-8000-000000000002','ef900000-0000-4000-8000-000000000001') as job;
select is((select job->>'kind' from review_scope_claim),'review_requested','Only the review is claimed');
select ok(public.read_transactional_email_source((select (job->>'id')::uuid from review_scope_claim),'ef000000-0000-4000-8000-000000000002') is not null,'Eligible source is available within the window');
select throws_ok($q$select public.begin_transactional_email((select (job->>'id')::uuid from review_scope_claim),'ef000000-0000-4000-8000-000000000002','{"to":["other@example.invalid"]}')$q$,'P0001','invalid_email_payload','Payload cannot redirect the recipient');
select throws_ok($q$select public.begin_transactional_email((select (job->>'id')::uuid from review_scope_claim),'ef000000-0000-4000-8000-000000000002','{"to":["original@example.invalid"]}')$q$,'P0001','invalid_email_payload','The original order recipient cannot receive this TEST message');
select ok(public.begin_transactional_email((select (job->>'id')::uuid from review_scope_claim),'ef000000-0000-4000-8000-000000000002','{"to":["sistemas.curtiz@gmail.com"],"subject":"TEST"}') is not null,'Allowed recipient can start the scoped send');
select is((select customer_email_snapshot::text from public.orders where id='58c273d0-f41e-4188-9c8c-3805b8a305aa'),'original@example.invalid','Test does not change the order recipient');
update private.transactional_email_test_scope set started_at=now()-interval '16 minutes',expires_at=now()-interval '1 minute';
select is(public.read_transactional_email_source((select (job->>'id')::uuid from review_scope_claim),'ef000000-0000-4000-8000-000000000002'),null::jsonb,'Expired scope cannot read the source');
select is(public.begin_transactional_email((select (job->>'id')::uuid from review_scope_claim),'ef000000-0000-4000-8000-000000000002','{}'),null::jsonb,'Expired scope cannot begin a send');
select ok(public.configure_transactional_email_test_scope(null,null,null),'Cleanup closes the test window');
select ok(not private.transactional_email_allowed('58c273d0-f41e-4188-9c8c-3805b8a305aa'),'Expired scope blocks the TEST order');
select public.sync_transactional_email_runtime(true,true);
select ok(not private.transactional_email_allowed('58c273d0-f41e-4188-9c8c-3805b8a305aa'),'Later commercial activation cannot replay the TEST message');
select is(public.claim_transactional_email('ef000000-0000-4000-8000-000000000003'),null::jsonb,'Commercial claim cannot acquire the TEST message');
select * from finish(true);
rollback;

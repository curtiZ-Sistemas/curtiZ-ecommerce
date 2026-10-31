begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,instance_id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
('de000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','returns-owner@example.invalid','{}','{"full_name":"Returns owner"}',now(),now()),
('de000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','returns-other@example.invalid','{}','{"full_name":"Returns other"}',now(),now()),
('de000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','returns-admin@example.invalid','{}','{"full_name":"Returns admin"}',now(),now());
update public.profiles set status='active' where id::text like 'de000000-%';
insert into public.user_roles(user_id,role) values('de000000-0000-4000-8000-000000000003','admin') on conflict do nothing;
insert into public.categories(id,name,slug) values('de100000-0000-4000-8000-000000000001','Return test','return-workflow-test');
insert into public.products(id,name,slug,category_id,status,base_price,description,weight_grams,height_cm,width_cm,length_cm)
values('de100000-0000-4000-8000-000000000002','Return test','return-workflow-test','de100000-0000-4000-8000-000000000001','draft',30,'Test',100,5,10,20);
insert into public.product_variants(id,product_id,sku,color_name,size)
values('de100000-0000-4000-8000-000000000003','de100000-0000-4000-8000-000000000002','RETURN-WORKFLOW-TEST','Black','37');
insert into public.orders(id,customer_id,customer_email_snapshot,customer_name_snapshot,status,payment_status,subtotal,shipping_total,grand_total,shipping_address_snapshot)
values('de200000-0000-4000-8000-000000000001','de000000-0000-4000-8000-000000000001','returns-owner@example.invalid','Test','delivered','approved',90,11.01,101.01,'{}');
insert into public.order_items(id,order_id,product_id,variant_id,product_name_snapshot,sku_snapshot,color_snapshot,size_snapshot,quantity,unit_price,total)
values('de300000-0000-4000-8000-000000000001','de200000-0000-4000-8000-000000000001','de100000-0000-4000-8000-000000000002','de100000-0000-4000-8000-000000000003','Test','RETURN-WORKFLOW-TEST','Black','37',3,30,90);
insert into public.payments(order_id,provider,provider_payment_id,external_reference,status,amount)
values('de200000-0000-4000-8000-000000000001','mercadopago','TEST-RETURN-PAYMENT','TEST-RETURN-ORDER','approved',101.01);
insert into public.shipments(order_id,provider,service,status,delivered_at)
values('de200000-0000-4000-8000-000000000001','test','test','delivered',now()-interval '1 day');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"de000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',true);
select lives_ok($$select public.request_customer_return_v2('de300000-0000-4000-8000-000000000001',1,'','','refund','withdrawal')$$,'Withdrawal accepts no justification or photos');
select is((select status::text from public.orders where id='de200000-0000-4000-8000-000000000001'),'delivered','Return does not overwrite delivery of remaining items');
select lives_ok($$select public.request_customer_return_v2('de300000-0000-4000-8000-000000000001',2,'','','refund','withdrawal')$$,'Remaining units can have a separate request');
select throws_ok($$select public.request_customer_return_v2('de300000-0000-4000-8000-000000000001',1,'','','refund','withdrawal')$$,'23514','return_quantity_unavailable','Cannot return more than purchased, including open requests');
select throws_ok($$select public.review_customer_return((select id from public.returns where customer_id=auth.uid() limit 1),'approve','Customer tries approval')$$,'42501','permission denied','Customer cannot approve their own return');
select ok(not has_function_privilege('authenticated','public.claim_return_job(text,uuid)','execute'),'Customer cannot claim financial work');
select ok(not has_function_privilege('authenticated','public.finish_return_job(uuid,uuid,text,text,text)','execute'),'Customer cannot confirm refund');

reset role;
create temporary table return_test_cases as select r.id,ri.quantity from public.returns r join public.return_items ri on ri.return_id=r.id where r.order_id='de200000-0000-4000-8000-000000000001';
insert into storage.objects(bucket_id,name,metadata)
select 'return-evidence','de000000-0000-4000-8000-000000000001/'||r.id||'/'||n||'.webp','{"mimetype":"image/webp","size":100}'::jsonb
from return_test_cases r cross join generate_series(1,4) n where quantity=1;
grant select on return_test_cases to authenticated;
set local role authenticated;
select lives_ok(format('select public.attach_customer_return_photo(%L,%L)',id,'de000000-0000-4000-8000-000000000001/'||id||'/1.webp'),'Photo 1 accepted') from return_test_cases where quantity=1;
select lives_ok(format('select public.attach_customer_return_photo(%L,%L)',id,'de000000-0000-4000-8000-000000000001/'||id||'/2.webp'),'Photo 2 accepted') from return_test_cases where quantity=1;
select lives_ok(format('select public.attach_customer_return_photo(%L,%L)',id,'de000000-0000-4000-8000-000000000001/'||id||'/3.webp'),'Photo 3 accepted') from return_test_cases where quantity=1;
select throws_ok(format('select public.attach_customer_return_photo(%L,%L)',id,'de000000-0000-4000-8000-000000000001/'||id||'/4.webp'),'23514','return_photo_limit','Fourth photo rejected by serialized database authority') from return_test_cases where quantity=1;
select set_config('request.jwt.claims','{"sub":"de000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}',true);
select is((select count(*) from public.return_media),0::bigint,'Other customer cannot read photos');
select is((select count(*) from public.return_history),0::bigint,'Other customer cannot read return history');
select is((select count(*) from storage.objects where bucket_id='return-evidence'),0::bigint,'Other customer cannot sign or read stored evidence');
select throws_ok($$select public.request_customer_return_v2('de300000-0000-4000-8000-000000000001',1,'','','refund','withdrawal')$$,'P0002','delivered_item_not_found','Other customer cannot return the item');

select set_config('request.jwt.claims','{"sub":"de000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2","app_metadata":{"role":"admin"}}',true);
select throws_ok(format('select public.review_customer_return(%L,%L,%L)',id,'reject','Rejected without justification'),'23514','withdrawal_cannot_be_blocked','Timely withdrawal cannot be rejected as preference') from return_test_cases where quantity=1;
select throws_ok(format('select public.review_customer_return(%L,%L,%L)',id,'photos','Demand photos first'),'23514','withdrawal_cannot_be_blocked','Photos cannot block timely withdrawal') from return_test_cases where quantity=1;
select lives_ok(format('select public.review_customer_return(%L,%L,%L)',id,'approve','Return authorized without photos'),'Human review authorizes return') from return_test_cases;
select throws_ok(format('select public.review_customer_return(%L,%L,%L)',id,'posting','Post the product please'),'23514','posting_instructions_required','Posting requires code and instructions') from return_test_cases where quantity=1;
select lives_ok(format('select public.review_customer_return(%L,%L,%L,%L,%L)',id,'posting','Use the prepaid return service','Pack the product and use the designated postal counter. Valid for 15 days.','TEST-POSTAGE'),'Prepaid posting instructions recorded') from return_test_cases where quantity=1;
select lives_ok(format('select public.review_customer_return(%L,%L,%L)',id,'refund','Refund authorized to original payment'),'Refund authorization can proceed without delaying withdrawal for inspection') from return_test_cases;

reset role;
-- Prioritize only the rolled-back fixture jobs; no real external processing occurs.
update private.return_jobs set due_at=now()-interval '1 hour' where return_id in(select id from return_test_cases) and kind='refund';
create temporary table return_claim as select public.claim_return_job('refund','de400000-0000-4000-8000-000000000001') payload;
select ok((select (payload->>'amountInCents')::integer in (3367,6734) from return_claim),'Server allocates price and original shipping without rounding loss');
select is(public.claim_return_job('refund','de400000-0000-4000-8000-000000000002'),null::jsonb,'Same order cannot have concurrent refund writes');
select throws_ok(format('select public.finish_return_job(%L,%L,%L)',payload->>'id','de400000-0000-4000-8000-000000000001','completed'),'P0001','provider_confirmation_required','No completed refund without provider receipt') from return_claim;
select is(public.finish_return_job((payload->>'id')::uuid,'de400000-0000-4000-8000-000000000001','review','TEST-REFUND-FIRST','receipt_not_saved'),true,'Uncertain write is held for reconciliation') from return_claim;
select is((select count(*) from public.returns where order_id='de200000-0000-4000-8000-000000000001' and status='refunded'),0::bigint,'Uncertain write is not shown as refunded');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"de000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',true);
select throws_ok(format('select public.request_return_refund_reconciliation(%L,%L,%L)',id,'TEST-REFUND-FIRST','Customer attempts reconciliation'),'42501','permission denied','Customer cannot reconcile their own refund') from return_test_cases;
select set_config('request.jwt.claims','{"sub":"de000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}',true);
select lives_ok(format('select public.request_return_refund_reconciliation(%L,%L,%L)',r.id,'TEST-REFUND-FIRST','Checking existing provider receipt'),'Authorized reconciliation uses existing receipt')
  from public.returns r where r.order_id='de200000-0000-4000-8000-000000000001' and r.refund_error is not null;
reset role;
delete from return_claim;
insert into return_claim select public.claim_return_job('refund','de400000-0000-4000-8000-000000000004');
select is((select payload->>'providerId' from return_claim),'TEST-REFUND-FIRST','Reconciliation claim carries the specific receipt');
select is(public.finish_return_job((payload->>'id')::uuid,'de400000-0000-4000-8000-000000000004','completed','TEST-REFUND-FIRST'),true,'Verified receipt completes refund') from return_claim;
select is(public.finish_return_job((payload->>'id')::uuid,'de400000-0000-4000-8000-000000000004','completed','TEST-REFUND-FIRST'),false,'Same lease cannot finalize twice') from return_claim;
delete from return_claim;
insert into return_claim select public.claim_return_job('refund','de400000-0000-4000-8000-000000000003');
select is(public.finish_return_job((payload->>'id')::uuid,'de400000-0000-4000-8000-000000000003','completed','TEST-REFUND-SECOND'),true,'Second partial refund completes') from return_claim;
select is((select sum(refund_amount) from public.returns where order_id='de200000-0000-4000-8000-000000000001'),101.01::numeric,'All quantities refund exactly the full paid amount including freight');
select is((select count(*) from public.return_history where return_id in(select id from return_test_cases) and status='refunded'),2::bigint,'Confirmed refunds have customer-visible history');
select is(private.return_withdrawal_within_period('2026-10-01T10:00:00-03:00','2026-10-08T23:59:59-03:00'),true,'Withdrawal deadline includes the full seventh calendar day');
select is(private.return_withdrawal_within_period('2026-10-01T10:00:00-03:00','2026-10-09T00:00:00-03:00'),false,'Following calendar day is outside the automatic withdrawal window');
select * from finish();
rollback;

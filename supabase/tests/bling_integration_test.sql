-- Run against an isolated migrated database with `supabase test db`.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select ok(not has_function_privilege('anon','public.accept_bling_webhook(text,text,text,text,jsonb,text)','execute'),'Anonymous callers cannot persist Bling events');
select ok(not has_function_privilege('authenticated','public.read_bling_order_link(uuid)','execute'),'Private order mapping cannot be read by clients');
select ok(not has_function_privilege('authenticated','public.save_bling_connection(text,text,text,timestamptz,timestamptz)','execute'),'Clients cannot overwrite OAuth tokens');
select ok(not has_table_privilege('authenticated','private.bling_webhook_events','select'),'Raw webhook bodies are private');
select ok(not has_table_privilege('anon','private.bling_product_links','select'),'Public catalogue does not expose ERP links');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='private.bling_order_links'::regclass),'Private order mapping has forced RLS');

insert into auth.users(id,instance_id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('ba000000-0000-4000-8000-000000000010','00000000-0000-0000-0000-000000000000','authenticated','authenticated','bling-test@example.invalid','{}','{"full_name":"Bling test"}',now(),now());
update public.profiles set status='active' where id='ba000000-0000-4000-8000-000000000010';
insert into public.orders(id,customer_id,customer_email_snapshot,customer_name_snapshot,status,payment_status,subtotal,grand_total,shipping_address_snapshot)
values('ba100000-0000-4000-8000-000000000010','ba000000-0000-4000-8000-000000000010','bling-test@example.invalid','Bling test','processing','approved',100,100,'{}'),
('ba100000-0000-4000-8000-000000000011','ba000000-0000-4000-8000-000000000010','bling-test@example.invalid','Bling test','pending_payment','pending',100,100,'{}');
insert into public.payments(order_id,provider,provider_payment_id,external_reference,status,amount)
values('ba100000-0000-4000-8000-000000000010','mercadopago','bling-paid-test','bling-paid-test','approved',100),
('ba100000-0000-4000-8000-000000000011','mercadopago','bling-pending-test','bling-pending-test','pending',100);
select is((select count(*) from private.bling_order_links where order_id='ba100000-0000-4000-8000-000000000010'),1::bigint,'Approved MP payment enqueues ERP');
select is((select count(*) from private.bling_order_links where order_id='ba100000-0000-4000-8000-000000000011'),0::bigint,'Pending payment never enqueues paid ERP sale');
select ok(public.assert_bling_order_writable('ba100000-0000-4000-8000-000000000010'),'Paid provider-confirmed order is eligible');
select ok(not public.assert_bling_order_writable('ba100000-0000-4000-8000-000000000011'),'Pending order is ineligible');
select ok(public.save_bling_order_link('ba100000-0000-4000-8000-000000000010',991001,null),'Save external order reference');
select ok(public.observe_bling_invoice(991002,(select public_code from public.orders where id='ba100000-0000-4000-8000-000000000010'),5,'123',repeat('1',44),now()),'Authorized invoice recorded');
select ok(public.observe_bling_invoice(991002,(select public_code from public.orders where id='ba100000-0000-4000-8000-000000000010'),4,'','',now()-interval '1 minute'),'Older response acknowledged');
select is((select invoice_status from private.bling_order_links where order_id='ba100000-0000-4000-8000-000000000010'),'authorized','Older rejection cannot overwrite current authorization');
update public.background_jobs set status='failed',error_summary='uncertain_write',attempts=1
  where idempotency_key='bling:create-order:ba100000-0000-4000-8000-000000000010';
select ok(public.confirm_bling_order_reconciliation('ba100000-0000-4000-8000-000000000010'),'Verified external sale can clear reconciliation failures');
select ok(not has_function_privilege('authenticated','public.confirm_bling_order_reconciliation(uuid)','execute'),'Clients cannot declare external reconciliation confirmed');
select public.set_bling_shipping_policy(true);
select throws_ok($$update public.orders set status='shipped' where id='ba100000-0000-4000-8000-000000000011'$$,'23514',null,'Unpaid order cannot bypass fiscal shipping gate');
update public.orders set status='cancellation_requested' where id='ba100000-0000-4000-8000-000000000010';
select ok(not public.confirm_bling_order_reconciliation('ba100000-0000-4000-8000-000000000010'),'Reconciliation cannot restore a cancelled or refunding sale');
select is((select erp_status from private.bling_order_links where order_id='ba100000-0000-4000-8000-000000000010'),'reconciliation_required','Cancellation creates ERP reconciliation, not fiscal cancellation');
select is((select invoice_status from private.bling_order_links where order_id='ba100000-0000-4000-8000-000000000010'),'authorized','Local cancellation does not silently cancel the fiscal invoice');

insert into public.categories(id,name,slug) values('ba200000-0000-4000-8000-000000000001','Bling SQL test','bling-sql-test');
insert into public.products(id,name,slug,category_id,status,base_price,description,weight_grams,height_cm,width_cm,length_cm)
values('ba200000-0000-4000-8000-000000000002','Bling SQL test','bling-sql-test','ba200000-0000-4000-8000-000000000001','active',50,'Test',100,5,10,20);
insert into public.product_variants(id,product_id,sku,color_name,size)
values('ba200000-0000-4000-8000-000000000003','ba200000-0000-4000-8000-000000000002','BLING-SQL-TEST-37','Black','37');
insert into public.inventory(variant_id,available_quantity,reserved_quantity) values('ba200000-0000-4000-8000-000000000003',8,0);
select is(public.match_bling_products('[{"sku":"BLING-SQL-TEST-37","externalProductId":992001}]'),1,'SKU maps to existing external product');
select is(public.match_bling_products('[{"sku":"BLING-SQL-TEST-37","externalProductId":992001}]'),1,'Reconfirming a mapping is idempotent');
select throws_ok($$select public.match_bling_products('[{"sku":"BLING-SQL-TEST-37","externalProductId":992002}]')$$,'P0001','sku_link_conflict','Cannot overwrite external product binding');
select throws_ok($$select public.match_bling_products('[{"sku":"MISSING-SKU","externalProductId":992003}]')$$,'P0001','sku_missing','Missing SKU never matches by title');
select ok(public.mark_bling_stock_synced('ba200000-0000-4000-8000-000000000003',1,8),'Initial physical balance is recorded');
update public.inventory set available_quantity=6,reserved_quantity=2,version=version+1 where variant_id='ba200000-0000-4000-8000-000000000003';
select is((select count(*) from public.background_jobs where idempotency_key like 'bling:stock:ba200000-0000-4000-8000-000000000003:%'),0::bigint,'Reservation is not another physical stock decrement');
select is((select local_version from private.bling_product_links where variant_id='ba200000-0000-4000-8000-000000000003'),
  (select version from public.inventory where variant_id='ba200000-0000-4000-8000-000000000003'),'Pure reservation advances metadata without another remote write');
update public.inventory set reserved_quantity=1,version=version+1 where variant_id='ba200000-0000-4000-8000-000000000003';
select is((select count(*) from public.background_jobs where idempotency_key like 'bling:stock:ba200000-0000-4000-8000-000000000003:%'),1::bigint,'Physical decrement enqueues one stock job');
select ok(not public.mark_bling_stock_synced('ba200000-0000-4000-8000-000000000003',1,8),'Old physical balance cannot overwrite current inventory metadata');

select is(public.accept_bling_webhook('sql-test-event','unknown.future_action','sql-test-company',null,'{}','test-hash'),'accepted','Unknown authenticated event is retained');
select is(public.accept_bling_webhook('sql-test-event','unknown.future_action','sql-test-company',null,'{}','test-hash'),'duplicate','Duplicate is acknowledged');
select is(public.accept_bling_webhook('sql-test-event','unknown.future_action','sql-test-company',null,'{}','different-hash'),'conflict','Reused ID with another body conflicts');
select is((select count(*) from public.background_jobs where idempotency_key='bling:webhook:sql-test-event'),1::bigint,'Exactly one job per event');

create temporary table bling_test_claim as select public.claim_bling_job('ba000000-0000-4000-8000-000000000001',false,false,false,false,false,false,false) as job;
select ok((select job is not null from bling_test_claim),'Webhooks can be processed with commercial flags disabled');
select is(public.claim_bling_job('ba000000-0000-4000-8000-000000000002',true,true,true,true,true,true,true),null::jsonb,'A running lease excludes concurrent ERP workers');
select ok(not public.finish_bling_job((select (job->>'id')::uuid from bling_test_claim),'ba000000-0000-4000-8000-000000000002','completed',null),'Wrong lease cannot complete a job');
select ok(public.finish_bling_job((select (job->>'id')::uuid from bling_test_claim),'ba000000-0000-4000-8000-000000000001','completed',null),'Owner completes its job');
select is((select count(*) from private.bling_job_history where job_id=(select (job->>'id')::uuid from bling_test_claim)),1::bigint,'History is persisted with completion');

select is(public.claim_bling_request_slot('sandbox',false),0,'First request receives a slot');
select ok(public.claim_bling_request_slot('sandbox',false)>0,'Immediate request is delayed');
select public.save_bling_account('sandbox','sql-test-company','SQL test company');
select throws_ok($$select public.save_bling_account('sandbox','another-company','Other company')$$,'P0001','company_mismatch','Cannot remap existing external IDs to another company');

select pg_catalog.set_config('request.jwt.claims','{"role":"authenticated","sub":"ba000000-0000-4000-8000-000000000099"}',true);
set local role authenticated;
select throws_ok($$select public.list_bling_order_issues('all',50)$$,'42501','permission_denied','Inactive/unprivileged user cannot read ERP orders');
select throws_ok($$select public.retry_bling_catalog_sync('ba000000-0000-4000-8000-000000000099')$$,'42501','permission_denied','Catalogue retry requires permission');
select throws_ok($$select public.read_my_bling_invoice_document('ba000000-0000-4000-8000-000000000099')$$,'42501','permission_denied','Inactive customer cannot download a document');
reset role;
select pg_catalog.set_config('request.jwt.claims','{"role":"authenticated","sub":"ba000000-0000-4000-8000-000000000010"}',true);
set local role authenticated;
select is(public.read_my_bling_invoice_document('ba100000-0000-4000-8000-000000000011'),null::jsonb,'Unissued invoice is not visible');
select ok(public.read_my_bling_invoice_document('ba100000-0000-4000-8000-000000000010') is not null,'Owner can read its authorized document reference');
reset role;

select * from finish();
rollback;

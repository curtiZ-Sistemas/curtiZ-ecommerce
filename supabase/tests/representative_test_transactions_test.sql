-- Isolated fixtures only. No external provider is called; all data rolls back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
create temporary table kt_ctx as select gen_random_uuid() actor,gen_random_uuid() app,gen_random_uuid() rep,
  gen_random_uuid() category,gen_random_uuid() product,gen_random_uuid() variant,gen_random_uuid() quote,
  gen_random_uuid() key,gen_random_uuid() lock,gen_random_uuid() refund_key,gen_random_uuid() balance_key,
  null::uuid order_id;
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) select actor,'kit-transaction@example.invalid','{}','{}' from kt_ctx;
update public.profiles set status='active' where id=(select actor from kt_ctx);
insert into public.representative_applications(id,user_id) select app,actor from kt_ctx;
insert into public.representatives(id,user_id,application_id) select rep,actor,app from kt_ctx;
insert into public.categories(id,name,slug) select category,'Isolated kit transaction',category::text from kt_ctx;
insert into public.products(id,name,slug,category_id,status,base_price)
  select product,'Isolated kit transaction',product::text,category,'draft',55.94 from kt_ctx;
insert into public.product_images(product_id,storage_path,alt_text,width,height,is_primary)
  select product,'test/kit-transaction.webp','Isolated fixture',720,720,true from kt_ctx;
update public.products set status='active' where id=(select product from kt_ctx);
insert into public.product_variants(id,product_id,sku,color_name,size)
  select variant,product,'KT-TEST-'||variant::text,'White','37' from kt_ctx;
insert into public.inventory(variant_id,available_quantity,reserved_quantity) select variant,8,2 from kt_ctx;
insert into private.bling_catalog_metadata(product_id,commercial_unit,pairs_per_sku,ncm,origin,cest,production_type,fiscal_unit_approved,evidence_reference)
  select product,'UN',3,'64022000',0,'','T',false,'Isolated transaction fixture' from kt_ctx;
insert into private.bling_kit_fiscal_components(kit_variant_id,position,sku,description,quantity_pairs,allocation_weight,ncm,origin,cest,source_hash,evidence_reference)
  select variant,n,'KT-COMPONENT-'||variant::text||'-'||n,'Isolated pair',1,1,'64022000',0,'',private.bling_kit_source_hash(variant),'Isolated composition' from kt_ctx cross join generate_series(1,3)n;
insert into public.shipping_quotes(id,customer_id,provider,service,service_id,amount,estimated_days,packages,expires_at,cart_fingerprint,provider_environment)
  select quote,actor,'melhorenvio','TEST','1',24.49,3,'[]',now()+interval '15 minutes',repeat('a',64),'sandbox' from kt_ctx;
select ok(not has_function_privilege('authenticated','public.create_kit_test_transaction(uuid,uuid,integer,uuid,text,uuid)','execute'),'Browser cannot impersonate another actor');
select ok(not has_function_privilege('anon','public.settle_kit_test_payment(uuid,uuid,text,text,bigint,text,boolean,text)','execute'),'Redirect cannot approve payments');
select ok(not has_table_privilege('service_role','private.kit_test_transactions','insert'),'Even service access uses the checked transaction RPC');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='private.kit_test_transactions'::regclass),'Ledger forces RLS');
update kt_ctx set order_id=(public.create_kit_test_transaction(actor,variant,1,quote,repeat('a',64),key)->>'orderId')::uuid;
select is((select total_in_cents from public.kit_orders where id=(select order_id from kt_ctx)),8043::bigint,'Server prices merchandise and shipping');
select is((select available_quantity from public.inventory where variant_id=(select variant from kt_ctx)),7,'Own kit stock reserved once');
select is((select reserved_quantity from public.inventory where variant_id=(select variant from kt_ctx)),3,'Other reservations preserved');
select is((select (public.create_kit_test_transaction(actor,variant,1,quote,repeat('a',64),key)->>'orderId')::uuid from kt_ctx),(select order_id from kt_ctx),'Intent retry returns same order');
select is((select available_quantity from public.inventory where variant_id=(select variant from kt_ctx)),7,'Intent retry cannot reserve again');
select throws_ok($$select public.create_kit_test_transaction(actor,variant,2,quote,repeat('a',64),key) from kt_ctx$$,'P0001','kit_idempotency_conflict','Conflicting intent rejected');
select lives_ok($$select public.claim_kit_test_payment(actor,order_id,repeat('b',64),lock) from kt_ctx$$,'Claim payment lease');
select throws_ok($$select public.claim_kit_test_payment(actor,order_id,repeat('b',64),gen_random_uuid()) from kt_ctx$$,'P0001','kit_payment_busy','Concurrent provider request blocked');
select ok(not (select public.settle_kit_test_payment(order_id,null,'123','KITTEST-'||order_id,8043,'BRL',false,'approved') from kt_ctx),'Null lease cannot settle');
select throws_ok($$select public.settle_kit_test_payment(order_id,lock,'123','KITTEST-'||order_id,8043,'BRL',true,'approved') from kt_ctx$$,'P0001','kit_provider_mismatch','Production payment rejected');
select throws_ok($$select public.settle_kit_test_payment(order_id,lock,'123','KITTEST-'||order_id,8042,'BRL',false,'approved') from kt_ctx$$,'P0001','kit_provider_mismatch','Amount mismatch rejected');
select ok((select public.settle_kit_test_payment(order_id,lock,'123','KITTEST-'||order_id,8043,'BRL',false,'approved') from kt_ctx),'Authenticated TEST approval settles');
select is((select status::text from public.kit_orders where id=(select order_id from kt_ctx)),'paid','Kit order paid separately');
select is((select reserved_quantity from public.inventory where variant_id=(select variant from kt_ctx)),2,'Approval converts only own reservation');
select is((select available_quantity from public.inventory where variant_id=(select variant from kt_ctx)),7,'Approval never subtracts stock twice');
select ok(not (select public.settle_kit_test_payment(order_id,lock,'123','KITTEST-'||order_id,8043,'BRL',false,'approved') from kt_ctx),'Consumed lease cannot replay');
select throws_ok($$update public.kit_orders set status='shipped' where id=(select order_id from kt_ctx)$$,'23514','resale_not_homologated','Fiscal dependent shipment stays blocked');
select lives_ok($$select public.prepare_kit_test_refund(actor,order_id,refund_key,100) from kt_ctx$$,'Prepare partial refund');
select throws_ok($$select public.prepare_kit_test_refund(actor,order_id,balance_key,100) from kt_ctx$$,'P0001','kit_refund_balance','Concurrent refund intent blocked');
select ok((select public.finish_kit_test_refund(order_id,refund_key,'456',100) from kt_ctx),'Confirm partial refund');
select ok((select public.finish_kit_test_refund(order_id,refund_key,'456',100) from kt_ctx),'Refund replay idempotent');
select is((select refunded_cents from private.kit_test_transactions where order_id=(select order_id from kt_ctx)),100::bigint,'Replay does not increase refund');
select is((select available_quantity from public.inventory where variant_id=(select variant from kt_ctx)),7,'Partial money refund does not restore item');
select lives_ok($$select public.prepare_kit_test_refund(actor,order_id,balance_key,7943) from kt_ctx$$,'Remaining balance exact');
select ok((select public.finish_kit_test_refund(order_id,balance_key,'457',7943) from kt_ctx),'Confirm remaining refund');
select ok((select public.finish_kit_test_refund(order_id,balance_key,'457',7943) from kt_ctx),'Full refund replay idempotent');
select is((select status::text from public.kit_orders where id=(select order_id from kt_ctx)),'refunded','Full balance closes order');
select is((select available_quantity from public.inventory where variant_id=(select variant from kt_ctx)),8,'Full refund restores own stock once');
select is((select reserved_quantity from public.inventory where variant_id=(select variant from kt_ctx)),2,'Existing reservations unchanged');
select is((select count(*) from private.kit_test_events where order_id=(select order_id from kt_ctx)),3::bigint,'Stable payment and refund events deduplicated');
select ok(not exists(select 1 from private.kit_test_events where order_id=(select order_id from kt_ctx) and dispatch_state<>'blocked_validation'),'Downstream effects remain blocked');

select is((select count(*) from public.inventory_movements where reference_type='kit_order' and reference_id=(select order_id from kt_ctx)),2::bigint,'Sale and return audit once');
alter table kt_ctx add column address uuid default gen_random_uuid();
insert into public.addresses(id,user_id,label,recipient_name,postal_code,street,number,district,city,state)
  select address,actor,'TEST','Isolated recipient','35500000','Isolated street','1','Isolated district','Isolated city','MG' from kt_ctx;
update kt_ctx set quote=gen_random_uuid(),key=gen_random_uuid(),lock=gen_random_uuid();
insert into public.shipping_quotes(id,customer_id,provider,service,service_id,amount,estimated_days,packages,expires_at,cart_fingerprint,provider_environment,destination_postal_code)
  select quote,actor,'melhorenvio','TEST','1',24.49,3,'[]',now()+interval '15 minutes',repeat('a',64),'sandbox','35500000' from kt_ctx;
update kt_ctx set order_id=(public.create_kit_test_checkout(actor,variant,1,quote,repeat('a',64),key,address)->>'orderId')::uuid;
select ok((select public.cancel_unstarted_kit_test_transaction(actor,order_id) from kt_ctx),'Unstarted order cancels without provider');
select ok((select public.cancel_unstarted_kit_test_transaction(actor,order_id) from kt_ctx),'Unstarted cancellation replay is harmless');
select is((select available_quantity from public.inventory where variant_id=(select variant from kt_ctx)),8,'Unstarted reservation released once');
select throws_ok($$select public.claim_kit_test_creation(actor,order_id,repeat('b',64),lock) from kt_ctx$$,'P0001','kit_not_payable','Cancelled order cannot create payment');
select public.claim_kit_test_payment(actor,order_id,repeat('b',64),lock) from kt_ctx;
select ok(not (select public.settle_kit_test_payment(order_id,lock,'456','KITTEST-'||order_id,8043,'BRL',false,'approved') from kt_ctx),'Late approval never resells released stock');
select is((select state from private.kit_test_transactions where order_id=(select order_id from kt_ctx)),'reconciliation_required','Late approval quarantined');
select is((select status::text from public.kit_orders where id=(select order_id from kt_ctx)),'cancelled','Late event preserves cancelled order');
update kt_ctx set quote=gen_random_uuid(),key=gen_random_uuid(),lock=gen_random_uuid();
insert into public.shipping_quotes(id,customer_id,provider,service,service_id,amount,estimated_days,packages,expires_at,cart_fingerprint,provider_environment,destination_postal_code)
  select quote,actor,'melhorenvio','TEST','1',24.49,3,'[]',now()+interval '15 minutes',repeat('a',64),'sandbox','35500000' from kt_ctx;
update kt_ctx set order_id=(public.create_kit_test_checkout(actor,variant,1,quote,repeat('a',64),key,address)->>'orderId')::uuid;
select public.claim_kit_test_creation(actor,order_id,repeat('b',64),lock) from kt_ctx;
select ok(not (select public.cancel_unstarted_kit_test_transaction(actor,order_id) from kt_ctx),'Uncertain provider create cannot release stock');
select ok((select public.settle_kit_test_payment(order_id,lock,'789','KITTEST-'||order_id,8043,'BRL',false,'pending') from kt_ctx),'Pending provider result persisted');
select ok((select public.store_kit_test_instructions(order_id,'789',now()+interval '30 minutes','fixture-code','fixture-image') from kt_ctx),'Instructions bound to provider identity');
select ok((select public.store_kit_test_instructions(order_id,'789',null,'','') from kt_ctx),'Provider reads without QR do not erase instructions');
select is((select public.read_kit_test_payment_instructions(actor,order_id)->>'pixCopyPaste' from kt_ctx),'fixture-code','Stored code preserved');
select is((select public.read_kit_test_payment_instructions(gen_random_uuid(),order_id) from kt_ctx),null::jsonb,'Other actor cannot read payment instructions');
update private.kit_test_transactions set expires_at=now()-interval '1 minute' where order_id=(select order_id from kt_ctx);
select is((select public.read_kit_test_payment_instructions(actor,order_id) from kt_ctx),null::jsonb,'Expired instructions unavailable');
select public.claim_kit_test_reconciliation(order_id,lock) from kt_ctx;
select is((select public.claim_kit_test_reconciliation(order_id,gen_random_uuid()) from kt_ctx),null::jsonb,'Concurrent reconciliation excluded');
update private.kit_test_transactions set locked_until=now()-interval '1 minute' where order_id=(select order_id from kt_ctx);
select ok((select public.claim_kit_test_reconciliation(order_id,lock) is not null from kt_ctx),'Expired lease recoverable');
select ok((select public.settle_kit_test_payment(order_id,lock,'789','KITTEST-'||order_id,8043,'BRL',false,'cancelled') from kt_ctx),'Confirmed provider cancellation releases stock');
select is((select available_quantity from public.inventory where variant_id=(select variant from kt_ctx)),8,'Final stock matches initial available');
select is((select reserved_quantity from public.inventory where variant_id=(select variant from kt_ctx)),2,'Final reservation count matches preexisting');
select is((select public.read_kit_test_payment_instructions(actor,order_id) from kt_ctx),null::jsonb,'Cancelled instructions unavailable');


update kt_ctx set quote=gen_random_uuid(),key=gen_random_uuid(),lock=gen_random_uuid();
insert into public.shipping_quotes(id,customer_id,provider,service,service_id,amount,estimated_days,packages,expires_at,cart_fingerprint,provider_environment,destination_postal_code)
  select quote,actor,'melhorenvio','TEST','1',24.49,3,'[]',now()+interval '15 minutes',repeat('a',64),'sandbox','35500000' from kt_ctx;
update kt_ctx set order_id=(public.create_kit_test_checkout(actor,variant,1,quote,repeat('a',64),key,address)->>'orderId')::uuid;
update private.kit_test_transactions set created_at=now()-interval '31 minutes' where order_id=(select order_id from kt_ctx);
select is(jsonb_array_length(public.due_kit_test_transactions()),1,'Unstarted overdue reservation selected');
select ok((select public.cancel_unstarted_kit_test_transaction(actor,order_id) from kt_ctx),'Overdue unstarted reservation safely released');
select is(jsonb_array_length(public.due_kit_test_transactions()),0,'Cancelled intent not rescheduled');
update kt_ctx set quote=gen_random_uuid(),key=gen_random_uuid(),lock=gen_random_uuid();
insert into public.shipping_quotes(id,customer_id,provider,service,service_id,amount,estimated_days,packages,expires_at,cart_fingerprint,provider_environment,destination_postal_code)
  select quote,actor,'melhorenvio','TEST','1',24.49,3,'[]',now()+interval '15 minutes',repeat('a',64),'sandbox','35500000' from kt_ctx;
update kt_ctx set order_id=(public.create_kit_test_checkout(actor,variant,1,quote,repeat('a',64),key,address)->>'orderId')::uuid;
select public.claim_kit_test_creation(actor,order_id,repeat('b',64),lock) from kt_ctx;
update private.kit_test_transactions set payment_started_at=now()-interval '24 hours',locked_until=now()-interval '1 minute' where order_id=(select order_id from kt_ctx);
select is(jsonb_array_length(public.due_kit_test_transactions()),0,'Old uncertain write is not blindly retried');
select is((select state from private.kit_test_transactions where order_id=(select order_id from kt_ctx)),'reconciliation_required','Old unknown outcome quarantined');
select is((select reserved_quantity from public.inventory where variant_id=(select variant from kt_ctx)),3,'Unknown outcome preserves stock reservation');

set constraints all immediate;
select * from finish(true);
select num_failed() as failed_assertions;
rollback;

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

select ok(not has_function_privilege('authenticated','public.configure_transactional_email_test_scope(uuid,uuid,timestamptz)','execute'),'Customers cannot authorize a TEST email window');
select ok(not has_function_privilege('anon','public.claim_test_transactional_email(uuid,uuid)','execute'),'Anonymous callers cannot claim TEST emails');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='private.transactional_email_test_scope'::regclass),'TEST scope has forced RLS');
select public.sync_transactional_email_runtime(false,false);
select throws_ok($q$select public.configure_transactional_email_test_scope('ee000000-0000-4000-8000-000000000001','ee900000-0000-4000-8000-000000000001',now()+interval '1 minute')$q$,'23514','email_test_scope_invalid','Future start is forbidden');
select throws_ok($q$select public.configure_transactional_email_test_scope('ee000000-0000-4000-8000-000000000001','ee900000-0000-4000-8000-000000000001',now()-interval '15 minutes')$q$,'23514','email_test_scope_invalid','Expired start cannot extend the window');
select ok(public.configure_transactional_email_test_scope('ee000000-0000-4000-8000-000000000001','ee900000-0000-4000-8000-000000000001',now()),'One checkout is authorized without enabling commercial mail');
select ok(not (select enabled from private.transactional_email_runtime),'Commercial mail remains disabled');
select throws_ok($q$select public.configure_transactional_email_test_scope('ee000000-0000-4000-8000-000000000001','ee900000-0000-4000-8000-000000000001',now()-interval '1 second')$q$,'23514','email_test_scope_busy','Reconfiguration cannot extend or move an active window');
select is((select expires_at from private.transactional_email_test_scope),now()+interval '15 minutes','Window remains pinned to the original start');
insert into public.orders(id,customer_id,customer_email_snapshot,customer_name_snapshot,status,payment_status,subtotal,grand_total,shipping_address_snapshot,commercial_rules_snapshot)
values('ee100000-0000-4000-8000-000000000001','ee000000-0000-4000-8000-000000000001','sistemas.curtiz@gmail.com','TEST scope','pending_payment','pending',50,50,'{}','{"paymentMode":"test"}');
insert into public.order_items(id,order_id,product_id,variant_id,product_name_snapshot,sku_snapshot,color_snapshot,size_snapshot,quantity,unit_price,total)
values('ee300000-0000-4000-8000-000000000001','ee100000-0000-4000-8000-000000000001','ee200000-0000-4000-8000-000000000002','ee200000-0000-4000-8000-000000000003','Sandalia TEST','EMAIL-SQL-37','Vinho','37',1,50,50);
insert into public.idempotency_keys(key,scope,resource_id,expires_at)
values('ee900000-0000-4000-8000-000000000001','mercadopago.checkout.test','ee100000-0000-4000-8000-000000000001',now()+interval '1 day');
select ok(private.transactional_email_allowed('ee100000-0000-4000-8000-000000000001'),'Only the bound TEST checkout is admitted');
insert into auth.users(id,instance_id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('ee000000-0000-4000-8000-000000000009','00000000-0000-0000-0000-000000000000','authenticated','authenticated','other-scope@example.invalid','{}','{"full_name":"Other fixture"}',now(),now());
update public.orders set customer_id='ee000000-0000-4000-8000-000000000009' where id='ee100000-0000-4000-8000-000000000001';
select ok(not private.transactional_email_allowed('ee100000-0000-4000-8000-000000000001'),'Other actors are excluded even with the checkout key');
update public.orders set customer_id='ee000000-0000-4000-8000-000000000001',created_at=now()-interval '1 day' where id='ee100000-0000-4000-8000-000000000001';
select ok(not private.transactional_email_allowed('ee100000-0000-4000-8000-000000000001'),'Historical orders cannot be backfilled by a test window');
update public.orders set created_at=now() where id='ee100000-0000-4000-8000-000000000001';
select is((select count(*) from private.transactional_emails),0::bigint,'Pending order does not enqueue');
update public.orders set customer_email_snapshot='other@example.invalid' where id='ee100000-0000-4000-8000-000000000001';
select ok(not private.transactional_email_allowed('ee100000-0000-4000-8000-000000000001'),'Other recipients are forbidden');
update public.orders set customer_email_snapshot='sistemas.curtiz@gmail.com',commercial_rules_snapshot='{"paymentMode":"production"}' where id='ee100000-0000-4000-8000-000000000001';
select ok(not private.transactional_email_allowed('ee100000-0000-4000-8000-000000000001'),'Production mode is forbidden');
update public.orders set commercial_rules_snapshot='{"paymentMode":"test"}' where id='ee100000-0000-4000-8000-000000000001';
update public.idempotency_keys set key='ee900000-0000-4000-8000-000000000009' where resource_id='ee100000-0000-4000-8000-000000000001';
select ok(not private.transactional_email_allowed('ee100000-0000-4000-8000-000000000001'),'Other checkout keys are forbidden');
update public.idempotency_keys set key='ee900000-0000-4000-8000-000000000001' where resource_id='ee100000-0000-4000-8000-000000000001';
insert into public.payments(order_id,provider,provider_payment_id,external_reference,status,amount)
values('ee100000-0000-4000-8000-000000000001','mercadopago','email-scope-payment','email-scope-payment','approved',50);
select is((select count(*) from private.transactional_emails),0::bigint,'Provider receipt alone does not approve the persisted order');
update public.orders set status='processing',payment_status='approved' where id='ee100000-0000-4000-8000-000000000001';
select is((select count(*) from private.transactional_emails),1::bigint,'Actual persisted approval trigger enqueues once within the scope');
select is(public.claim_test_transactional_email('ee000000-0000-4000-8000-000000000002','ee900000-0000-4000-8000-000000000009'),null::jsonb,'Wrong scope cannot claim');
create temporary table scoped_claim(job jsonb);
insert into scoped_claim values(public.claim_test_transactional_email('ee000000-0000-4000-8000-000000000002','ee900000-0000-4000-8000-000000000001'));
select ok((select job->>'id' is not null from scoped_claim),'Same claim implementation handles the authorized TEST job');
select throws_ok($q$select public.begin_transactional_email((select (job->>'id')::uuid from scoped_claim),'ee000000-0000-4000-8000-000000000002','{"to":["other@example.invalid"]}')$q$,'P0001','invalid_email_payload','Recipient cannot be redirected');
select ok(public.begin_transactional_email((select (job->>'id')::uuid from scoped_claim),'ee000000-0000-4000-8000-000000000002','{"to":["sistemas.curtiz@gmail.com"],"subject":"SQL-only test"}') is not null,'Normal queue payload validation is preserved');
select ok(not (select enabled from private.transactional_email_runtime),'Claim and begin never enable global sending');
select ok(public.finish_transactional_email((select (job->>'id')::uuid from scoped_claim),'ee000000-0000-4000-8000-000000000002','accepted','scope-provider-test'),'Confirmation lease finishes before the review test');
insert into public.shipments(id,order_id,provider,service,external_id,status)
values('ee400000-0000-4000-8000-000000000001','ee100000-0000-4000-8000-000000000001','melhorenvio','test','scope-review-shipment','pending');
select public.apply_melhor_envio_webhook('scope-review-delivered','scope-review-hash','order.delivered','scope-review-shipment','delivered',now());
select is((select count(*) from private.transactional_emails where kind='review_requested'),1::bigint,'Delivery during the authorized scope schedules one review');
select ok((select e.due_at > s.expires_at from private.transactional_emails e cross join private.transactional_email_test_scope s where e.kind='review_requested'),'The 24-hour review is due after the 15-minute TEST scope expires');
update private.transactional_email_test_scope set started_at=now()-interval '16 minutes',expires_at=now()-interval '1 minute';
update private.transactional_emails set due_at=now()-interval '1 minute' where kind='review_requested';
update public.background_jobs set available_at=now()-interval '1 minute' where job_type='resend.review_requested';
select is(public.claim_test_transactional_email('ee000000-0000-4000-8000-000000000003','ee900000-0000-4000-8000-000000000001'),null::jsonb,'A due review cannot be sent through an expired TEST scope');
select is(public.read_transactional_email_source((select (job->>'id')::uuid from scoped_claim),'ee000000-0000-4000-8000-000000000002'),null::jsonb,'Expired scope cannot read a source for dispatch');
select is(public.begin_transactional_email((select (job->>'id')::uuid from scoped_claim),'ee000000-0000-4000-8000-000000000002','{}'),null::jsonb,'Expired window cannot dispatch');
select ok(public.configure_transactional_email_test_scope(null,null,null),'Scope can be cleared without enabling commercial mail');
select is((select count(*) from private.transactional_email_test_scope),0::bigint,'Cleanup leaves no scope');
select * from finish(true);
rollback;


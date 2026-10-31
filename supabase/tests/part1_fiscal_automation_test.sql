-- Isolated database only. Fixtures roll back; no commercial activation is seeded.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select ok(not has_function_privilege('authenticated','public.set_bling_checkout_recipient(uuid,uuid,boolean,boolean)','execute'),'Recipient declarations require the authenticated server boundary');
select ok(not has_function_privilege('anon','public.read_bling_invoice_archives(uuid)','execute'),'Archive metadata is not public');
select ok(not has_function_privilege('service_role','public.observe_bling_invoice_base(bigint,text,integer,text,text,timestamptz)','execute'),'Service cannot bypass observation side effects');
select ok(not has_table_privilege('authenticated','private.bling_fiscal_automation_policy','insert'),'Browser cannot authorize fiscal automation');
select ok((select relforcerowsecurity from pg_class where oid='private.bling_invoice_archives'::regclass),'Archives force RLS');
select ok((select not public from storage.buckets where id='fiscal-documents'),'Fiscal bucket is private');
insert into auth.users(id,instance_id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('bc000000-0000-4000-8000-000000000010','00000000-0000-0000-0000-000000000000','authenticated','authenticated','fiscal-test@example.invalid','{}','{"full_name":"Fiscal test"}',now(),now());
update public.profiles set status='active' where id='bc000000-0000-4000-8000-000000000010';
insert into public.orders(id,customer_id,customer_email_snapshot,customer_name_snapshot,status,payment_status,subtotal,grand_total,shipping_address_snapshot)
values('bc100000-0000-4000-8000-000000000010','bc000000-0000-4000-8000-000000000010','fiscal-test@example.invalid','Fiscal test','pending_payment','pending',100,100,'{}');
select ok(not public.set_bling_checkout_recipient('bc100000-0000-4000-8000-000000000010','bc000000-0000-4000-8000-000000000099',false,true),'Cannot declare another customer order');
select ok(public.set_bling_checkout_recipient('bc100000-0000-4000-8000-000000000010','bc000000-0000-4000-8000-000000000010',false,true),'Explicit recipient recorded before payment');
select ok(public.set_bling_checkout_recipient('bc100000-0000-4000-8000-000000000010','bc000000-0000-4000-8000-000000000010',false,true),'Identical retry is idempotent');
select ok(not public.set_bling_checkout_recipient('bc100000-0000-4000-8000-000000000010','bc000000-0000-4000-8000-000000000010',true,true),'Cannot replace a declaration silently');
select ok(not public.save_bling_automatic_mirror_approval('bc100000-0000-4000-8000-000000000010',repeat('a',64),private.bling_fiscal_configuration_hash(),false,true),'Pending payment cannot obtain fiscal approval');
update public.orders set status='processing',payment_status='approved' where id='bc100000-0000-4000-8000-000000000010';
insert into public.payments(order_id,provider,provider_payment_id,external_reference,status,amount)
values('bc100000-0000-4000-8000-000000000010','mercadopago','fiscal-approved-test','fiscal-approved-test','approved',100);
select ok(not public.save_bling_automatic_mirror_approval('bc100000-0000-4000-8000-000000000010',repeat('a',64),private.bling_fiscal_configuration_hash(),false,true),'Paid order still requires approved policy');
insert into private.bling_fiscal_automation_policy(approved_configuration_hash,evidence_reference)
values(private.bling_fiscal_configuration_hash(),'isolated fixture approval only');
select ok(not public.save_bling_automatic_mirror_approval('bc100000-0000-4000-8000-000000000010',repeat('a',64),repeat('0',64),false,true),'Stale configuration cannot be approved');
select ok(not public.save_bling_automatic_mirror_approval('bc100000-0000-4000-8000-000000000010',repeat('a',64),private.bling_fiscal_configuration_hash(),true,true),'Cannot substitute fiscal recipient');
select ok(public.save_bling_automatic_mirror_approval('bc100000-0000-4000-8000-000000000010',repeat('a',64),private.bling_fiscal_configuration_hash(),false,true),'Paid order with policy and recipient obtains exact approval');
select ok(public.save_bling_automatic_mirror_approval('bc100000-0000-4000-8000-000000000010',repeat('a',64),private.bling_fiscal_configuration_hash(),false,true),'Exact approval replay succeeds');
select ok(not public.save_bling_automatic_mirror_approval('bc100000-0000-4000-8000-000000000010',repeat('b',64),private.bling_fiscal_configuration_hash(),false,true),'Different mirror cannot overwrite approved snapshot');
select ok(public.save_bling_order_link('bc100000-0000-4000-8000-000000000010',993001,null),'External order linked');
select ok(public.save_bling_invoice_draft('bc100000-0000-4000-8000-000000000010',993002),'Draft linked');
select ok(public.enqueue_bling_invoice_poll('bc100000-0000-4000-8000-000000000010'),'Draft gets read-only reconciliation');
select ok(not public.enqueue_bling_invoice_poll('bc100000-0000-4000-8000-000000000010'),'Poll enqueue is idempotent');
select ok(not public.save_bling_invoice_archive('bc100000-0000-4000-8000-000000000010',993002,'xml','bad',repeat('a',64)),'Draft cannot be archived as authorized');
select ok(public.observe_bling_invoice(993002,(select public_code from public.orders where id='bc100000-0000-4000-8000-000000000010'),4,'1','',now()),'Provider rejection observed');
select is((select invoice_status from private.bling_order_links where order_id='bc100000-0000-4000-8000-000000000010'),'rejected','Rejected invoice is never authorized');
select is((select count(*) from public.background_jobs where job_type='bling.invoice.archive' and payload_sanitized->>'orderId'='bc100000-0000-4000-8000-000000000010'),0::bigint,'Rejection does not archive');
select ok(public.observe_bling_invoice(993002,(select public_code from public.orders where id='bc100000-0000-4000-8000-000000000010'),5,'1',repeat('1',44),now()+interval '1 second'),'Provider authorization observed');
select ok(public.observe_bling_invoice(993002,(select public_code from public.orders where id='bc100000-0000-4000-8000-000000000010'),5,'1',repeat('1',44),now()+interval '2 seconds'),'Authorization replay acknowledged');
select is((select count(*) from public.background_jobs where job_type='bling.invoice.archive' and payload_sanitized->>'orderId'='bc100000-0000-4000-8000-000000000010'),1::bigint,'Exactly one persistent archive job');
select ok(public.save_bling_invoice_archive('bc100000-0000-4000-8000-000000000010',993002,'xml','bc100000-0000-4000-8000-000000000010/993002/'||repeat('a',64)||'.xml',repeat('a',64)),'Authorized archive metadata uses bounded deterministic path');
select ok(not public.save_bling_invoice_archive('bc100000-0000-4000-8000-000000000010',993003,'xml','bc100000-0000-4000-8000-000000000010/993003/'||repeat('a',64)||'.xml',repeat('a',64)),'Cannot attach another invoice archive');
select pg_catalog.set_config('request.jwt.claims','{"role":"authenticated","sub":"bc000000-0000-4000-8000-000000000010"}',true);
set local role authenticated;
select throws_ok($$select public.request_bling_invoice_action('bc100000-0000-4000-8000-000000000010','send')$$,'42501','permission_denied','Customer cannot enqueue fiscal actions');
reset role;
select * from finish();
rollback;

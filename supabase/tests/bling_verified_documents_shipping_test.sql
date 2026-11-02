-- Isolated database fixtures only. All changes roll back; no external calls.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select ok(not has_function_privilege('anon','public.read_bling_invoice_order(bigint,text)','execute'),'Invoice resolution is not public');
select ok(not has_function_privilege('authenticated','public.verify_bling_invoice_archive(uuid,bigint,text,text,integer)','execute'),'A browser cannot approve XML or release shipping');
select ok(has_function_privilege('service_role','public.verify_bling_invoice_archive(uuid,bigint,text,text,integer)','execute'),'Archive verification belongs to the trusted worker');
select ok(not has_function_privilege('service_role','private.bling_invoice_documents_ready(uuid)','execute'),'Readiness helper is not a separate public capability');

insert into auth.users(id,instance_id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('be000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','bling-archive@example.invalid','{}','{"full_name":"Archive fixture"}',now(),now());
update public.profiles set status='active' where id='be000000-0000-4000-8000-000000000001';
insert into public.orders(id,customer_id,customer_email_snapshot,customer_name_snapshot,status,payment_status,subtotal,grand_total,shipping_address_snapshot)
values('be100000-0000-4000-8000-000000000001','be000000-0000-4000-8000-000000000001','bling-archive@example.invalid','Archive fixture','processing','approved',100,100,'{}'),
('be100000-0000-4000-8000-000000000002','be000000-0000-4000-8000-000000000001','bling-archive@example.invalid','Archive fixture','processing','approved',100,100,'{}');
insert into private.bling_order_links(order_id,external_order_id,invoice_id,invoice_status,erp_status,invoice_number,invoice_access_key,last_error_code)
values('be100000-0000-4000-8000-000000000001',994001,995001,'pending','synced',null,null,'validation_error'),
('be100000-0000-4000-8000-000000000002',994002,995002,'authorized','synced','2',repeat('2',44),null);

select is(public.read_bling_invoice_order(995001,'')->>'externalOrderId','994001','Exact invoice ID resolves without numeroPedidoLoja');
select is(public.read_bling_invoice_order(999999,''),null::jsonb,'Manual or unrelated invoice has no inferred local link');
select throws_ok(format('select public.read_bling_invoice_order(995001,%L)',(select public_code from public.orders where id='be100000-0000-4000-8000-000000000002')),'23514','invoice_link_conflict','Conflicting invoice ID and order reference cannot map to either order');
select public.set_bling_shipping_policy(true);
select ok(public.observe_bling_invoice(995001,(select public_code from public.orders where id='be100000-0000-4000-8000-000000000001'),5,'1',repeat('1',44),now()),'Provider authorization is recorded and queues archiving');
select is((select last_error_code from private.bling_order_links where invoice_id=995001),null::text,'Current provider authorization clears the obsolete validation refusal');
select is((public.read_bling_shipping_clearance('be100000-0000-4000-8000-000000000001')->>'allowed')::boolean,false,'Authorization without documents does not release shipping');
select throws_ok($$update public.orders set status='shipped' where id='be100000-0000-4000-8000-000000000001'$$,'23514','fiscal_shipping_blocked','Direct database dispatch cannot bypass missing verified documents');

select ok(public.save_bling_invoice_archive('be100000-0000-4000-8000-000000000001',995001,'xml','be100000-0000-4000-8000-000000000001/995001/'||repeat('a',64)||'.xml',repeat('a',64)),'XML metadata is stored under the immutable invoice');
select ok(not public.verify_bling_invoice_archive('be100000-0000-4000-8000-000000000001',995001,repeat('1',44),repeat('a',64),1),'XML alone cannot complete archiving');
select ok(public.save_bling_invoice_archive('be100000-0000-4000-8000-000000000001',995001,'pdf','be100000-0000-4000-8000-000000000001/995001/'||repeat('b',64)||'.pdf',repeat('b',64)),'DANFE is archived separately');
select ok(not public.verify_bling_invoice_archive('be100000-0000-4000-8000-000000000001',995001,repeat('2',44),repeat('a',64),1),'Another access key cannot verify the archive');
select ok(not public.verify_bling_invoice_archive('be100000-0000-4000-8000-000000000001',995001,repeat('1',44),repeat('c',64),1),'Another XML hash cannot verify the archive');
select ok(public.verify_bling_invoice_archive('be100000-0000-4000-8000-000000000001',995001,repeat('1',44),repeat('a',64),2),'Homologation documents can be archived for evidence');
select is((public.read_bling_shipping_clearance('be100000-0000-4000-8000-000000000001')->>'allowed')::boolean,false,'Homologation cannot authorize commercial dispatch');
select ok(not public.verify_bling_invoice_archive('be100000-0000-4000-8000-000000000001',995001,repeat('1',44),repeat('a',64),1),'Existing homologation proof cannot be relabelled as production');

select ok(public.save_bling_invoice_archive('be100000-0000-4000-8000-000000000002',995002,'xml','be100000-0000-4000-8000-000000000002/995002/'||repeat('c',64)||'.xml',repeat('c',64)),'Second fixture XML is archived');
select ok(public.save_bling_invoice_archive('be100000-0000-4000-8000-000000000002',995002,'pdf','be100000-0000-4000-8000-000000000002/995002/'||repeat('d',64)||'.pdf',repeat('d',64)),'Second fixture DANFE is archived');
select ok(public.verify_bling_invoice_archive('be100000-0000-4000-8000-000000000002',995002,repeat('2',44),repeat('c',64),1),'Matching verified production XML and DANFE complete archiving');
select ok(public.verify_bling_invoice_archive('be100000-0000-4000-8000-000000000002',995002,repeat('2',44),repeat('c',64),1),'Verification replay is idempotent');
select is((public.read_bling_shipping_clearance('be100000-0000-4000-8000-000000000002')->>'allowed')::boolean,true,'Verified production invoice is eligible for the existing shipping flow');
update private.bling_order_links set erp_status='reconciliation_required' where invoice_id=995002;
select is((public.read_bling_shipping_clearance('be100000-0000-4000-8000-000000000002')->>'allowed')::boolean,false,'Commercial reconciliation suspends shipping even after archiving');
select * from finish();
rollback;

begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,instance_id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('ca000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cancellation-test@example.invalid','{}','{"full_name":"Cancellation test"}',now(),now());
update public.profiles set status='active' where id='ca000000-0000-4000-8000-000000000001';
insert into public.user_roles(user_id,role) values('ca000000-0000-4000-8000-000000000001','customer') on conflict do nothing;
create temporary table cancellation_cases(id uuid, original_status public.order_status, paid boolean);
insert into cancellation_cases values
 ('ca100000-0000-4000-8000-000000000001','pending_payment',false),
 ('ca100000-0000-4000-8000-000000000002','processing',true),
 ('ca100000-0000-4000-8000-000000000003','picking',true),
 ('ca100000-0000-4000-8000-000000000004','ready_to_ship',true),
 ('ca100000-0000-4000-8000-000000000005','shipped',true),
 ('ca100000-0000-4000-8000-000000000006','delivered',true),
 ('ca100000-0000-4000-8000-000000000007','ready_to_ship',true);
insert into public.orders(id,customer_id,customer_email_snapshot,customer_name_snapshot,status,payment_status,subtotal,grand_total,shipping_address_snapshot)
select id,'ca000000-0000-4000-8000-000000000001','cancellation-test@example.invalid','Cancellation test',original_status,
  case when paid then 'approved'::public.payment_status else 'pending'::public.payment_status end,50,50,'{}' from cancellation_cases;
insert into public.payments(order_id,provider,provider_payment_id,external_reference,status,amount)
select id,'mercadopago','test-'||id::text,'test-'||id::text,case when paid then 'approved'::public.payment_status else 'pending'::public.payment_status end,50 from cancellation_cases;
insert into public.shipments(order_id,provider,service,status,dispatched_at)
values('ca100000-0000-4000-8000-000000000007','test','test','dispatched',now());

insert into public.categories(id,name,slug) values('ca200000-0000-4000-8000-000000000001','Cancellation test','cancellation-test');
insert into public.products(id,name,slug,category_id,status,base_price,description,weight_grams,height_cm,width_cm,length_cm)
values('ca200000-0000-4000-8000-000000000002','Cancellation test','cancellation-test','ca200000-0000-4000-8000-000000000001','active',50,'Test',100,5,10,20);
insert into public.product_variants(id,product_id,sku,color_name,size)
values('ca200000-0000-4000-8000-000000000003','ca200000-0000-4000-8000-000000000002','CANCELLATION-TEST','Black','37');
insert into public.carts(id,customer_id) values('ca200000-0000-4000-8000-000000000004','ca000000-0000-4000-8000-000000000001');
insert into public.inventory(variant_id,available_quantity,reserved_quantity) values('ca200000-0000-4000-8000-000000000003',8,1);
insert into public.inventory_reservations(cart_id,order_id,variant_id,quantity,expires_at,converted_at) values
 ('ca200000-0000-4000-8000-000000000004','ca100000-0000-4000-8000-000000000001','ca200000-0000-4000-8000-000000000003',1,now()+interval '1 hour',null),
 ('ca200000-0000-4000-8000-000000000004','ca100000-0000-4000-8000-000000000002','ca200000-0000-4000-8000-000000000003',1,now()+interval '1 hour',now());

select ok(not has_function_privilege('authenticated','public.begin_customer_order_cancellation(uuid,uuid)','execute'),'Customer cannot invoke privileged cancellation directly');
select ok(not has_function_privilege('authenticated','public.begin_mercadopago_refund(uuid,uuid,numeric,uuid,text)','execute'),'Customer does not acquire refund permission');
select throws_ok(format('select public.begin_customer_order_cancellation(%L::uuid,%L::uuid)',id,'ca000000-0000-4000-8000-000000000001'),
  '23514','cancellation_not_allowed','Dispatch/delivery overrides cancellation') from cancellation_cases where id::text > 'ca100000-0000-4000-8000-000000000004';
select lives_ok(format('select public.begin_customer_order_cancellation(%L::uuid,%L::uuid)',id,'ca000000-0000-4000-8000-000000000001'),
  'Pre-shipment cancellation accepted: '||original_status) from cancellation_cases where id::text <= 'ca100000-0000-4000-8000-000000000004';
select is(public.begin_customer_order_cancellation('ca100000-0000-4000-8000-000000000002','ca000000-0000-4000-8000-000000000001')->>'busy','true','Second claim has no external-work lease');
select lives_ok($$select public.prepare_customer_order_cancellation('ca100000-0000-4000-8000-000000000001','ca000000-0000-4000-8000-000000000001',false)$$,'Unpaid cancellation completes immediately');
select is((select status::text from public.orders where id='ca100000-0000-4000-8000-000000000001'),'cancelled','Unpaid order is cancelled');
select is((select count(*) from public.payment_refunds where order_id='ca100000-0000-4000-8000-000000000001'),0::bigint,'No unpaid refund');
select is((select available_quantity from public.inventory where variant_id='ca200000-0000-4000-8000-000000000003'),9,'Unpaid reservation released once');
select lives_ok(format('select public.prepare_customer_order_cancellation(%L::uuid,%L::uuid,true)',id,'ca000000-0000-4000-8000-000000000001'),
  'Full refund reserved for '||original_status) from cancellation_cases where id::text between 'ca100000-0000-4000-8000-000000000002' and 'ca100000-0000-4000-8000-000000000004';
select throws_ok($$update public.orders set status='shipped' where id='ca100000-0000-4000-8000-000000000002'$$,'23514','order_cancellation_in_progress','Refund hold prevents shipping');
select throws_ok($$insert into public.shipments(order_id,provider,service,status,dispatched_at) values('ca100000-0000-4000-8000-000000000002','test','test','dispatched',now())$$,'23514','order_cancellation_in_progress','Direct shipment dispatch is guarded');
select throws_ok($$insert into public.operational_tasks(task_type,order_id,status) values('shipping','ca100000-0000-4000-8000-000000000002','queued')$$,'23514','order_cancellation_in_progress','Held order cannot get executable tasks');
select is((select status::text from public.orders where id='ca100000-0000-4000-8000-000000000002'),'refund_pending','External failure leaves the refund hold in place');
select lives_ok(format('select public.finalize_mercadopago_refund(%L::uuid,%L,%L::uuid,50,%L::uuid)',payment_id,'refund-'||id::text,'ca000000-0000-4000-8000-000000000001',idempotency_key),'Confirm full customer refund') from public.payment_refunds where order_id in(select id from cancellation_cases);
select lives_ok(format('select public.finalize_mercadopago_refund(%L::uuid,%L,%L::uuid,50,%L::uuid)',payment_id,'refund-'||id::text,'ca000000-0000-4000-8000-000000000001',idempotency_key),'Refund replay is idempotent') from public.payment_refunds where order_id in(select id from cancellation_cases);
select is((select count(*) from public.orders where id in(select id from cancellation_cases where id::text <= 'ca100000-0000-4000-8000-000000000004') and payment_status='approved'),0::bigint,'Cancelled/refunded orders are not active paid sales');
select is((select available_quantity from public.inventory where variant_id='ca200000-0000-4000-8000-000000000003'),10,'Converted sale restored once even after refund replay');
select is((select reserved_quantity from public.inventory where variant_id='ca200000-0000-4000-8000-000000000003'),0,'No remaining stock reservation');
select * from finish();
rollback;

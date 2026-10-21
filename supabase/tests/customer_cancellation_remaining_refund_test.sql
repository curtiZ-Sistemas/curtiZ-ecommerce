begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,instance_id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('cf000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','remaining-refund-test@example.invalid','{}','{"full_name":"Cancellation test"}',now(),now());
update public.profiles set status='active' where id='cf000000-0000-4000-8000-000000000001';
insert into public.user_roles(user_id,role) values('cf000000-0000-4000-8000-000000000001','customer') on conflict do nothing;
create temporary table cancellation_cases(id uuid, original_status public.order_status, paid boolean);
insert into cancellation_cases values
 ('cf100000-0000-4000-8000-000000000001','pending_payment',false),
 ('cf100000-0000-4000-8000-000000000002','processing',true),
 ('cf100000-0000-4000-8000-000000000003','picking',true),
 ('cf100000-0000-4000-8000-000000000004','ready_to_ship',true),
 ('cf100000-0000-4000-8000-000000000005','shipped',true),
 ('cf100000-0000-4000-8000-000000000006','delivered',true),
 ('cf100000-0000-4000-8000-000000000007','ready_to_ship',true);
insert into public.orders(id,customer_id,customer_email_snapshot,customer_name_snapshot,status,payment_status,subtotal,grand_total,shipping_address_snapshot)
select id,'cf000000-0000-4000-8000-000000000001','remaining-refund-test@example.invalid','Cancellation test',original_status,
  case when paid then 'approved'::public.payment_status else 'pending'::public.payment_status end,50,50,'{}' from cancellation_cases;
insert into public.payments(order_id,provider,provider_payment_id,external_reference,status,amount)
select id,'mercadopago','test-'||id::text,'test-'||id::text,case when paid then 'approved'::public.payment_status else 'pending'::public.payment_status end,50 from cancellation_cases;
insert into public.shipments(order_id,provider,service,status,dispatched_at)
values('cf100000-0000-4000-8000-000000000007','test','test','dispatched',now());

insert into public.categories(id,name,slug) values('cf200000-0000-4000-8000-000000000001','Cancellation test','remaining-refund-test');
insert into public.products(id,name,slug,category_id,status,base_price,description,weight_grams,height_cm,width_cm,length_cm)
values('cf200000-0000-4000-8000-000000000002','Cancellation test','remaining-refund-test','cf200000-0000-4000-8000-000000000001','draft',50,'Test',100,5,10,20);
-- A guarda de publicação exige imagem real concluída: o produto nasce rascunho e é publicado depois.
insert into public.product_images(product_id,storage_path,alt_text,width,height,is_primary)
select id,'test/'||slug||'.webp',name,720,720,true from public.products where id in ('cf200000-0000-4000-8000-000000000002');
update public.products set status='active' where id in ('cf200000-0000-4000-8000-000000000002');
insert into public.product_variants(id,product_id,sku,color_name,size)
values('cf200000-0000-4000-8000-000000000003','cf200000-0000-4000-8000-000000000002','REMAINING-REFUND-TEST','Black','37');
insert into public.carts(id,customer_id) values('cf200000-0000-4000-8000-000000000004','cf000000-0000-4000-8000-000000000001');
insert into public.inventory(variant_id,available_quantity,reserved_quantity) values('cf200000-0000-4000-8000-000000000003',8,1);
insert into public.inventory_reservations(cart_id,order_id,variant_id,quantity,expires_at,converted_at) values
 ('cf200000-0000-4000-8000-000000000004','cf100000-0000-4000-8000-000000000001','cf200000-0000-4000-8000-000000000003',1,now()+interval '1 hour',null),
 ('cf200000-0000-4000-8000-000000000004','cf100000-0000-4000-8000-000000000002','cf200000-0000-4000-8000-000000000003',1,now()+interval '1 hour',now());


select public.reconcile_mercadopago_provider_refund('test-cf100000-0000-4000-8000-000000000002',
  'partial-before-cancel',10,'partial-before-cancel-event',now());
select is((select available_quantity from public.inventory where variant_id='cf200000-0000-4000-8000-000000000003'),8,'Partial does not restore inventory');
select public.begin_customer_order_cancellation('cf100000-0000-4000-8000-000000000002','cf000000-0000-4000-8000-000000000001');
create temporary table remaining_reservation as
  select public.prepare_customer_order_cancellation('cf100000-0000-4000-8000-000000000002','cf000000-0000-4000-8000-000000000001',true) value;
select is((select value->>'refundAmountInCents' from remaining_reservation),'4000','Cancellation reserves only the unpaid refund balance');
select is((select value->'completedRefundIds' from remaining_reservation),'["partial-before-cancel"]'::jsonb,'Backend identifies the already completed partial');
select is((select sum(amount) from public.payment_refunds where order_id='cf100000-0000-4000-8000-000000000002' and status='pending'),40::numeric,'Only remaining amount is reserved');
select is(public.prepare_customer_order_cancellation('cf100000-0000-4000-8000-000000000002','cf000000-0000-4000-8000-000000000001',true),
  (select value from remaining_reservation),'Preparation retry retains the exact amount and key');
select is((select count(*) from public.payment_refunds where order_id='cf100000-0000-4000-8000-000000000002' and status='pending'),1::bigint,'Retry creates one reservation');
select throws_ok(format('select public.begin_mercadopago_refund(%L::uuid,%L::uuid,1,%L::uuid,%L)',
  (select id from public.payments where order_id='cf100000-0000-4000-8000-000000000002'),
  'cf000000-0000-4000-8000-000000000001','cf300000-0000-4000-8000-000000000001','Unrelated partial'),
  'P0001','invalid refund request','Customer cannot request an unrelated partial refund');
select throws_ok(format('select public.finalize_mercadopago_refund(%L::uuid,%L,%L::uuid,50,%L::uuid)',
  (select value->>'paymentId' from remaining_reservation),'remaining-confirmed','cf000000-0000-4000-8000-000000000001',
  (select value->>'idempotencyKey' from remaining_reservation)),
  'P0001','refund state mismatch','Whole original amount cannot be finalized after a partial');
select throws_ok($$update public.orders set status='shipped' where id='cf100000-0000-4000-8000-000000000002'$$,
  '23514','order_cancellation_in_progress','Remaining refund hold still blocks dispatch');
select lives_ok(format('select public.finalize_mercadopago_refund(%L::uuid,%L,%L::uuid,40,%L::uuid)',
  (select value->>'paymentId' from remaining_reservation),'remaining-confirmed','cf000000-0000-4000-8000-000000000001',
  (select value->>'idempotencyKey' from remaining_reservation)),'Confirmed remaining refund completes cancellation');
select is((select status::text from public.orders where id='cf100000-0000-4000-8000-000000000002'),'refunded','Order is refunded after total equals payment');
select is((select sum(amount) from public.payment_refunds where order_id='cf100000-0000-4000-8000-000000000002' and status='completed'),50::numeric,'Two refunds equal original payment exactly');
select is((select count(*) from public.payment_refunds where order_id='cf100000-0000-4000-8000-000000000002' and status='completed'),2::bigint,'Original partial and remaining refund are distinct');
select is((select count(*) from public.payment_refunds where order_id='cf100000-0000-4000-8000-000000000002' and status='pending'),0::bigint,'No orphaned pending reservation remains');
select is((select available_quantity from public.inventory where variant_id='cf200000-0000-4000-8000-000000000003'),9,'Cancelled commercial stock is restored once');
select lives_ok(format('select public.finalize_mercadopago_refund(%L::uuid,%L,%L::uuid,40,%L::uuid)',
  (select value->>'paymentId' from remaining_reservation),'remaining-confirmed','cf000000-0000-4000-8000-000000000001',
  (select value->>'idempotencyKey' from remaining_reservation)),'Remaining refund acknowledgement is idempotent');
select is((select available_quantity from public.inventory where variant_id='cf200000-0000-4000-8000-000000000003'),9,'Replay does not restore twice');
select is((select reserved_quantity from public.inventory where variant_id='cf200000-0000-4000-8000-000000000003'),1,'Other order reservation is preserved');
select is((select refunded_amount from public.accounts_receivable where order_id='cf100000-0000-4000-8000-000000000002'),50::numeric,'Financial reconciliation reflects both refunds');
select ok(not has_function_privilege('authenticated','public.prepare_customer_order_cancellation(uuid,uuid,boolean)','execute'),'Customer has no direct privileged preparation access');
select ok(not has_function_privilege('authenticated','public.finalize_mercadopago_refund(uuid,text,uuid,numeric,uuid)','execute'),'Customer has no direct refund finalization access');
select ok(not has_function_privilege('anon','public.begin_mercadopago_refund(uuid,uuid,numeric,uuid,text)','execute'),'Anonymous caller cannot reserve refunds');
-- Provider webhook wins the race against the cancellation response.
select public.reconcile_mercadopago_provider_refund('test-cf100000-0000-4000-8000-000000000003',
  'race-partial',10,'race-partial-event',now());
select public.begin_customer_order_cancellation('cf100000-0000-4000-8000-000000000003','cf000000-0000-4000-8000-000000000001');
create temporary table race_reservation as select public.prepare_customer_order_cancellation(
  'cf100000-0000-4000-8000-000000000003','cf000000-0000-4000-8000-000000000001',true) value;
select public.reconcile_mercadopago_provider_refund('test-cf100000-0000-4000-8000-000000000003',
  'race-remaining',40,'race-remaining-event',now());
select lives_ok(format('select public.finalize_mercadopago_refund(%L::uuid,%L,%L::uuid,40,%L::uuid)',
  (select value->>'paymentId' from race_reservation),'race-remaining','cf000000-0000-4000-8000-000000000001',
  (select value->>'idempotencyKey' from race_reservation)),'Webhook before response reconciles without duplicate financial write');
select is((select count(*) from public.payment_refunds where order_id='cf100000-0000-4000-8000-000000000003' and status='pending'),0::bigint,'Webhook race leaves no orphaned reservation');
select is((select sum(amount) from public.payment_refunds where order_id='cf100000-0000-4000-8000-000000000003' and status='completed'),50::numeric,'Webhook race preserves actual confirmed amount');
select lives_ok(format('select public.finalize_mercadopago_refund(%L::uuid,%L,%L::uuid,40,%L::uuid)',
  (select value->>'paymentId' from race_reservation),'race-remaining','cf000000-0000-4000-8000-000000000001',
  (select value->>'idempotencyKey' from race_reservation)),'Reconciled acknowledgement can be replayed');
select is((select count(*) from public.audit_logs where entity_id=(select (value->>'paymentId')::uuid from race_reservation)
  and action='payment.refund.reconciled'),1::bigint,'Race acknowledgement is audited once');
select throws_ok(format('select public.finalize_mercadopago_refund(%L::uuid,%L,%L::uuid,40,%L::uuid)',
  (select value->>'paymentId' from race_reservation),'race-remaining','cf000000-0000-4000-8000-000000000099',
  (select value->>'idempotencyKey' from race_reservation)),
  'P0001','refund observation conflict','Another actor cannot reuse a reconciled refund');
select is((select refunded_amount from public.accounts_receivable where order_id='cf100000-0000-4000-8000-000000000003'),50::numeric,'Race does not duplicate financial refunded amount');
-- The existing manager partial-refund capability remains independent of cancellation.
insert into public.user_roles(user_id,role) values('cf000000-0000-4000-8000-000000000001','manager');
select public.begin_mercadopago_refund((select id from public.payments where order_id='cf100000-0000-4000-8000-000000000004'),
  'cf000000-0000-4000-8000-000000000001',5,'cf300000-0000-4000-8000-000000000004','Manager partial test');
select lives_ok(format('select public.finalize_mercadopago_refund(%L::uuid,%L,%L::uuid,5,%L::uuid)',
  (select id from public.payments where order_id='cf100000-0000-4000-8000-000000000004'),
  'manager-partial','cf000000-0000-4000-8000-000000000001','cf300000-0000-4000-8000-000000000004'),
  'Manager can still acknowledge an authorized partial refund');
select is((select status::text from public.payments where order_id='cf100000-0000-4000-8000-000000000004'),'approved','Manager partial does not invent total cancellation');
select is((select refunded_amount from public.accounts_receivable where order_id='cf100000-0000-4000-8000-000000000004'),5::numeric,'Manager partial keeps its actual financial amount');
select num_failed() as failed,array(select finish()) as summary;
rollback;


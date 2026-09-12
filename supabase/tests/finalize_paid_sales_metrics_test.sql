begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,instance_id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('fa000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','metrics-regression@test.local','{}','{"full_name":"Metrics Regression"}',now(),now());
insert into public.user_roles(user_id,role) values ('fa000000-0000-4000-8000-000000000001','manager') on conflict do nothing;
insert into public.categories(id,name,slug) values ('fa100000-0000-4000-8000-000000000001','Metrics test','metrics-regression');
insert into public.products(id,name,slug,short_description,description,category_id,status,base_price,cost_price,weight_grams,height_cm,width_cm,length_cm)
values ('fa200000-0000-4000-8000-000000000001','Metrics test','metrics-regression','Test','Test','fa100000-0000-4000-8000-000000000001','active',100,20,200,5,10,20);
insert into public.product_variants(id,product_id,sku,color_name,size)
values ('fa300000-0000-4000-8000-000000000001','fa200000-0000-4000-8000-000000000001','METRICS-REGRESSION','Preto','37');
insert into public.inventory(variant_id,available_quantity) values ('fa300000-0000-4000-8000-000000000001',10);
insert into public.orders(id,customer_id,customer_email_snapshot,customer_name_snapshot,status,payment_status,subtotal,grand_total,shipping_address_snapshot,placed_at)
values ('fa400000-0000-4000-8000-000000000001','fa000000-0000-4000-8000-000000000001','metrics-regression@test.local','Metrics Regression','pending_payment','pending',100,100,'{}','2050-01-15T12:00:00Z');
insert into public.order_items(order_id,product_id,variant_id,product_name_snapshot,sku_snapshot,color_snapshot,size_snapshot,quantity,unit_price,total)
values ('fa400000-0000-4000-8000-000000000001','fa200000-0000-4000-8000-000000000001','fa300000-0000-4000-8000-000000000001','Metrics test','METRICS-REGRESSION','Preto','37',1,100,100);
insert into public.payments(id,order_id,provider,external_reference,status,amount,currency,payment_method_summary)
values ('fa500000-0000-4000-8000-000000000001','fa400000-0000-4000-8000-000000000001','mercadopago','METRICS-REGRESSION','pending',100,'BRL','pix');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"fa000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
select is((public.manager_dashboard_metrics('2050-01-01','2050-01-31')->>'orders')::integer,0,'Pending Pix is not a sale');
select is((public.manager_dashboard_metrics('2050-01-01','2050-01-31')->>'gross_cents')::bigint,0::bigint,'Pending Pix has no revenue');
select is(jsonb_array_length(public.manager_strategic_metrics('2050-01-01','2050-01-31')->'products'),0,'Pending Pix has no sold units');

reset role;
update public.orders set status='payment_approved',payment_status='approved' where id='fa400000-0000-4000-8000-000000000001';
update public.payments set status='approved',paid_at='2050-01-15T12:00:00Z' where id='fa500000-0000-4000-8000-000000000001';
set local role authenticated;
select is((public.manager_dashboard_metrics('2050-01-01','2050-01-31')->>'orders')::integer,1,'Approved Pix counts once');
select is((public.manager_dashboard_metrics('2050-01-01','2050-01-31')->>'gross_cents')::bigint,10000::bigint,'Approved Pix counts R$100');
select is((public.manager_dashboard_metrics('2050-01-01','2050-01-31')->>'average_ticket_cents')::bigint,10000::bigint,'Average ticket uses the paid order');
select is((public.manager_strategic_metrics('2050-01-01','2050-01-31')->'products'->0->>'current_units')::bigint,1::bigint,'Paid product counts one unit');

reset role;
insert into public.payment_refunds(payment_id,order_id,amount,currency,status,reason,requested_by,completed_at)
values ('fa500000-0000-4000-8000-000000000001','fa400000-0000-4000-8000-000000000001',20,'BRL','completed','Regression partial refund','fa000000-0000-4000-8000-000000000001','2050-01-16T12:00:00Z');
set local role authenticated;
select is((public.manager_dashboard_metrics('2050-01-01','2050-01-31')->>'net_cents')::bigint,8000::bigint,'Dashboard deducts the partial refund once');
select is((select sum((day->>'net_cents')::bigint) from jsonb_array_elements(public.manager_dashboard_metrics('2050-01-01','2050-01-31')->'series') day)::bigint,8000::bigint,'Dashboard chart agrees with its total');
select is((public.manager_strategic_metrics('2050-01-01','2050-01-31')->'comparison'->'current'->>'net_cents')::bigint,8000::bigint,'Strategy deducts the partial refund');

reset role;
update public.orders set status='cancellation_requested' where id='fa400000-0000-4000-8000-000000000001';
set local role authenticated;
select is((public.manager_dashboard_metrics('2050-01-01','2050-01-31')->>'orders')::integer,0,'Cancellation requested does not count as a sale');
select is(jsonb_array_length(public.manager_strategic_metrics('2050-01-01','2050-01-31')->'products'),0,'Cancellation requested leaves the ranking');

reset role;
update public.orders set status='refunded',payment_status='refunded' where id='fa400000-0000-4000-8000-000000000001';
update public.payments set status='refunded' where id='fa500000-0000-4000-8000-000000000001';
update public.payment_refunds set amount=100 where payment_id='fa500000-0000-4000-8000-000000000001';
set local role authenticated;
select is((public.manager_dashboard_metrics('2050-01-01','2050-01-31')->>'net_cents')::bigint,0::bigint,'A fully refunded order is not deducted twice');
select is((public.manager_strategic_metrics('2050-01-01','2050-01-31')->'comparison'->'current'->>'net_cents')::bigint,0::bigint,'A fully refunded order retains no strategic net revenue');

select * from finish();
rollback;

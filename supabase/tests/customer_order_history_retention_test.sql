begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users(id,instance_id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('ca000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','retention-one@test.local','{}','{}',now(),now()),
('ca000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','retention-two@test.local','{}','{}',now(),now());
update public.profiles set status='active' where id in (
  'ca000000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000002'
);

insert into public.orders(
  id,public_code,customer_id,customer_email_snapshot,customer_name_snapshot,status,payment_status,
  subtotal,grand_total,shipping_address_snapshot,created_at
) values
('ca100000-0000-4000-8000-000000000001','CZT-CANCEL-RECENT','ca000000-0000-4000-8000-000000000001','one@test.local','One','cancelled','cancelled',50,50,'{}',now()-interval '4 days'),
('ca100000-0000-4000-8000-000000000002','CZT-CANCEL-BOUNDARY','ca000000-0000-4000-8000-000000000001','one@test.local','One','cancelled','cancelled',50,50,'{}',now()-interval '4 days'),
('ca100000-0000-4000-8000-000000000003','CZT-REFUND-PENDING','ca000000-0000-4000-8000-000000000001','one@test.local','One','refund_pending','approved',50,50,'{}',now()-interval '30 days'),
('ca100000-0000-4000-8000-000000000004','CZT-REFUND-RECENT','ca000000-0000-4000-8000-000000000001','one@test.local','One','refunded','refunded',50,50,'{}',now()-interval '30 days'),
('ca100000-0000-4000-8000-000000000005','CZT-REFUND-BOUNDARY','ca000000-0000-4000-8000-000000000001','one@test.local','One','refunded','refunded',50,50,'{}',now()-interval '30 days'),
('ca100000-0000-4000-8000-000000000006','CZT-REFUND-FAILED','ca000000-0000-4000-8000-000000000001','one@test.local','One','refund_pending','approved',50,50,'{}',now()-interval '30 days'),
('ca100000-0000-4000-8000-000000000007','CZT-REFUND-REVIEW','ca000000-0000-4000-8000-000000000001','one@test.local','One','manual_review','approved',50,50,'{}',now()-interval '30 days'),
('ca100000-0000-4000-8000-000000000008','CZT-OTHER-CUSTOMER','ca000000-0000-4000-8000-000000000002','two@test.local','Two','refund_pending','approved',50,50,'{}',now()-interval '30 days');

insert into public.payments(
  id,order_id,provider,provider_payment_id,external_reference,status,amount,payment_method_summary,paid_at
) values
('ca200000-0000-4000-8000-000000000001','ca100000-0000-4000-8000-000000000001','mercadopago',null,'CZT-CANCEL-RECENT','cancelled',50,null,null),
('ca200000-0000-4000-8000-000000000002','ca100000-0000-4000-8000-000000000002','mercadopago',null,'CZT-CANCEL-BOUNDARY','cancelled',50,null,null),
('ca200000-0000-4000-8000-000000000003','ca100000-0000-4000-8000-000000000003','mercadopago','refund-pending','CZT-REFUND-PENDING','approved',50,'credit_card','2026-01-01T12:00:00Z'),
('ca200000-0000-4000-8000-000000000004','ca100000-0000-4000-8000-000000000004','mercadopago','refund-recent','CZT-REFUND-RECENT','refunded',50,'credit_card','2026-01-01T12:00:00Z'),
('ca200000-0000-4000-8000-000000000005','ca100000-0000-4000-8000-000000000005','mercadopago','refund-boundary','CZT-REFUND-BOUNDARY','refunded',50,'credit_card','2026-01-01T12:00:00Z'),
('ca200000-0000-4000-8000-000000000006','ca100000-0000-4000-8000-000000000006','mercadopago','refund-failed','CZT-REFUND-FAILED','approved',50,'credit_card','2026-01-01T12:00:00Z'),
('ca200000-0000-4000-8000-000000000007','ca100000-0000-4000-8000-000000000007','mercadopago','refund-review','CZT-REFUND-REVIEW','approved',50,'credit_card','2026-01-01T12:00:00Z'),
('ca200000-0000-4000-8000-000000000008','ca100000-0000-4000-8000-000000000008','mercadopago','refund-other','CZT-OTHER-CUSTOMER','approved',50,'credit_card','2026-01-01T12:00:00Z');

insert into public.order_status_history(order_id,previous_status,new_status,reason,created_at) values
('ca100000-0000-4000-8000-000000000001','cancellation_requested','cancelled','Retention test',now()-interval '71 hours 59 minutes'),
('ca100000-0000-4000-8000-000000000002','cancellation_requested','cancelled','Retention boundary test',now()-interval '72 hours');

insert into public.payment_refunds(
  payment_id,order_id,amount,currency,status,reason,requested_by,created_at,completed_at,source
) values
('ca200000-0000-4000-8000-000000000003','ca100000-0000-4000-8000-000000000003',50,'BRL','pending','Retention pending','ca000000-0000-4000-8000-000000000001',now()-interval '20 days',null,'customer'),
('ca200000-0000-4000-8000-000000000004','ca100000-0000-4000-8000-000000000004',50,'BRL','completed','Retention recent','ca000000-0000-4000-8000-000000000001',now()-interval '12 days',now()-interval '239 hours 59 minutes','customer'),
('ca200000-0000-4000-8000-000000000005','ca100000-0000-4000-8000-000000000005',50,'BRL','completed','Retention boundary','ca000000-0000-4000-8000-000000000001',now()-interval '12 days',now()-interval '240 hours','customer'),
('ca200000-0000-4000-8000-000000000006','ca100000-0000-4000-8000-000000000006',50,'BRL','failed','Retention failed','ca000000-0000-4000-8000-000000000001',now()-interval '20 days',null,'customer'),
('ca200000-0000-4000-8000-000000000007','ca100000-0000-4000-8000-000000000007',50,'BRL','failed','Retention review','ca000000-0000-4000-8000-000000000001',now()-interval '20 days',null,'customer'),
('ca200000-0000-4000-8000-000000000008','ca100000-0000-4000-8000-000000000008',50,'BRL','pending','Retention other','ca000000-0000-4000-8000-000000000002',now()-interval '20 days',null,'customer');

set local role anon;
select ok(not has_function_privilege('anon','public.list_my_visible_orders(integer)','execute'),
  'Anonymous users cannot list customer orders');
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"ca000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select ok(public.list_my_visible_orders(50) @> '[{"id":"ca100000-0000-4000-8000-000000000001"}]'::jsonb,
  'Unpaid cancellation remains visible at 2d23h59');
select ok(not (public.list_my_visible_orders(50) @> '[{"id":"ca100000-0000-4000-8000-000000000002"}]'::jsonb),
  'Unpaid cancellation is hidden at exactly three days');
select ok(public.list_my_visible_orders(50) @> '[{"id":"ca100000-0000-4000-8000-000000000003"}]'::jsonb,
  'Twenty-day pending refund remains visible');
select ok(public.list_my_visible_orders(50) @> '[{"id":"ca100000-0000-4000-8000-000000000004"}]'::jsonb,
  'Completed refund remains visible at 9d23h59');
select ok(not (public.list_my_visible_orders(50) @> '[{"id":"ca100000-0000-4000-8000-000000000005"}]'::jsonb),
  'Completed refund is hidden at exactly ten days');
select ok(public.list_my_visible_orders(50) @> '[{"id":"ca100000-0000-4000-8000-000000000006"}]'::jsonb,
  'Failed refund remains visible');
select ok(public.list_my_visible_orders(50) @> '[{"id":"ca100000-0000-4000-8000-000000000007"}]'::jsonb,
  'Manual-review order remains visible');
select ok(not (public.list_my_visible_orders(50) @> '[{"id":"ca100000-0000-4000-8000-000000000008"}]'::jsonb),
  'Customer cannot see another customer order');
select is((select item->>'cancellation_completed_at' from jsonb_array_elements(public.list_my_visible_orders(50)) item
  where item->>'id'='ca100000-0000-4000-8000-000000000001'),
  to_jsonb(now()-interval '71 hours 59 minutes') #>> '{}',
  'Cancellation metadata comes from order status history');
select is((select item->>'refund_completed_at' from jsonb_array_elements(public.list_my_visible_orders(50)) item
  where item->>'id'='ca100000-0000-4000-8000-000000000004'),
  to_jsonb(now()-interval '239 hours 59 minutes') #>> '{}',
  'Refund metadata comes from payment_refunds.completed_at');
reset role;

select ok(
  (select count(*) = 2 from public.orders where id in (
    'ca100000-0000-4000-8000-000000000002','ca100000-0000-4000-8000-000000000005'
  ))
  and exists(select 1 from public.order_status_history where order_id='ca100000-0000-4000-8000-000000000002')
  and exists(select 1 from public.payment_refunds where order_id='ca100000-0000-4000-8000-000000000005'),
  'Orders and their permanent history remain available internally'
);

select * from finish();
rollback;

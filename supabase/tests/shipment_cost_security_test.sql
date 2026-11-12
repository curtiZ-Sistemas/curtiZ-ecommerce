begin;
create extension if not exists pgtap with schema extensions;
select plan(15);
insert into auth.users(id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('ee100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'shipment-customer@example.invalid', '{}', '{}', now(), now()),
  ('ee100000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'shipment-operator@example.invalid', '{}', '{}', now(), now()),
  ('ee100000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'shipment-manager@example.invalid', '{}', '{}', now(), now());
update public.profiles set status = 'active' where id in ('ee100000-0000-4000-8000-000000000001', 'ee100000-0000-4000-8000-000000000002', 'ee100000-0000-4000-8000-000000000003');
insert into public.user_roles(user_id, role) values ('ee100000-0000-4000-8000-000000000002', 'operational'), ('ee100000-0000-4000-8000-000000000003', 'manager');
insert into public.orders(id, public_code, customer_id, customer_email_snapshot, customer_name_snapshot, status, payment_status, subtotal, grand_total, shipping_address_snapshot)
values ('ee200000-0000-4000-8000-000000000001', 'SHIPMENT-FIXTURE', 'ee100000-0000-4000-8000-000000000001', 'shipment-customer@example.invalid', 'Fixture', 'pending_payment', 'pending', 50, 50, '{}');
insert into public.shipments(id, order_id, provider, service, shipping_cost)
values ('ee300000-0000-4000-8000-000000000001', 'ee200000-0000-4000-8000-000000000001', 'fixture', 'fixture', 7);
select ok(not has_column_privilege('authenticated', 'public.shipments', 'shipping_cost', 'select'), 'authenticated users cannot read carrier cost directly');
select ok(has_column_privilege('service_role', 'public.shipments', 'shipping_cost', 'select'), 'server service retains carrier cost access');
select ok(not has_function_privilege('anon', 'public.operational_read_shipment_costs(uuid[])', 'execute'), 'anonymous callers cannot execute cost reader');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"ee100000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select count(*) from public.shipments where id='ee300000-0000-4000-8000-000000000001'), 1::bigint, 'customer retains shipment tracking access');
select throws_ok($$select shipping_cost from public.shipments limit 1$$, '42501', null, 'customer cannot query carrier cost');
select throws_ok($$select * from public.shipments limit 1$$, '42501', null, 'wildcard does not bypass cost restriction');
select throws_ok($$select * from public.operational_read_shipment_costs(array['ee300000-0000-4000-8000-000000000001'::uuid])$$, '42501', null, 'customer cannot call operational cost reader');
select set_config('request.jwt.claims', '{"sub":"ee100000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok($$select * from public.operational_read_shipment_costs(array['ee300000-0000-4000-8000-000000000001'::uuid])$$, '42501', null, 'manager without operational role cannot call cost reader');
select set_config('request.jwt.claims', '{"sub":"ee100000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select shipping_cost from public.operational_read_shipment_costs(array['ee300000-0000-4000-8000-000000000001'::uuid])), 7::numeric, 'authorized operator reads carrier cost');
select throws_ok($$select * from public.operational_read_shipment_costs(null)$$, '22023', null, 'null batch is rejected');
select throws_ok($$select * from public.operational_read_shipment_costs(array_fill('ee300000-0000-4000-8000-000000000001'::uuid, array[501]))$$, '22023', null, 'oversized batch is rejected');
reset role;
insert into public.user_permission_overrides(user_id, permission_id, allowed, reason, created_by)
select 'ee100000-0000-4000-8000-000000000002', id, false, 'security fixture', 'ee100000-0000-4000-8000-000000000002'
from public.permissions where code = 'orders.read_assigned';
set local role authenticated;
select throws_ok($$select * from public.operational_read_shipment_costs(array['ee300000-0000-4000-8000-000000000001'::uuid])$$, '42501', null, 'explicit order denial prevents cost access');
reset role;
delete from public.user_permission_overrides where user_id = 'ee100000-0000-4000-8000-000000000002';
update public.profiles set status = 'suspended' where id = 'ee100000-0000-4000-8000-000000000002';
set local role authenticated;
select throws_ok($$select * from public.operational_read_shipment_costs(array['ee300000-0000-4000-8000-000000000001'::uuid])$$, '42501', null, 'suspended operator cannot read costs');
reset role;
update public.profiles set status = 'active', account_closed_at = now() where id = 'ee100000-0000-4000-8000-000000000002';
set local role authenticated;
select throws_ok($$select * from public.operational_read_shipment_costs(array['ee300000-0000-4000-8000-000000000001'::uuid])$$, '42501', null, 'closed account cannot read costs');
reset role;
set local role service_role;
select is((select shipping_cost from public.shipments where id='ee300000-0000-4000-8000-000000000001'), 7::numeric, 'service retains direct cost access');
reset role;
select * from finish();
rollback;

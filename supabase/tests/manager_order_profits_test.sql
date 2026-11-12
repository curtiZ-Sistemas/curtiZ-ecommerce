begin;
create extension if not exists pgtap with schema extensions;
select plan(11);
insert into auth.users(id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('ec100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'profit-manager@example.invalid', '{}', '{}', now(), now()),
  ('ec100000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'profit-customer@example.invalid', '{}', '{}', now(), now()),
  ('ec100000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'profit-operator@example.invalid', '{}', '{}', now(), now());
update public.profiles set status = 'active' where id in ('ec100000-0000-4000-8000-000000000001', 'ec100000-0000-4000-8000-000000000002', 'ec100000-0000-4000-8000-000000000003');
insert into public.user_roles(user_id, role) values ('ec100000-0000-4000-8000-000000000001', 'manager'), ('ec100000-0000-4000-8000-000000000003', 'operational');
insert into public.orders(id, public_code, customer_id, customer_email_snapshot, customer_name_snapshot, status, payment_status, subtotal, grand_total, estimated_profit, shipping_address_snapshot)
values ('ec200000-0000-4000-8000-000000000001', 'PROFIT-FIXTURE', 'ec100000-0000-4000-8000-000000000002', 'profit-customer@example.invalid', 'Fixture', 'pending_payment', 'pending', 50, 50, 15, '{}');

select ok(not has_function_privilege('anon', 'public.manager_read_order_profits(uuid[])', 'execute'), 'anonymous callers cannot execute profit reader');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"ec100000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok($$select * from public.manager_read_order_profits(array['ec200000-0000-4000-8000-000000000001'::uuid])$$, '42501', null, 'customer cannot read manager profits');
select set_config('request.jwt.claims', '{"sub":"ec100000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok($$select * from public.manager_read_order_profits(array['ec200000-0000-4000-8000-000000000001'::uuid])$$, '42501', null, 'operator cannot read manager profits');
select set_config('request.jwt.claims', '{"sub":"ec100000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select estimated_profit from public.manager_read_order_profits(array['ec200000-0000-4000-8000-000000000001'::uuid])), 15::numeric, 'authorized manager reads profit');
select is((select count(*) from public.manager_read_order_profits(array[]::uuid[])), 0::bigint, 'empty batch returns no rows');
select throws_ok($$select * from public.manager_read_order_profits(null)$$, '22023', null, 'null batch is rejected');
select throws_ok($$select * from public.manager_read_order_profits(array_fill('ec200000-0000-4000-8000-000000000001'::uuid, array[501]))$$, '22023', null, 'oversized batch is rejected');
reset role;
insert into public.user_permission_overrides(user_id, permission_id, allowed, reason, created_by)
select 'ec100000-0000-4000-8000-000000000001', id, false, 'security fixture', 'ec100000-0000-4000-8000-000000000001'
from public.permissions where code = 'financial.read_summary';
set local role authenticated;
select throws_ok($$select * from public.manager_read_order_profits(array['ec200000-0000-4000-8000-000000000001'::uuid])$$, '42501', null, 'explicit financial denial is respected');
reset role;
delete from public.user_permission_overrides where user_id = 'ec100000-0000-4000-8000-000000000001';
insert into public.user_permission_overrides(user_id, permission_id, allowed, reason, created_by)
select 'ec100000-0000-4000-8000-000000000001', id, false, 'security fixture', 'ec100000-0000-4000-8000-000000000001'
from public.permissions where code = 'orders.read_all';
set local role authenticated;
select throws_ok($$select * from public.manager_read_order_profits(array['ec200000-0000-4000-8000-000000000001'::uuid])$$, '42501', null, 'explicit order access denial is respected');
reset role;
delete from public.user_permission_overrides where user_id = 'ec100000-0000-4000-8000-000000000001';
update public.profiles set status = 'suspended' where id = 'ec100000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select * from public.manager_read_order_profits(array['ec200000-0000-4000-8000-000000000001'::uuid])$$, '42501', null, 'suspended manager is denied');
reset role;
update public.profiles set status = 'active', account_closed_at = now() where id = 'ec100000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select * from public.manager_read_order_profits(array['ec200000-0000-4000-8000-000000000001'::uuid])$$, '42501', null, 'closed account cannot read profits');
reset role;
select * from finish();
rollback;

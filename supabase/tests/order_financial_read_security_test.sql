begin;
create extension if not exists pgtap with schema extensions;
select plan(12);
insert into auth.users(id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('ed100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'finance-customer@example.invalid', '{}', '{}', now(), now()),
  ('ed100000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'finance-manager@example.invalid', '{}', '{}', now(), now());
update public.profiles set status = 'active' where id in ('ed100000-0000-4000-8000-000000000001', 'ed100000-0000-4000-8000-000000000002');
insert into public.user_roles(user_id, role) values ('ed100000-0000-4000-8000-000000000002', 'manager');
insert into public.orders(id, public_code, customer_id, customer_email_snapshot, customer_name_snapshot, status, payment_status, subtotal, grand_total, shipping_cost, cost_total, estimated_profit, shipping_address_snapshot, placed_at)
values ('ed200000-0000-4000-8000-000000000001', 'FINANCE-FIXTURE', 'ed100000-0000-4000-8000-000000000001', 'finance-customer@example.invalid', 'Fixture', 'delivered', 'approved', 50, 50, 5, 20, 25, '{}', '2052-01-15T12:00:00Z');

select ok(not has_column_privilege('authenticated', 'public.orders', 'shipping_cost', 'select'), 'customers cannot read internal shipping cost');
select ok(not has_column_privilege('authenticated', 'public.orders', 'cost_total', 'select'), 'customers cannot read order costs');
select ok(not has_column_privilege('authenticated', 'public.orders', 'estimated_profit', 'select'), 'customers cannot read order profit');
select ok(has_column_privilege('service_role', 'public.orders', 'estimated_profit', 'select'), 'service retains order profit access');
select ok(not has_table_privilege('authenticated', 'private.reporting_orders_financial', 'select'), 'internal reporting view is not directly accessible');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"ed100000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select grand_total from public.orders where id = 'ed200000-0000-4000-8000-000000000001'), 50::numeric, 'customer can still read their order total');
select throws_ok($$select estimated_profit from public.orders limit 1$$, '42501', null, 'direct profit read is denied');
select throws_ok($$select * from public.orders limit 1$$, '42501', null, 'wildcard queries cannot bypass restrictions');
select is((select estimated_profit from public.reporting_orders where id = 'ed200000-0000-4000-8000-000000000001'), null::numeric, 'public reporting view redacts profit');
select is((select cost_total from public.reporting_orders where id = 'ed200000-0000-4000-8000-000000000001'), null::numeric, 'public reporting view redacts cost');
select throws_ok($$select * from private.reporting_orders_financial limit 1$$, '42501', null, 'customer cannot select the internal view');
select set_config('request.jwt.claims', '{"sub":"ed100000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((public.manager_dashboard_metrics('2052-01-01','2052-01-31')->>'estimated_profit_cents')::bigint, 2500::bigint, 'authorized dashboard retains estimated profit');
reset role;
select * from finish();
rollback;

begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users(id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('eb100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cost-test@example.invalid', '{}', '{}', now(), now()),
  ('eb100000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cost-test-other@example.invalid', '{}', '{}', now(), now());
update public.profiles set status = 'active' where id in ('eb100000-0000-4000-8000-000000000001', 'eb100000-0000-4000-8000-000000000002');
insert into public.products(id, name, slug, status, base_price)
values ('eb200000-0000-4000-8000-000000000001', 'Fixture', 'order-item-cost-fixture', 'draft', 50);
insert into public.product_variants(id, product_id, sku, color_name, size)
values ('eb300000-0000-4000-8000-000000000001', 'eb200000-0000-4000-8000-000000000001', 'COST-FIXTURE', 'Blue', '36');
insert into public.orders(id, public_code, customer_id, customer_email_snapshot, customer_name_snapshot, status, payment_status, subtotal, grand_total, shipping_address_snapshot)
values
  ('eb400000-0000-4000-8000-000000000001', 'COST-FIXTURE', 'eb100000-0000-4000-8000-000000000001', 'cost-test@example.invalid', 'Fixture', 'pending_payment', 'pending', 50, 50, '{}'),
  ('eb400000-0000-4000-8000-000000000002', 'COST-FIXTURE-OTHER', 'eb100000-0000-4000-8000-000000000002', 'cost-test-other@example.invalid', 'Fixture', 'pending_payment', 'pending', 50, 50, '{}');
insert into public.order_items(id, order_id, product_id, variant_id, product_name_snapshot, sku_snapshot, color_snapshot, size_snapshot, quantity, unit_price, total, unit_cost_snapshot)
values
  ('eb500000-0000-4000-8000-000000000001', 'eb400000-0000-4000-8000-000000000001', 'eb200000-0000-4000-8000-000000000001', 'eb300000-0000-4000-8000-000000000001', 'Fixture', 'COST-FIXTURE', 'Blue', '36', 1, 50, 50, 20),
  ('eb500000-0000-4000-8000-000000000002', 'eb400000-0000-4000-8000-000000000002', 'eb200000-0000-4000-8000-000000000001', 'eb300000-0000-4000-8000-000000000001', 'Fixture', 'COST-FIXTURE', 'Blue', '36', 1, 50, 50, 20);

select ok(not has_column_privilege('anon', 'public.order_items', 'unit_cost_snapshot', 'select'), 'anonymous users cannot read item costs');
select ok(not has_column_privilege('authenticated', 'public.order_items', 'unit_cost_snapshot', 'select'), 'authenticated users cannot read item costs directly');
select ok(has_column_privilege('authenticated', 'public.order_items', 'unit_price', 'select'), 'customers retain access to sale prices');
select ok(has_column_privilege('service_role', 'public.order_items', 'unit_cost_snapshot', 'select'), 'server service retains access to item costs');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"eb100000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select unit_price from public.order_items where id = 'eb500000-0000-4000-8000-000000000001'), 50::numeric, 'customer can read their own item sale price');
select is((select count(*) from public.order_items where id = 'eb500000-0000-4000-8000-000000000002'), 0::bigint, 'customer cannot read another customer item');
select throws_ok($$select unit_cost_snapshot from public.order_items limit 1$$, '42501', null, 'direct queries cannot read item costs');
select throws_ok($$select * from public.order_items limit 1$$, '42501', null, 'wildcard queries cannot bypass the item cost restriction');
reset role;
set local role service_role;
select is((select unit_cost_snapshot from public.order_items where id = 'eb500000-0000-4000-8000-000000000001'), 20::numeric, 'server service can still read item cost');
reset role;

select * from finish();
rollback;

begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users(id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('eb100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cost-admin@example.invalid', '{}', '{}', now(), now()),
  ('eb100000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cost-customer@example.invalid', '{}', '{}', now(), now()),
  ('eb100000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cost-manager@example.invalid', '{}', '{}', now(), now());
update public.profiles set status = 'active' where id in ('eb100000-0000-4000-8000-000000000001', 'eb100000-0000-4000-8000-000000000002', 'eb100000-0000-4000-8000-000000000003');
insert into public.user_roles(user_id, role) values ('eb100000-0000-4000-8000-000000000001', 'admin'), ('eb100000-0000-4000-8000-000000000003', 'manager');
insert into public.categories(id, name, slug) values ('eb200000-0000-4000-8000-000000000001', 'Cost fixture', 'cost-fixture');
insert into public.products(id, name, slug, category_id, status, base_price, cost_price, description, weight_grams, height_cm, width_cm, length_cm)
values ('eb300000-0000-4000-8000-000000000001', 'Cost fixture', 'cost-fixture', 'eb200000-0000-4000-8000-000000000001', 'draft', 50, 20, 'Fixture', 100, 5, 10, 20);
insert into public.product_variants(id, product_id, sku, color_name, size, cost_override)
values ('eb400000-0000-4000-8000-000000000001', 'eb300000-0000-4000-8000-000000000001', 'COST-FIXTURE', 'Preto', '37', 18);

select ok(not has_function_privilege('anon', 'public.admin_read_catalog_costs(uuid[])', 'execute'), 'anonymous callers cannot execute cost reader');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"eb100000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok($$select * from public.admin_read_catalog_costs(array['eb300000-0000-4000-8000-000000000001'::uuid])$$, '42501', null, 'customer cannot read costs through RPC');
select set_config('request.jwt.claims', '{"sub":"eb100000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok($$select * from public.admin_read_catalog_costs(array['eb300000-0000-4000-8000-000000000001'::uuid])$$, '42501', null, 'manager cannot call admin cost reader');
select set_config('request.jwt.claims', '{"sub":"eb100000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((public.admin_read_catalog_costs(array['eb300000-0000-4000-8000-000000000001'::uuid])->0->>'product_cost')::numeric, 20::numeric, 'authorized editor reads product cost');
select is((public.admin_read_catalog_costs(array['eb300000-0000-4000-8000-000000000001'::uuid])->0->'variants'->>'eb400000-0000-4000-8000-000000000001')::numeric, 18::numeric, 'authorized editor reads variant cost');
select throws_ok($$select * from public.admin_read_catalog_costs(null)$$, '22023', null, 'null batch is rejected');
select throws_ok($$select * from public.admin_read_catalog_costs(array_fill('eb300000-0000-4000-8000-000000000001'::uuid, array[501]))$$, '22023', null, 'oversized batch is rejected');
select is(public.admin_read_catalog_costs(array[]::uuid[]), '[]'::jsonb, 'empty batch returns no costs');
reset role;
update public.profiles set status = 'suspended' where id = 'eb100000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select * from public.admin_read_catalog_costs(array['eb300000-0000-4000-8000-000000000001'::uuid])$$, '42501', null, 'suspended administrator cannot read costs');
reset role;
select * from finish();
rollback;

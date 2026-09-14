begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into public.categories(id, name, slug) values
 ('f1400000-0000-4000-8000-000000000001', 'Public permissions test', 'public-permissions-test');
insert into public.products(id, name, slug, category_id, status, base_price, description, weight_grams, height_cm, width_cm, length_cm) values
 ('f1400000-0000-4000-8000-000000000002', 'Public test', 'public-permissions-active', 'f1400000-0000-4000-8000-000000000001', 'active', 50, 'Test', 100, 5, 10, 20),
 ('f1400000-0000-4000-8000-000000000003', 'Private test', 'public-permissions-draft', 'f1400000-0000-4000-8000-000000000001', 'draft', 50, 'Test', 100, 5, 10, 20);
insert into public.product_size_guide_entries(product_id, size, measurement_cm) values
 ('f1400000-0000-4000-8000-000000000002', '37', 24),
 ('f1400000-0000-4000-8000-000000000003', '37', 24);

select ok(not has_table_privilege('anon', 'public.products', 'select'), 'No table-wide product SELECT');
select ok(not has_column_privilege('anon', 'public.products', 'cost_price', 'select'), 'Costs remain private');
select ok(not has_schema_privilege('anon', 'private', 'usage'), 'Private schema stays inaccessible');
select ok(not has_table_privilege('anon', 'private.customer_checkout_identity', 'select'), 'Checkout identity remains private');

set local role anon;
select lives_ok($$select public.get_catalog_product('public-permissions-active')$$, 'Public product RPC remains callable');
select is((select count(*) from public.products where id = 'f1400000-0000-4000-8000-000000000002'), 1::bigint, 'Active product visible');
select is((select count(*) from public.products where id = 'f1400000-0000-4000-8000-000000000003'), 0::bigint, 'Draft product hidden');
select is((select count(*) from public.product_size_guide_entries where product_id = 'f1400000-0000-4000-8000-000000000002'), 1::bigint, 'Active guide readable without 42501');
select is((select count(*) from public.product_size_guide_entries where product_id = 'f1400000-0000-4000-8000-000000000003'), 0::bigint, 'Draft guide hidden');
select lives_ok($$select id,variant_id,media_type,storage_path,thumbnail_path,alt_text,mime_type,sort_order from public.product_media where product_id = 'f1400000-0000-4000-8000-000000000002' order by sort_order limit 60$$, 'Exact public media query has the required privileges');
reset role;
select * from finish();
rollback;

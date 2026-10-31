begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select ok(not has_function_privilege('anon','public.read_bling_external_mappings(bigint[])','execute'),'External mapping lookup is private');
select ok(not has_function_privilege('authenticated','public.read_bling_external_mappings(bigint[])','execute'),'Browser cannot bypass technical authorization');
select is(public.read_bling_external_mappings(array[1::bigint]),'[]'::jsonb,'No provider records are seeded');
insert into public.products(id,name,slug,status,base_price)
values('bc910000-0000-4000-8000-000000000001','Isolated SKU fixture','isolated-external-sku','draft',23.90);
insert into public.product_variants(id,product_id,sku,color_name,size)
values('bc910000-0000-4000-8000-000000000002','bc910000-0000-4000-8000-000000000001',repeat('LONG-',15),'Blue','37');
select is(public.match_bling_products(jsonb_build_array(jsonb_build_object('sku',repeat('LONG-',15),'externalProductId',1001))),1,'Long SKU can retain a product ID with a stable alias');
select is(public.read_bling_product_link('bc910000-0000-4000-8000-000000000002')->>'sku',repeat('LONG-',15),'Local SKU remains intact');
select is(public.read_bling_product_link('bc910000-0000-4000-8000-000000000002')->>'external_sku','CZ-bc910000000040008000000000000002','External alias fits provider input without truncation');
select is(public.read_bling_external_mappings(array[1001::bigint])->0->>'variantId','bc910000-0000-4000-8000-000000000002','External ID resolves to original variant');
select is(public.match_bling_products(jsonb_build_array(jsonb_build_object('sku',repeat('LONG-',15),'externalProductId',1001))),1,'Repeated mapping is idempotent');
select is((select count(*) from private.bling_product_links),1::bigint,'No duplicate link created');
select throws_ok($$select public.match_bling_products(jsonb_build_array(jsonb_build_object('sku',repeat('LONG-',15),'externalProductId',1002)))$$,'P0001','sku_link_conflict','Cannot replace acknowledged external ID');
select throws_ok($$select public.match_bling_products(jsonb_build_array(jsonb_build_object('sku',repeat('LONG-',15),'externalProductId',1001,'externalSku','incorrect')))$$,'P0001','external_sku_conflict','Cannot submit an arbitrary external alias');
select * from finish();
rollback;

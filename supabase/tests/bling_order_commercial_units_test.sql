begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select ok(not has_function_privilege('authenticated','public.read_bling_product_links(uuid[])','execute'),'Order metadata cannot bypass server authorization');
insert into public.products(id,name,slug,status,base_price)
values('bc920000-0000-4000-8000-000000000001','Isolated unit fixture','isolated-order-unit','draft',23.90);
insert into public.product_variants(id,product_id,sku,color_name,size)
values('bc920000-0000-4000-8000-000000000002','bc920000-0000-4000-8000-000000000001','ORDER-UNIT-37','Blue','37');
select is(public.match_bling_products('[{"sku":"ORDER-UNIT-37","externalProductId":1201}]'),1,'Existing local SKU is linked');
select is(public.read_bling_product_links(array['bc920000-0000-4000-8000-000000000002'::uuid])->0->>'commercialUnit',null::text,'No unit is guessed when reviewed metadata is missing');
insert into private.bling_catalog_metadata(product_id,commercial_unit,pairs_per_sku,ncm,origin,production_type,evidence_reference)
values('bc920000-0000-4000-8000-000000000001','PR',1,'64022000',0,'T','Isolated pair unit approval');
select is(public.read_bling_product_links(array['bc920000-0000-4000-8000-000000000002'::uuid])->0->>'commercialUnit','PR','Individual pair unit reaches the backend order payload');
update private.bling_catalog_metadata set commercial_unit='UN',pairs_per_sku=2 where product_id='bc920000-0000-4000-8000-000000000001';
select is(public.read_bling_product_links(array['bc920000-0000-4000-8000-000000000002'::uuid])->0->>'commercialUnit','UN','A kit retains its separate commercial unit');
select is(public.read_bling_product_links(array['bc920000-0000-4000-8000-000000000002'::uuid])->0->>'sku','ORDER-UNIT-37','Unit changes do not change the SKU');
select * from finish();
rollback;

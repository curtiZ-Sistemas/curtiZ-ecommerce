-- Synthetic fixtures only, transaction rolled back. No B2C order/provider calls.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,instance_id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('a1000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','resale-isolated@example.invalid','{}','{}',now(),now()),
('a1000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','resale-other@example.invalid','{}','{}',now(),now());
update public.profiles set status='active' where id in('a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002');
insert into public.representative_applications(id,user_id) values('a1100000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001');
insert into public.representatives(id,user_id,application_id,status) values('a1200000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','a1100000-0000-4000-8000-000000000001','active');
insert into public.categories(id,name,slug) values('a1300000-0000-4000-8000-000000000001','Resale fixture','resale-isolated-fixture');
insert into public.products(id,name,slug,short_description,description,category_id,status,base_price,weight_grams,height_cm,width_cm,length_cm)
values('a1400000-0000-4000-8000-000000000001','Resale synthetic kit','resale-synthetic-kit','Fixture','Fixture','a1300000-0000-4000-8000-000000000001','draft',43.45,100,5,10,20);
insert into public.product_variants(id,product_id,sku,color_name,size,active)
values('a1500000-0000-4000-8000-000000000001','a1400000-0000-4000-8000-000000000001','RESALE-OWN-STOCK-KIT','Fixture','39',true);
insert into public.inventory(variant_id,available_quantity,reserved_quantity) values('a1500000-0000-4000-8000-000000000001',3,0);
insert into private.bling_catalog_metadata(product_id,commercial_unit,pairs_per_sku,ncm,origin,cest,production_type,evidence_reference)
values('a1400000-0000-4000-8000-000000000001','UN',2,'64022000',0,'','T','Synthetic isolated test only');
insert into public.product_images(product_id,variant_id,storage_path,alt_text,width,height)
values('a1400000-0000-4000-8000-000000000001','a1500000-0000-4000-8000-000000000001','test/resale-catalog/fixture.webp','Synthetic isolated image',720,720);
update public.products set status='active' where id='a1400000-0000-4000-8000-000000000001';
insert into private.bling_kit_fiscal_components(kit_variant_id,position,sku,description,unit,quantity_pairs,allocation_weight,ncm,origin,cest,source_hash,evidence_reference)
select 'a1500000-0000-4000-8000-000000000001',n,'ISOLATED-CATALOG-PAIR-'||n,'Synthetic pair '||n,'PR',1,1,'64022000',0,'',private.bling_kit_source_hash('a1500000-0000-4000-8000-000000000001'),'Synthetic isolated test only' from generate_series(1,2)n;
select ok(not has_function_privilege('anon','public.list_representative_catalog_kits(integer)','execute'),'No anonymous catalog access');
select ok(not has_function_privilege('service_role','public.read_representative_catalog_kit_context(uuid,integer)','execute'),'No service role shortcut to representative identity');
select pg_catalog.set_config('request.jwt.claims','{"role":"authenticated","sub":"a1000000-0000-4000-8000-000000000001"}',true);
set local role authenticated;
select ok(jsonb_array_length(public.list_representative_catalog_kits(0)->'items') between 1 and 24,'Catalog page has a bounded size');
select is(public.list_representative_catalog_kits(0),public.list_representative_catalog_kits(0),'Catalog order is stable');
select ok(public.list_representative_catalog_kits(-1) is null,'Negative offset cannot broaden access');
select is(public.read_representative_catalog_kit_context('a1500000-0000-4000-8000-000000000001',3)->>'source','catalog','Direct catalog source without legacy offer');
select ok(public.read_representative_catalog_kit_context('a1500000-0000-4000-8000-000000000001',3)->'kitId'='null'::jsonb,'Does not invent a legacy kit offer');
select is((public.read_representative_catalog_kit_context('a1500000-0000-4000-8000-000000000001',3)->>'merchandiseTotalInCents')::bigint,13035::bigint,'Saved price times selected quantity exactly');
select is(public.read_representative_catalog_kit_context('a1500000-0000-4000-8000-000000000001',3)->'items'->0->>'sku','RESALE-OWN-STOCK-KIT','Existing commercial SKU preserved');
select is((public.read_representative_catalog_kit_context('a1500000-0000-4000-8000-000000000001',3)->'items'->0->>'available')::integer,3,'Existing stock preserved');
select is(jsonb_array_length(public.read_representative_catalog_kit_context('a1500000-0000-4000-8000-000000000001',3)->'items'->0->'composition'),2,'Existing fiscal pairs reused');
select ok((public.read_representative_catalog_kit_context('a1500000-0000-4000-8000-000000000001',3)->'items'->0->'composition'->0->>'source_current')::boolean,'Current fiscal composition verified');
select ok(public.read_representative_catalog_kit_context('a1500000-0000-4000-8000-000000000001',0) is null,'Zero quantity rejected');
select ok(public.read_representative_catalog_kit_context('a1500000-0000-4000-8000-000000000001',100) is null,'Unbounded quantity rejected');
reset role;
update public.product_variants set active=false where id='a1500000-0000-4000-8000-000000000001';
set local role authenticated;
select ok(public.read_representative_catalog_kit_context('a1500000-0000-4000-8000-000000000001',1) is null,'Inactive SKU unavailable');
reset role;
update public.product_variants set active=true where id='a1500000-0000-4000-8000-000000000001';
select is((select count(*) from public.kit_items where variant_id='a1500000-0000-4000-8000-000000000001'),0::bigint,'No commercial offer mapping required or seeded');
select is((select available_quantity from public.inventory where variant_id='a1500000-0000-4000-8000-000000000001'),3,'No stock deduction');
select is((select reserved_quantity from public.inventory where variant_id='a1500000-0000-4000-8000-000000000001'),0,'No stock reservation');
select pg_catalog.set_config('request.jwt.claims','{"role":"authenticated","sub":"a1000000-0000-4000-8000-000000000002"}',true);
set local role authenticated;
select ok(public.list_representative_catalog_kits(0) is null,'Customer without representative access rejected');
select ok(public.read_representative_catalog_kit_context('a1500000-0000-4000-8000-000000000001',1) is null,'Customer cannot request resale context');
reset role;
select * from finish();
rollback;
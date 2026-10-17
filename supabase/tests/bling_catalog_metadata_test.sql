begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select ok(not has_table_privilege('authenticated','private.bling_catalog_metadata','select'),'Reviewed fiscal metadata stays private');
select ok(not has_function_privilege('authenticated','public.read_bling_catalog_variant(uuid)','execute'),'Catalogue snapshot is backend only');
select ok(not has_function_privilege('anon','public.claim_bling_catalog_job(uuid,boolean,boolean,boolean)','execute'),'Anonymous callers cannot process catalogue');
select ok(not has_function_privilege('authenticated','public.claim_bling_catalog_job(uuid,boolean,boolean,boolean)','execute'),'Client cannot bypass the technical API');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='private.bling_catalog_metadata'::regclass),'New private table has forced RLS');

insert into public.products(id,name,slug,status,base_price,cost_price,weight_grams,height_cm,width_cm,length_cm)
values('bc100000-0000-4000-8000-000000000001','Catalogue test','bling-catalogue-test','draft',30,8.35,300,6,20,30);
insert into public.product_variants(id,product_id,sku,color_name,size,active)
values('bc200000-0000-4000-8000-000000000001','bc100000-0000-4000-8000-000000000001','CATALOGUE-TEST-37','Azul','37',true);
insert into public.inventory(variant_id,available_quantity,reserved_quantity)
values('bc200000-0000-4000-8000-000000000001',45,5);
insert into private.bling_catalog_metadata(product_id,commercial_unit,pairs_per_sku,ncm,origin,production_type,evidence_reference)
values('bc100000-0000-4000-8000-000000000001','PR',1,'64022000',0,'T','Isolated test approval');
select is(public.read_bling_catalog_variant('bc200000-0000-4000-8000-000000000001')->'metadata'->>'commercial_unit','PR','Snapshot includes entered pair unit');
select is((public.read_bling_catalog_variant('bc200000-0000-4000-8000-000000000001')->'inventory'->>'reserved_quantity')::integer,5,'Snapshot preserves existing reservations');
select is(public.match_bling_products('[{"sku":"CATALOGUE-TEST-37","externalProductId":934001}]'),1,'SKU link is stored');
select is(public.match_bling_products('[{"sku":"CATALOGUE-TEST-37","externalProductId":934001}]'),1,'Replayed link is idempotent');
select is((select count(*) from public.background_jobs where idempotency_key='bling:product:initial:bc200000-0000-4000-8000-000000000001'),1::bigint,'Matching never duplicates initial product job');

update public.product_variants set cost_override=9.55 where id='bc200000-0000-4000-8000-000000000001';
select is((select count(*) from public.background_jobs where idempotency_key like 'bling:product:bc200000-0000-4000-8000-000000000001:%'),1::bigint,'Variant cost change queues synchronization');
update public.products set cost_price=10.75 where id='bc100000-0000-4000-8000-000000000001';
select is((select count(*) from public.background_jobs where idempotency_key like 'bling:product:bc200000-0000-4000-8000-000000000001:%'),2::bigint,'Product cost change queues synchronization');
select is((select count(*) from public.background_jobs where idempotency_key like 'bling:cost:bc200000-0000-4000-8000-000000000001:%'),2::bigint,'Cost changes also enqueue the provider stock-cost operation');
select ok(public.mark_bling_stock_cost_synced('bc200000-0000-4000-8000-000000000001',1,50,9.55),'Matching physical stock and variant cost can be acknowledged');
select ok(not public.mark_bling_stock_cost_synced('bc200000-0000-4000-8000-000000000001',1,50,10.75),'Outdated parent cost cannot acknowledge an override');
select ok(not public.mark_bling_stock_cost_synced('bc200000-0000-4000-8000-000000000001',1,49,9.55),'Outdated physical stock cannot be acknowledged');
insert into public.product_images(product_id,storage_path,alt_text,width,height)
values('bc100000-0000-4000-8000-000000000001','products/test/bling-catalogue.webp','Test image',100,100);
select is((select count(*) from public.background_jobs where idempotency_key like 'bling:media:bc200000-0000-4000-8000-000000000001:%'),1::bigint,'Image change queues synchronization');
select is(jsonb_array_length(public.read_bling_catalog_variant('bc200000-0000-4000-8000-000000000001')->'imagePaths'),1,'Snapshot returns reviewed catalogue paths');
update private.bling_catalog_metadata set commercial_unit='UN',pairs_per_sku=2,fiscal_unit_approved=false
where product_id='bc100000-0000-4000-8000-000000000001';
select is((select count(*) from public.background_jobs where idempotency_key like 'bling:media:bc200000-0000-4000-8000-000000000001:%'),2::bigint,'Metadata change queues synchronization');

select is(public.claim_bling_catalog_job('bc300000-0000-4000-8000-000000000001',false,false,false),null::jsonb,'All write gates disabled prevents catalogue writes');
create temporary table catalogue_claim as select public.claim_bling_catalog_job('bc300000-0000-4000-8000-000000000001',true,true,true) job;
select ok((select job->>'jobType' in ('bling.product.sync','bling.stock.sync') from catalogue_claim),'Catalogue claim is restricted to catalogue');
select is(public.claim_bling_catalog_job('bc300000-0000-4000-8000-000000000002',true,true,true),null::jsonb,'Second batch cannot overlap the same global lease');
select is(public.claim_bling_job('bc300000-0000-4000-8000-000000000002',true,true,true,true,true,true,true),null::jsonb,'Cron shares the catalogue lease');
select ok(not public.finish_bling_job((select (job->>'id')::uuid from catalogue_claim),'bc300000-0000-4000-8000-000000000002','completed',null),'Wrong lease cannot acknowledge catalogue job');
select ok(public.finish_bling_job((select (job->>'id')::uuid from catalogue_claim),'bc300000-0000-4000-8000-000000000001','completed',null),'Correct lease completes catalogue job');
select is((select available_quantity+reserved_quantity from public.inventory where variant_id='bc200000-0000-4000-8000-000000000001'),50,'Processing catalogue never alters local physical balance');
select * from finish();
rollback;

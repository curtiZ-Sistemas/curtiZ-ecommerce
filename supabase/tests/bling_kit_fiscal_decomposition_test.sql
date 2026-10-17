begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select ok(not has_table_privilege('authenticated','private.bling_kit_fiscal_components','insert'),'Clients cannot invent composition');
select ok(not has_table_privilege('anon','private.bling_kit_fiscal_components','select'),'Composition evidence remains private');
select ok(not has_function_privilege('service_role','public.read_bling_catalog_variant_base(uuid)','execute'),'Cannot bypass composition boundary');
select ok(not has_function_privilege('authenticated','public.save_bling_automatic_mirror_approval(uuid,text,text,boolean,boolean)','execute'),'Browser cannot approve composed notes');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='private.bling_kit_fiscal_components'::regclass),'Composition forces RLS');
insert into public.categories(id,name,slug)values('bd200000-0000-4000-8000-000000000001','Fiscal kit test','fiscal-kit-test');
insert into public.products(id,name,slug,category_id,status,base_price,description)
values('bd200000-0000-4000-8000-000000000002','Kit test','fiscal-kit-test','bd200000-0000-4000-8000-000000000001','draft',55.94,'Test');
insert into public.product_variants(id,product_id,sku,color_name,size)
values('bd200000-0000-4000-8000-000000000003','bd200000-0000-4000-8000-000000000002','COMMERCIAL-KIT-TEST','White','37');
insert into public.inventory(variant_id,available_quantity,reserved_quantity)values('bd200000-0000-4000-8000-000000000003',48,2);
insert into private.bling_catalog_metadata(product_id,commercial_unit,pairs_per_sku,ncm,origin,cest,production_type,fiscal_unit_approved,evidence_reference)
values('bd200000-0000-4000-8000-000000000002','UN',3,'64022000',0,'','T',false,'Isolated test composition');
create temporary table kit_initial as select private.bling_fiscal_configuration_hash() hash,
  (select count(*) from public.inventory_movements) movements,
  (select count(*) from public.background_jobs where job_type='bling.stock.sync') stock_jobs;
insert into private.bling_kit_fiscal_components(kit_variant_id,position,sku,description,quantity_pairs,allocation_weight,ncm,origin,cest,source_hash,evidence_reference)
select 'bd200000-0000-4000-8000-000000000003',i,'FISCAL-COMPONENT-'||i,'Existing pair '||i,1,1,'64022000',0,'',
 private.bling_kit_source_hash('bd200000-0000-4000-8000-000000000003'),'Isolated composition evidence' from generate_series(1,3)i;
select is(jsonb_array_length(public.read_bling_catalog_variant('bd200000-0000-4000-8000-000000000003')->'kit_components'),3,'Three fiscal pairs are exposed separately');
select ok((public.read_bling_catalog_variant('bd200000-0000-4000-8000-000000000003')->'kit_components'->0->>'source_current')::boolean,'Composition bound to actual catalogue source');
select isnt(private.bling_fiscal_configuration_hash(),(select hash from kit_initial),'Composition changes invalidate configuration policy hash');
select is((select available_quantity from public.inventory where variant_id='bd200000-0000-4000-8000-000000000003'),48,'Composition preserves kit available stock');
select is((select reserved_quantity from public.inventory where variant_id='bd200000-0000-4000-8000-000000000003'),2,'Composition preserves kit reservation');
select is((select count(*)from public.inventory_movements),(select movements from kit_initial),'Fiscal decomposition creates no stock movement');
select is((select count(*)from public.background_jobs where job_type='bling.stock.sync'),(select stock_jobs from kit_initial),'Fiscal components enqueue no individual stock job');
update public.product_variants set color_name='Changed source' where id='bd200000-0000-4000-8000-000000000003';
select ok(not (public.read_bling_catalog_variant('bd200000-0000-4000-8000-000000000003')->'kit_components'->0->>'source_current')::boolean,'Catalogue changes invalidate previous composition evidence');
select throws_ok($$insert into private.bling_kit_fiscal_components(kit_variant_id,position,sku,description,unit,quantity_pairs,allocation_weight,ncm,origin,cest,source_hash,evidence_reference)
values('bd200000-0000-4000-8000-000000000003',4,'NO-UN','Invalid kit', 'UN',1,1,'64022000',0,'',repeat('a',64),'Isolated invalid fixture')$$,'23514',null,'Components cannot use closed-kit unit');
select * from finish();
rollback;

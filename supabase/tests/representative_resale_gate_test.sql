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
insert into public.kits(id,name,slug,description,price_in_cents,created_by)
values('a1600000-0000-4000-8000-000000000001','Resale fixture','resale-isolated-fixture','Synthetic isolated offer',4345,'a1000000-0000-4000-8000-000000000001');
insert into public.kit_items(kit_id,variant_id,quantity)
values('a1600000-0000-4000-8000-000000000001','a1500000-0000-4000-8000-000000000001',1);
-- One legacy order fixture, prepared only by the isolated test owner; gate is
-- reenabled BEFORE any permission/transition assertions below.
alter table public.kit_orders disable trigger representative_resale_homologation_gate;
insert into public.kit_orders(id,representative_id,kit_id,total_in_cents,kit_snapshot)
values('a1700000-0000-4000-8000-000000000001','a1200000-0000-4000-8000-000000000001','a1600000-0000-4000-8000-000000000001',4345,'{}');
alter table public.kit_orders enable trigger representative_resale_homologation_gate;

select ok(not has_function_privilege('anon','public.read_representative_resale_context(uuid)','execute'),'Anonymous cannot preview');
select ok(not has_function_privilege('service_role','public.read_representative_resale_context(uuid)','execute'),'No service-role shortcut to representative preview');
select pg_catalog.set_config('request.jwt.claims','{"role":"authenticated","sub":"a1000000-0000-4000-8000-000000000001"}',true);
set local role authenticated;
select is((public.read_representative_resale_context('a1600000-0000-4000-8000-000000000001')->>'merchandiseTotalInCents')::integer,4345,'Preview reads server offer price');
select is(public.read_representative_resale_context('a1600000-0000-4000-8000-000000000001')->'items'->0->>'sku','RESALE-OWN-STOCK-KIT','Commercial stock SKU preserved');
select is((public.read_representative_resale_context('a1600000-0000-4000-8000-000000000001')->'items'->0->>'available')::integer,3,'Own commercial stock only');
select ok(public.read_representative_resale_context('a1600000-0000-4000-8000-000000000001')->'items'->0->'allocationWeight'='null'::jsonb,'No allocation weight invented');
select throws_ok($$select public.create_representative_kit_order('a1600000-0000-4000-8000-000000000001','resale-isolated-idempotency-1')$$,'23514','resale_not_homologated','Legacy RPC cannot create sale before homologation');
select throws_ok($$insert into public.kit_orders(representative_id,kit_id,total_in_cents,kit_snapshot)values('a1200000-0000-4000-8000-000000000001','a1600000-0000-4000-8000-000000000001',1,'{}')$$,'23514','resale_not_homologated','Direct RLS-owned insert cannot forge price and bypass gate');
reset role;
select throws_ok($$update public.kit_orders set status='paid' where id='a1700000-0000-4000-8000-000000000001'$$,'23514','resale_not_homologated','Cannot mark legacy order paid');
select throws_ok($$update public.kit_orders set status='delivered' where id='a1700000-0000-4000-8000-000000000001'$$,'23514','resale_not_homologated','Cannot deliver and trigger representative inventory');
select throws_ok($$update public.kit_orders set payment_reference='synthetic' where id='a1700000-0000-4000-8000-000000000001'$$,'23514','resale_not_homologated','Cannot attach a payment while gate is closed');
select lives_ok($$update public.kit_orders set status='cancelled' where id='a1700000-0000-4000-8000-000000000001'$$,'Existing cancellation remains possible');
select is((select available_quantity from public.inventory where variant_id='a1500000-0000-4000-8000-000000000001'),3,'No commercial stock deduction');
select is((select count(*) from public.representative_inventory where representative_id='a1200000-0000-4000-8000-000000000001'),0::bigint,'No fiscal-pair or avulso stock invented');
select is((select count(*) from public.kit_orders where representative_id='a1200000-0000-4000-8000-000000000001'),1::bigint,'Blocked calls created no extra orders');
set local role service_role;
select throws_ok($$insert into public.kit_orders(representative_id,kit_id,total_in_cents,kit_snapshot)values('a1200000-0000-4000-8000-000000000001','a1600000-0000-4000-8000-000000000001',4345,'{}')$$,'23514','resale_not_homologated','Service role cannot bypass homologation gate');
reset role;
update public.profiles set status='suspended' where id='a1000000-0000-4000-8000-000000000001';
set local role authenticated;
select ok(public.read_representative_resale_context('a1600000-0000-4000-8000-000000000001') is null,'Inactive profile cannot preview');
reset role;
update public.profiles set status='active' where id='a1000000-0000-4000-8000-000000000001';
select pg_catalog.set_config('request.jwt.claims','{"role":"authenticated","sub":"a1000000-0000-4000-8000-000000000002"}',true);
set local role authenticated;
select ok(public.read_representative_resale_context('a1600000-0000-4000-8000-000000000001') is null,'Customer role/profile does not imply representative');
reset role;
update public.representatives set status='suspended' where id='a1200000-0000-4000-8000-000000000001';
select pg_catalog.set_config('request.jwt.claims','{"role":"authenticated","sub":"a1000000-0000-4000-8000-000000000001"}',true);
set local role authenticated;
select ok(public.read_representative_resale_context('a1600000-0000-4000-8000-000000000001') is null,'Suspended representative cannot preview');
reset role;
select * from finish();
rollback;

begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

insert into public.categories(id,name,slug) values
 ('de160000-0000-4000-8000-000000000001','Net stock fixture','net-stock-fixture');
insert into public.products(id,name,slug,category_id,status,base_price,description,weight_grams,height_cm,width_cm,length_cm) values
 ('de160000-0000-4000-8000-000000000002','Net Stock Fixture','net-stock-fixture','de160000-0000-4000-8000-000000000001','draft',50,'Net stock fixture',100,5,10,20);
insert into public.product_categories(product_id,category_id,is_primary) values
 ('de160000-0000-4000-8000-000000000002','de160000-0000-4000-8000-000000000001',true) on conflict(product_id,category_id) do nothing;
insert into public.product_images(product_id,storage_path,alt_text,width,height,is_primary) values
 ('de160000-0000-4000-8000-000000000002','products/net-stock-fixture/fixture.webp','Net stock fixture',720,720,true);
update public.products set status='active' where id='de160000-0000-4000-8000-000000000002';
insert into public.product_variants(id,product_id,sku,color_name,size) values
 ('de160000-0000-4000-8000-000000000003','de160000-0000-4000-8000-000000000002','NET-STOCK-FIXTURE','Preto','37');
insert into public.inventory(variant_id,available_quantity,reserved_quantity) values
 ('de160000-0000-4000-8000-000000000003',2,0)
 on conflict(variant_id) do update set available_quantity=excluded.available_quantity,reserved_quantity=excluded.reserved_quantity;
insert into public.carts(id,anonymous_token_hash) values
 ('de160000-0000-4000-8000-000000000004','net-stock-fixture');

select is((select available_quantity+reserved_quantity from public.inventory where variant_id='de160000-0000-4000-8000-000000000003'),2,'Fixture starts with two physical units');
select lives_ok($$select private.reserve_inventory('de160000-0000-4000-8000-000000000004','de160000-0000-4000-8000-000000000003',1,now()+interval '30 minutes')$$,'Real reservation succeeds');
select is((select available_quantity from public.inventory where variant_id='de160000-0000-4000-8000-000000000003'),1,'One unit remains available');
select is((select reserved_quantity from public.inventory where variant_id='de160000-0000-4000-8000-000000000003'),1,'One unit is reserved');
set local role anon;
select is((public.get_catalog_product('net-stock-fixture')->>'stock')::integer,1,'Public detail does not subtract the reservation again');
select is((public.get_catalog_product('net-stock-fixture')->'variants'->0->>'stock')::integer,1,'Variant detail reports net availability');
select is((public.search_catalog(p_category=>'net-stock-fixture',p_in_stock=>true,p_colors=>array['Preto'],p_sizes=>array['37'])->>'total')::integer,1,'Stock filter still finds the last available unit');
select is((public.search_catalog_page(p_category=>'net-stock-fixture',p_in_stock=>true,p_colors=>array['Preto'],p_sizes=>array['37'])->>'total')::integer,1,'Fast catalog filter still finds the last available unit');
select is((select count(*) from jsonb_array_elements(public.search_catalog(p_category=>'net-stock-fixture')->'facets'->'colors') option where option->>'value'='Preto'),1::bigint,'Facet keeps a color with available stock');
select is((select (item->>'stock')::integer from jsonb_array_elements(public.search_catalog_suggestions('Net Stock Fixture')) item where item->>'id'='de160000-0000-4000-8000-000000000002'),1,'Search suggestions use net availability');
select is((select (item->>'stock')::integer from jsonb_array_elements(public.get_google_merchant_feed()) item where item->>'variant_id'='de160000-0000-4000-8000-000000000003'),1,'Merchant feed uses net availability');
reset role;
set local role authenticated;
select is((public.get_catalog_product('net-stock-fixture')->>'stock')::integer,1,'Authenticated detail uses the same stock contract');
reset role;
select lives_ok($$select private.reserve_inventory('de160000-0000-4000-8000-000000000004','de160000-0000-4000-8000-000000000003',1,now()+interval '30 minutes')$$,'Second reservation consumes the remaining unit');
select is((select available_quantity from public.inventory where variant_id='de160000-0000-4000-8000-000000000003'),0,'No unit remains available');
set local role anon;
select is((public.search_catalog(p_category=>'net-stock-fixture',p_in_stock=>true)->>'total')::integer,0,'Fully reserved product is unavailable');
select is((public.get_catalog_product('net-stock-fixture')->>'stock')::integer,0,'Fully reserved detail reports zero');
reset role;
update public.inventory_reservations set expires_at=now()-interval '1 second' where cart_id='de160000-0000-4000-8000-000000000004';
do $$ begin perform private.release_expired_reservations(); end $$;
select is((select available_quantity from public.inventory where variant_id='de160000-0000-4000-8000-000000000003'),2,'Release restores both available units');
select is((select reserved_quantity from public.inventory where variant_id='de160000-0000-4000-8000-000000000003'),0,'Release clears reserved units');
set local role anon;
select is((public.get_catalog_product('net-stock-fixture')->>'stock')::integer,2,'Detail reflects the real release');
select is((public.search_catalog(p_category=>'net-stock-fixture',p_in_stock=>true)->>'total')::integer,1,'Released stock becomes purchasable again');
reset role;
select * from finish();
rollback;

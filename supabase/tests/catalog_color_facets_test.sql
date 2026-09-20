begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into public.categories(id,name,slug) values
 ('c8100000-0000-4000-8000-000000000001','Teste cores','teste-facets-cores');
insert into public.products(id,name,slug,category_id,status,base_price) values
 ('c8200000-0000-4000-8000-000000000001','Produto cor A','teste-facets-cor-a','c8100000-0000-4000-8000-000000000001','active',50),
 ('c8200000-0000-4000-8000-000000000002','Produto cor B','teste-facets-cor-b','c8100000-0000-4000-8000-000000000001','active',50);
insert into public.product_variants(id,product_id,sku,color_name,size,active) values
 ('c8300000-0000-4000-8000-000000000001','c8200000-0000-4000-8000-000000000001','TEST-COLOR-A39','Preta Strass','39',true),
 ('c8300000-0000-4000-8000-000000000002','c8200000-0000-4000-8000-000000000001','TEST-COLOR-A40',' preta   strass ','40',true),
 ('c8300000-0000-4000-8000-000000000003','c8200000-0000-4000-8000-000000000002','TEST-COLOR-B39','Preta Strass','39',true);
insert into public.inventory(variant_id,available_quantity,reserved_quantity) values
 ('c8300000-0000-4000-8000-000000000001',3,0),
 ('c8300000-0000-4000-8000-000000000002',2,0),
 ('c8300000-0000-4000-8000-000000000003',0,0);

select is((select count(*) from jsonb_array_elements(public.search_catalog()->'facets'->'colors') item
  where lower(item->>'value')='preta strass'),1::bigint,'Case and whitespace variants produce one color');
select is((select (item->>'count')::integer from jsonb_array_elements(public.search_catalog()->'facets'->'colors') item
  where lower(item->>'value')='preta strass'),1,'Color count uses eligible products, not duplicate variants');
select is((public.search_catalog(p_colors=>array[' PRETA   STRASS '])->>'total')::integer,1,
  'Color filter accepts the canonical equivalent');
update public.inventory set available_quantity=2 where variant_id='c8300000-0000-4000-8000-000000000003';
select is((select (item->>'count')::integer from jsonb_array_elements(public.search_catalog()->'facets'->'colors') item
  where lower(item->>'value')='preta strass'),2,'Newly stocked eligible product changes count immediately');
update public.product_variants set active=false where product_id='c8200000-0000-4000-8000-000000000001';
select is((select (item->>'count')::integer from jsonb_array_elements(public.search_catalog()->'facets'->'colors') item
  where lower(item->>'value')='preta strass'),1,'Inactive variants no longer count');
update public.products set status='draft' where id='c8200000-0000-4000-8000-000000000002';
select is((select count(*) from jsonb_array_elements(public.search_catalog()->'facets'->'colors') item
  where lower(item->>'value')='preta strass'),0::bigint,'Draft product color is absent');
select is((public.search_catalog(p_colors=>array['Preta Strass'])->>'total')::integer,0,
  'Filtered catalog follows current product eligibility');
select * from finish();
rollback;

begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

insert into auth.users(id,instance_id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('c7400000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','product-import-admin@test.local','{}','{}',now(),now());
update public.profiles set status='active' where id='c7400000-0000-4000-8000-000000000001';
insert into public.user_roles(user_id,role) values
 ('c7400000-0000-4000-8000-000000000001','admin') on conflict do nothing;
insert into public.categories(id,name,slug) values
 ('c7400000-0000-4000-8000-000000000002','Importação de teste','importacao-workflow-teste');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"c7400000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);

select lives_ok($sql$
  select public.admin_import_product_with_taxonomy_authorized(
    'shopee', 'IMPORT-WORKFLOW-1', repeat('a',64),
    '{
      "name":"Chinelo importado de teste","slug":"produto-import-workflow","status":"active",
      "shortDescription":"Teste","description":"Produto usado pelo pgTAP",
      "priceInCents":2990,"costInCents":1200,"weightGrams":300,
      "heightCm":10,"widthCm":20,"lengthCm":30,"stockReason":"Importação pgTAP",
      "merchantCondition":"new","merchantGender":"unisex","merchantAgeGroup":"adult",
      "googleProductCategory":"Apparel & Accessories > Shoes","merchantIdentifierExists":true,
      "variants":[
        {"sku":"IMPORT-WORKFLOW-34","color":"Lilás","colorHex":"#C8A2C8","colorHexSecondary":"#FFFFFF","size":"34","stock":7,"active":true,"gtin":"7890000000034","mpn":"MPN-34"},
        {"sku":"IMPORT-WORKFLOW-35","color":"Lilás","colorHex":"#C8A2C8","colorHexSecondary":"#FFFFFF","size":"35","stock":0,"active":true,"gtin":"7890000000035","mpn":"MPN-35"}
      ],
      "sizeGuide":[{"size":"34","measurementCm":22.5},{"size":"35","measurementCm":23}],
      "specifications":[{"label":"Material","value":"Borracha"}]
    }'::jsonb,
    'Importação de teste','importacao-workflow-teste',true,
    'Modelo importado de teste','modelo-importado-teste',true
  )
$sql$, 'First import resolves taxonomy and executes without the invalid chr(0) lock key');

select is((select count(*) from public.categories where slug='importacao-workflow-teste'),1::bigint,'Existing category is reused');
select is((select count(*) from public.product_models where slug='modelo-importado-teste' and active),1::bigint,'Missing model is created active');
select ok((select product.category_id='c7400000-0000-4000-8000-000000000002'::uuid
  and product.model_id=(select id from public.product_models where slug='modelo-importado-teste')
  from public.products product where product.slug='produto-import-workflow'),'Imported product receives resolved category and model');

select is((select status::text from public.products where slug='produto-import-workflow'),'draft','Imported product is forced to draft');
select is((select count(*) from public.product_variants variant join public.products product on product.id=variant.product_id where product.slug='produto-import-workflow'),2::bigint,'Import creates both variants');
select is((select string_agg(variant.size || ':' || inventory.available_quantity, ',' order by variant.size)
  from public.product_variants variant join public.products product on product.id=variant.product_id
  join public.inventory inventory on inventory.variant_id=variant.id where product.slug='produto-import-workflow'),'34:7,35:0','Informed and parser-defaulted zero stock persist');
select is((select count(*) from public.product_import_sources where source='shopee' and external_key='IMPORT-WORKFLOW-1'),1::bigint,'Import source is persisted');
select is((public.admin_import_product_with_taxonomy_authorized(
  'shopee','IMPORT-WORKFLOW-1',repeat('a',64),'{"name":"Ignored duplicate","variants":[]}'::jsonb,
  'Importação de teste','importacao-workflow-teste',true,
  'Modelo importado de teste','modelo-importado-teste',true
)->>'alreadyImported')::boolean,true,'Second import reports alreadyImported');
select is((select count(*) from public.products where slug='produto-import-workflow'),1::bigint,'Reimport does not duplicate the product');
select is((select count(*) from public.product_models where slug='modelo-importado-teste'),1::bigint,'Reimport does not duplicate the model');
select ok((select merchant_condition='new' and merchant_gender='unisex' and merchant_age_group='adult'
  and google_product_category='Apparel & Accessories > Shoes' and merchant_identifier_exists
  from public.products where slug='produto-import-workflow'),'Merchant product metadata persists');
select is((select string_agg(barcode || ':' || merchant_mpn, ',' order by size)
  from public.product_variants where product_id=(select id from public.products where slug='produto-import-workflow')),
  '7890000000034:MPN-34,7890000000035:MPN-35','GTIN and MPN persist');
select is((select count(*) from public.product_variants where product_id=(select id from public.products where slug='produto-import-workflow')
  and color_hex_secondary::text='#FFFFFF'),2::bigint,'Secondary HEX remains persisted');
select is((select count(*) from public.product_size_guide_entries where product_id=(select id from public.products where slug='produto-import-workflow')),2::bigint,'Size guide remains persisted');
select is((select count(*) from public.product_specifications where product_id=(select id from public.products where slug='produto-import-workflow')
  and label='Material' and value='Borracha'),1::bigint,'Specifications remain persisted');

select lives_ok($sql$
  select public.admin_import_product_with_taxonomy_authorized(
    'shopee','IMPORT-WORKFLOW-2',repeat('c',64),
    '{
      "name":"Segundo produto importado","slug":"produto-import-workflow-2",
      "shortDescription":"Teste","description":"Segundo produto",
      "priceInCents":1990,"costInCents":835,"weightGrams":250,
      "heightCm":8,"widthCm":20,"lengthCm":28,"stockReason":"Importação pgTAP",
      "variants":[{"sku":"IMPORT-WORKFLOW-2-34","color":"Preto","colorHex":"#000000","colorHexSecondary":"","size":"34","stock":1000,"active":true,"gtin":"","mpn":""}],
      "sizeGuide":[],"specifications":[]
    }'::jsonb,
    'Categoria criada pela importação','categoria-criada-importacao',true,
    'Modelo importado de teste','modelo-importado-teste',true
  )
$sql$,'Missing category is created while an existing model is reused');
select is((select count(*) from public.categories where slug='categoria-criada-importacao' and active),1::bigint,'Created category is active and unique');
select is((select count(*) from public.product_models where slug='modelo-importado-teste'),1::bigint,'Existing model remains unique across products');
select ok((select category.slug='categoria-criada-importacao' and model.slug='modelo-importado-teste'
  from public.products product
  join public.categories category on category.id=product.category_id
  join public.product_models model on model.id=product.model_id
  where product.slug='produto-import-workflow-2'),'Second product is linked to the created and reused taxonomy');

select throws_ok($sql$
  select public.admin_import_product_with_taxonomy_authorized(
    'shopee','IMPORT-WORKFLOW-NO-CREATE',repeat('e',64),
    '{"name":"Produto sem criação","slug":"produto-sem-criacao","shortDescription":"Teste","description":"Teste","priceInCents":1000,"costInCents":500,"weightGrams":200,"heightCm":5,"widthCm":10,"lengthCm":20,"variants":[]}'::jsonb,
    'Categoria não criada','categoria-nao-criada',false,
    null,null,false
  )
$sql$,'P0002','import category not found','Missing category fails when automatic creation is disabled');
select is((select count(*) from public.categories where slug='categoria-nao-criada'),0::bigint,'Disabled automatic creation leaves no category behind');

reset role;
insert into public.user_permission_overrides(user_id,permission_id,allowed,reason,created_by)
select 'c7400000-0000-4000-8000-000000000001',permission.id,false,'pgTAP taxonomy denial','c7400000-0000-4000-8000-000000000001'
from public.permissions permission where permission.code='catalog.taxonomy.manage';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"c7400000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
select throws_ok($sql$
  select public.admin_import_product_with_taxonomy_authorized(
    'shopee','IMPORT-WORKFLOW-DENIED',repeat('d',64),
    '{"name":"Produto negado","slug":"produto-negado","shortDescription":"Teste","description":"Teste","priceInCents":1000,"costInCents":500,"weightGrams":200,"heightCm":5,"widthCm":10,"lengthCm":20,"variants":[]}'::jsonb,
    'Categoria sem permissão','categoria-sem-permissao',true,
    'Modelo sem permissão','modelo-sem-permissao',true
  )
$sql$,'42501','permission denied','User without taxonomy permission cannot create category or model');
select is((select count(*) from public.categories where slug='categoria-sem-permissao')
  + (select count(*) from public.product_models where slug='modelo-sem-permissao'),0::bigint,'Denied taxonomy creation leaves no partial rows');

insert into public.product_import_sessions(id,user_id,schema_version,batch_hash,payload,created_at,expires_at) values (
  'c7400000-0000-4000-8000-000000000003','c7400000-0000-4000-8000-000000000001','curtiz_import_v1',repeat('b',64),
  '{"batch":{"products":[{}]}}'::jsonb,now()-interval '2 hours',now()-interval '1 hour'
);
select is((select count(*) from public.product_import_sessions where id='c7400000-0000-4000-8000-000000000003'),0::bigint,'Expired session remains unreadable through SELECT RLS');
select lives_ok($sql$ delete from public.product_import_sessions where id='c7400000-0000-4000-8000-000000000003' $sql$,'Owner can delete an expired session');
reset role;
select is((select count(*) from public.product_import_sessions where id='c7400000-0000-4000-8000-000000000003'),0::bigint,'Expired session was actually deleted');

update public.products set status='active' where slug='produto-import-workflow';
insert into public.product_images(product_id,variant_id,storage_path,alt_text,sort_order,is_primary,width,height)
select product.id, variant.id, 'products/imports/test/shared-color.webp', 'Chinelo lilás', 0, true, 800, 800
from public.products product join public.product_variants variant on variant.product_id=product.id
where product.slug='produto-import-workflow' and variant.size='34';

select is((select count(*) from private.storefront_catalog_items()
  where slug='produto-import-workflow' and image_path='products/imports/test/shared-color.webp'),2::bigint,
  'Storefront resolves one color image for every size of that color');
select is((select count(*) from jsonb_array_elements(public.get_catalog_product('produto-import-workflow')->'variants') item
  where item->>'imagePath'='products/imports/test/shared-color.webp'),2::bigint,
  'Product page resolves one color image for every size of that color');
select is((select count(*) from jsonb_array_elements(public.get_google_merchant_feed()) item
  where item->>'slug'='produto-import-workflow'
    and item->'images'->0->>'path'='products/imports/test/shared-color.webp'),2::bigint,
  'Merchant feed resolves one color image for every size of that color');

select * from finish();
rollback;

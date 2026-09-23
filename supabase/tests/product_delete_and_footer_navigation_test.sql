begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,instance_id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('fd240000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','product-delete-footer@test.local','{}','{}',now(),now());
update public.profiles set status='active' where id='fd240000-0000-4000-8000-000000000001';
insert into public.user_roles(user_id,role)
values ('fd240000-0000-4000-8000-000000000001','admin') on conflict do nothing;

insert into public.categories(id,name,slug,active,show_in_menu)
values ('fd240000-0000-4000-8000-000000000010','Feminino teste','feminino-delete-test',true,true),
  ('fd240000-0000-4000-8000-000000000011','Legado sem produto','legado-delete-test',true,true);
insert into public.products(id,name,slug,category_id,status,base_price)
values ('fd240000-0000-4000-8000-000000000020','Produto operacional','produto-operacional-delete-test',
    'fd240000-0000-4000-8000-000000000010','draft',50),
  ('fd240000-0000-4000-8000-000000000021','Produto com pedido','produto-pedido-delete-test',
    'fd240000-0000-4000-8000-000000000010','draft',75);
insert into public.product_categories(product_id,category_id,is_primary)
values ('fd240000-0000-4000-8000-000000000020','fd240000-0000-4000-8000-000000000010',true),
  ('fd240000-0000-4000-8000-000000000021','fd240000-0000-4000-8000-000000000010',true);
insert into public.product_variants(id,product_id,sku,color_name,size,active)
values ('fd240000-0000-4000-8000-000000000030','fd240000-0000-4000-8000-000000000020','DELETE-OPERACIONAL-37','Preto','37',true),
  ('fd240000-0000-4000-8000-000000000031','fd240000-0000-4000-8000-000000000021','DELETE-PEDIDO-38','Branco','38',true);
insert into public.inventory(variant_id,available_quantity)
values ('fd240000-0000-4000-8000-000000000030',2),
  ('fd240000-0000-4000-8000-000000000031',2);
insert into public.product_images(product_id,storage_path,alt_text,width,height,is_primary)
values ('fd240000-0000-4000-8000-000000000020','test/delete-operational.webp','Produto operacional',720,720,true),
  ('fd240000-0000-4000-8000-000000000021','test/delete-order.webp','Produto com pedido',720,720,true);
insert into public.product_size_guide_entries(product_id,size,measurement_cm)
values ('fd240000-0000-4000-8000-000000000020','37',24);
insert into public.product_specifications(product_id,label,value,position)
values ('fd240000-0000-4000-8000-000000000020','Material','Borracha',0);
update public.products set status='active' where id='fd240000-0000-4000-8000-000000000021';
insert into public.inventory_movements(variant_id,movement_type,quantity,previous_quantity,new_quantity,reason)
values ('fd240000-0000-4000-8000-000000000030','adjustment',2,0,2,'Teste de exclusão');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"fd240000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
select ok((public.admin_product_delete_eligibility(array['fd240000-0000-4000-8000-000000000020'::uuid])
  ->'fd240000-0000-4000-8000-000000000020'->>'canDelete')::boolean,
  'Variant-only stock history does not block deletion');
reset role;

insert into public.marketing_events(anonymous_session_id,event_type,product_id)
values ('fd240000-0000-4000-8000-000000000099','view',
  'fd240000-0000-4000-8000-000000000020');
insert into public.carts(id,anonymous_token_hash)
values ('fd240000-0000-4000-8000-000000000040','delete-test-cart-token');
insert into public.cart_items(cart_id,variant_id,quantity,unit_price_snapshot)
values ('fd240000-0000-4000-8000-000000000040','fd240000-0000-4000-8000-000000000030',1,50);
insert into public.product_import_sources(source,external_key,product_id,batch_hash,product_hash,imported_by)
values ('test','delete-operational','fd240000-0000-4000-8000-000000000020',repeat('a',64),repeat('b',64),
  'fd240000-0000-4000-8000-000000000001');
insert into public.product_import_runs(id,user_id,products_total)
values ('fd240000-0000-4000-8000-000000000050','fd240000-0000-4000-8000-000000000001',1);
insert into public.product_import_run_products(run_id,product_id)
values ('fd240000-0000-4000-8000-000000000050','fd240000-0000-4000-8000-000000000020');
insert into public.product_import_image_jobs(id,product_id,source_url,normalized_url,storage_path,sort_order,status)
values ('fd240000-0000-4000-8000-000000000051','fd240000-0000-4000-8000-000000000020',
  'https://example.test/delete.webp','https://example.test/delete.webp',
  'products/imports/fd240000-0000-4000-8000-000000000020/'||repeat('a',64)||'.webp',0,'queued');
insert into public.product_import_run_image_jobs(run_id,job_id)
values ('fd240000-0000-4000-8000-000000000050','fd240000-0000-4000-8000-000000000051');

insert into public.products(id,name,slug,category_id,status,base_price)
values ('fd240000-0000-4000-8000-000000000022','Produto importado pronto',
  'produto-importado-pronto-delete-test','fd240000-0000-4000-8000-000000000010','draft',60);
insert into public.product_categories(product_id,category_id,is_primary)
values ('fd240000-0000-4000-8000-000000000022','fd240000-0000-4000-8000-000000000010',true);
insert into public.product_variants(id,product_id,sku,color_name,size,active)
values ('fd240000-0000-4000-8000-000000000032','fd240000-0000-4000-8000-000000000022',
  'DELETE-IMPORTADO-39','Azul','39',true);
insert into public.inventory(variant_id,available_quantity)
values ('fd240000-0000-4000-8000-000000000032',2);
insert into public.product_import_sources(source,external_key,product_id,batch_hash,product_hash,imported_by)
values ('test','import-ready','fd240000-0000-4000-8000-000000000022',repeat('a',64),repeat('c',64),
  'fd240000-0000-4000-8000-000000000001');
insert into public.product_import_image_jobs(id,product_id,source_url,normalized_url,storage_path,
  sort_order,status,attempts,lock_token)
values ('fd240000-0000-4000-8000-000000000052','fd240000-0000-4000-8000-000000000022',
  'https://example.test/ready.webp','https://example.test/ready.webp',
  'products/imports/fd240000-0000-4000-8000-000000000022/'||repeat('b',64)||'.webp',
  0,'processing',1,'fd240000-0000-4000-8000-000000000053');
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select lives_ok($$select public.complete_product_import_image_job(
  'fd240000-0000-4000-8000-000000000052',
  'fd240000-0000-4000-8000-000000000053',720,720,1024)$$,
  'The worker completes the imported image and publishes the ready draft');
reset role;
select is((select status::text from public.products where id='fd240000-0000-4000-8000-000000000022'),
  'active','Completed image publishes the same imported product');
select is((select count(*)::integer from public.audit_logs where action='product_status_updated'
  and entity_id='fd240000-0000-4000-8000-000000000022'),1,
  'Automatic publication is audited');

insert into public.orders(id,customer_id,customer_email_snapshot,customer_name_snapshot,status,
  payment_status,subtotal,grand_total,shipping_address_snapshot,placed_at)
values ('fd240000-0000-4000-8000-000000000060','fd240000-0000-4000-8000-000000000001',
  'product-delete-footer@test.local','Cliente de teste','payment_approved','approved',75,75,'{}',now());
insert into public.order_items(order_id,product_id,variant_id,product_name_snapshot,sku_snapshot,
  color_snapshot,size_snapshot,quantity,unit_price,total)
values ('fd240000-0000-4000-8000-000000000060','fd240000-0000-4000-8000-000000000021',
  'fd240000-0000-4000-8000-000000000031','Produto com pedido','DELETE-PEDIDO-38','Branco','38',1,75,75);

set local role authenticated;
select ok((public.admin_product_delete_eligibility(array['fd240000-0000-4000-8000-000000000020'::uuid])
  ->'fd240000-0000-4000-8000-000000000020'->>'canDelete')::boolean,
  'Marketing events, carts and import links remain removable');
select ok(public.admin_product_delete_eligibility(array['fd240000-0000-4000-8000-000000000020'::uuid])
  ->'fd240000-0000-4000-8000-000000000020'->'removableDependencies' ? 'inventory_movements',
  'Eligibility details list removable stock history');
select ok(not (public.admin_product_delete_eligibility(array['fd240000-0000-4000-8000-000000000021'::uuid])
  ->'fd240000-0000-4000-8000-000000000021'->>'canDelete')::boolean,
  'A paid order item blocks deletion');
select ok(public.admin_product_delete_eligibility(array['fd240000-0000-4000-8000-000000000021'::uuid])
  ->'fd240000-0000-4000-8000-000000000021'->'blockingDependencies' ? 'order_items',
  'Eligibility details name the commercial blocker');
select throws_ok($$select public.admin_delete_product('fd240000-0000-4000-8000-000000000021')$$,
  '23503','product has related records','Direct RPC cannot delete a sold product');
select ok(public.admin_delete_product('fd240000-0000-4000-8000-000000000020')
  ->'storagePaths' ? 'test/delete-operational.webp',
  'Successful delete returns catalog-public paths for later cleanup');
reset role;

select is((select count(*)::integer from public.products where id='fd240000-0000-4000-8000-000000000020'),0,
  'Product is removed');
select is((select count(*)::integer from public.product_variants where product_id='fd240000-0000-4000-8000-000000000020'),0,
  'Variants are removed');
select is((select count(*)::integer from public.inventory_movements where variant_id='fd240000-0000-4000-8000-000000000030'),0,
  'Stock movements are removed without orphan FKs');
select is((select count(*)::integer from public.marketing_events where product_id='fd240000-0000-4000-8000-000000000020'),0,
  'Marketing events are removed');
select is((select count(*)::integer from public.product_size_guide_entries
  where product_id='fd240000-0000-4000-8000-000000000020'),0,
  'Size guides are removed');
select is((select count(*)::integer from public.product_specifications
  where product_id='fd240000-0000-4000-8000-000000000020'),0,
  'Specifications are removed');
select is((select count(*)::integer from public.cart_items where variant_id='fd240000-0000-4000-8000-000000000030'),0,
  'Cart items are removed');
select is((select count(*)::integer from public.product_import_runs where id='fd240000-0000-4000-8000-000000000050'),0,
  'Orphaned import run and its jobs are removed');
select is((select count(*)::integer from public.audit_logs where action='product.delete'
  and entity_id='fd240000-0000-4000-8000-000000000020'),1,
  'Permanent deletion is audited once');
select is((select count(*)::integer from public.order_items where product_id='fd240000-0000-4000-8000-000000000021'),1,
  'Paid order history remains intact');

insert into public.store_navigation_items(id,label,placement,destination_type,destination_value,visible,sort_order,
  source,created_by,updated_by)
values ('fd240000-0000-4000-8000-000000000070','Feminino teste','main','category',
  'feminino-delete-test',true,10,'manual','fd240000-0000-4000-8000-000000000001',
  'fd240000-0000-4000-8000-000000000001'),
  ('fd240000-0000-4000-8000-000000000071','Legado sem produto','main','category',
  'legado-delete-test',true,20,'manual','fd240000-0000-4000-8000-000000000001',
  'fd240000-0000-4000-8000-000000000001');
set local role anon;
select is((select count(*)::integer from public.get_public_store_navigation()
  where destination_value='feminino-delete-test'),1,'Public category with eligible product is shown');
select is((select count(*)::integer from public.get_public_store_navigation()
  where destination_value='legado-delete-test'),0,'Legacy category without public products is hidden');
reset role;
update public.categories set show_in_menu=false where slug='feminino-delete-test';
set local role anon;
select is((select count(*)::integer from public.get_public_store_navigation()
  where destination_value='feminino-delete-test'),0,'Hidden category leaves the menu');
reset role;
insert into public.categories(id,name,slug,active,show_in_menu)
values ('fd240000-0000-4000-8000-000000000012','Chinelos teste','chinelos-delete-test',true,true);
insert into public.product_categories(product_id,category_id,is_primary)
values ('fd240000-0000-4000-8000-000000000021','fd240000-0000-4000-8000-000000000012',false);
insert into public.store_navigation_items(id,label,placement,destination_type,destination_value,visible,sort_order,
  source,created_by,updated_by)
values ('fd240000-0000-4000-8000-000000000072','Chinelos teste','main','category',
  'chinelos-delete-test',true,30,'manual','fd240000-0000-4000-8000-000000000001',
  'fd240000-0000-4000-8000-000000000001');
set local role anon;
select is((select count(*)::integer from public.get_public_store_navigation()
  where destination_value='chinelos-delete-test'),1,'New exposed category appears automatically');
reset role;

select * from finish();
rollback;

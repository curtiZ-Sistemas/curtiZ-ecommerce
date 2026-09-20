begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into auth.users(id,instance_id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('c7100000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','product-save-admin@test.local','{}','{}',now(),now()),
 ('c7100000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','product-save-customer@test.local','{}','{}',now(),now());
update public.profiles set status='active' where id in
 ('c7100000-0000-4000-8000-000000000001','c7100000-0000-4000-8000-000000000002');
insert into public.user_roles(user_id,role) values
 ('c7100000-0000-4000-8000-000000000001','admin'),
 ('c7100000-0000-4000-8000-000000000002','customer') on conflict do nothing;
insert into public.categories(id,name,slug) values
 ('c7200000-0000-4000-8000-000000000001','Teste sandálias','teste-save-sandalias'),
 ('c7200000-0000-4000-8000-000000000002','Teste verão','teste-save-verao');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"c7100000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);

-- O save autorizado chama o save real, cria duas variantes e persiste o guia na mesma transação.
select lives_ok($sql$
  select public.admin_save_product_authorized('{
    "name":"Sandália tamanho 40","slug":"teste-save-parcial","status":"draft",
    "shortDescription":null,"description":null,"categoryId":"c7200000-0000-4000-8000-000000000001",
    "categoryIds":["c7200000-0000-4000-8000-000000000001","c7200000-0000-4000-8000-000000000002"],
    "priceInCents":null,"costInCents":null,"weightGrams":null,"heightCm":null,"widthCm":null,"lengthCm":40,
    "stockReason":"Cadastro inicial de teste",
    "variants":[
      {"sku":"TEST-SAVE-39","color":"Azul","size":"39","stock":2,"active":true},
      {"sku":"TEST-SAVE-40","color":"Azul","size":"40","stock":0,"active":true}
    ],"sizeGuide":[{"size":"39","measurementCm":27},{"size":"40","measurementCm":27}]
  }'::jsonb)
$sql$, 'Draft with partial dimensions, variants and size guide saves via authorized RPC');

select lives_ok($sql$
  select public.admin_save_product_authorized('{
    "name":"Sandália sem medidas","slug":"teste-save-sem-medidas","status":"draft",
    "categoryId":null,"priceInCents":null,"costInCents":null,
    "weightGrams":null,"heightCm":null,"widthCm":null,"lengthCm":null,
    "stockReason":"Cadastro inicial de teste","variants":[]
  }'::jsonb)
$sql$, 'Draft with all dimensions absent saves via authorized RPC');

select lives_ok($sql$
  select public.admin_save_product_authorized('{
    "name":"Sandália publicada","slug":"teste-save-publicada","status":"active",
    "categoryId":"c7200000-0000-4000-8000-000000000001",
    "categoryIds":["c7200000-0000-4000-8000-000000000001"],
    "priceInCents":1999,"costInCents":null,"weightGrams":null,"heightCm":null,"widthCm":null,"lengthCm":null,
    "stockReason":"Cadastro inicial de teste",
    "variants":[{"sku":"TEST-SAVE-ACTIVE","color":"Azul","size":"40","stock":0,"active":true}]
  }'::jsonb)
$sql$, 'Published product follows existing publication requirements without requiring dimensions');

select set_config('request.jwt.claims','{"sub":"c7100000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}',true);
select throws_ok($sql$
  select public.admin_save_product_authorized('{"name":"Forbidden product","slug":"teste-save-forbidden","status":"draft","variants":[]}'::jsonb)
$sql$, '42501', null, 'Customer cannot save product through the authorized RPC');
set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
select throws_ok($sql$
  select public.admin_save_product_authorized('{"name":"Forbidden product","slug":"teste-save-forbidden","status":"draft","variants":[]}'::jsonb)
$sql$, '42501', null, 'Anonymous role cannot invoke the authorized RPC');
reset role;

select is((select count(*) from public.products where slug like 'teste-save-%'),3::bigint,'All three products persisted');
select ok((select short_description is null and description is null and base_price is null and cost_price is null
  and weight_grams is null and height_cm is null and width_cm is null and length_cm=40
  from public.products where slug='teste-save-parcial'), 'Optional fields persist NULL while length stays 40');
select ok((select category_id is null and base_price is null and cost_price is null
  and weight_grams is null and height_cm is null and width_cm is null and length_cm is null
  from public.products where slug='teste-save-sem-medidas'), 'All optional dimensions remain NULL in second draft');
select is((select count(*) from public.product_variants v join public.products p on p.id=v.product_id
  where p.slug='teste-save-parcial'),2::bigint,'Both size variants persisted');
select is((select count(*) from public.inventory i join public.product_variants v on v.id=i.variant_id
  join public.products p on p.id=v.product_id where p.slug='teste-save-parcial'),2::bigint,'Inventory persisted for both variants');
select is((select count(*) from public.product_size_guide_entries g join public.products p on p.id=g.product_id
  where p.slug='teste-save-parcial' and g.size in ('39','40') and g.measurement_cm=27),2::bigint,
  'Size guide 39 and 40 both persist with measurement 27');
select is((select count(*) from public.product_categories c join public.products p on p.id=c.product_id
  where p.slug='teste-save-parcial'),2::bigint,'Multiple categories persisted');
select is((select count(*) from public.product_categories c join public.products p on p.id=c.product_id
  where p.slug='teste-save-parcial' and c.is_primary and c.category_id=p.category_id),1::bigint,
  'Primary category remains marked correctly');
select is((select count(*) from public.products where slug='teste-save-publicada' and status='active' and base_price=19.99),
  1::bigint,'Active product has its correct price and status');
select ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in
  ('public.products'::regclass,'public.product_categories'::regclass,'public.product_size_guide_entries'::regclass)),
  'Product, category links and size guide retain forced RLS');
select ok(not has_function_privilege('anon','public.admin_save_product_authorized(jsonb)','execute')
  and not has_table_privilege('anon','public.product_size_guide_entries','insert'),
  'Anonymous callers cannot invoke save or insert size guides');
select ok((select count(*) from public.audit_logs where action='product_created'
  and entity_id in (select id from public.products where slug like 'teste-save-%'))=3,
  'All three creations were audited');

select * from finish();
rollback;

begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,instance_id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('de170000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','production-fixture@test.local','{}','{"full_name":"Fixture Customer"}',now(),now());
update public.profiles set status='active' where id='de170000-0000-4000-8000-000000000001';
insert into public.user_roles(user_id,role) values('de170000-0000-4000-8000-000000000001','customer') on conflict do nothing;
insert into public.categories(id,name,slug) values('de171000-0000-4000-8000-000000000001','Payment fixture','payment-mode-fixture');
insert into public.products(id,name,slug,short_description,description,category_id,status,base_price,cost_price,weight_grams,height_cm,width_cm,length_cm)
values('de172000-0000-4000-8000-000000000001','Payment fixture','payment-mode-fixture','Fixture','Fixture',
  'de171000-0000-4000-8000-000000000001','draft',50,20,200,5,10,20);
insert into public.product_images(product_id,storage_path,alt_text,width,height,is_primary)
values('de172000-0000-4000-8000-000000000001','test/payment-mode.webp','Fixture',720,720,true);
update public.products set status='active' where id='de172000-0000-4000-8000-000000000001';
insert into public.product_variants(id,product_id,sku,color_name,size)
values('de173000-0000-4000-8000-000000000001','de172000-0000-4000-8000-000000000001','MODE-FIXTURE-37','Preto','37');
insert into public.inventory(variant_id,available_quantity) values('de173000-0000-4000-8000-000000000001',10);

create function pg_temp.confirm_mode(production boolean, customer_name text default 'Fixture Customer') returns jsonb language plpgsql as $$
begin
  if production then
    return public.confirm_professional_production_checkout_order(
      'de174000-0000-4000-8000-000000000001','de170000-0000-4000-8000-000000000001','visa',
      customer_name,'production-fixture@test.local','11999999999','cipher-fixture','4725',
      '{"postalCode":"01310100","street":"Av Paulista","number":"1","complement":"","district":"Bela Vista","city":"Sao Paulo","state":"SP"}',
      '[{"product_id":"de172000-0000-4000-8000-000000000001","variant_id":"de173000-0000-4000-8000-000000000001","quantity":1}]',null,30);
  end if;
  return public.confirm_professional_checkout_order(
    'de174000-0000-4000-8000-000000000001','de170000-0000-4000-8000-000000000001','visa',
    customer_name,'production-fixture@test.local','11999999999','cipher-fixture','4725',
    '{"postalCode":"01310100","street":"Av Paulista","number":"1","complement":"","district":"Bela Vista","city":"Sao Paulo","state":"SP"}',
    '[{"product_id":"de172000-0000-4000-8000-000000000001","variant_id":"de173000-0000-4000-8000-000000000001","quantity":1}]',null,30);
end;
$$;

select ok(not has_function_privilege('anon','public.confirm_professional_production_checkout_order(uuid,uuid,text,text,text,text,text,text,jsonb,jsonb,text,integer)','execute'),'anonymous cannot create production orders');
select ok(not has_function_privilege('authenticated','public.confirm_professional_production_checkout_order(uuid,uuid,text,text,text,text,text,text,jsonb,jsonb,text,integer)','execute'),'customers cannot choose production mode directly');
select ok(not has_function_privilege('authenticated','public.confirm_shipping_production_checkout_order(uuid,uuid,text,text,text,text,text,text,jsonb,jsonb,uuid,text,text,integer)','execute'),'shipping production creation is service-only');
select ok(not has_function_privilege('authenticated','private.create_mercadopago_production_order(uuid,text,text,text,text,text,jsonb,jsonb,integer)','execute'),'base production creation is private');
select ok(not has_function_privilege('authenticated','public.check_mercadopago_order_mode(text,uuid,text,uuid)','execute'),'mode lookup does not expose other customers');

set local role service_role;
select lives_ok('select pg_temp.confirm_mode(false)','legacy test checkout still works');
select lives_ok('select pg_temp.confirm_mode(true)','production checkout uses the same server pricing and reservation machinery');
select is((select count(*)::integer from public.orders where customer_id='de170000-0000-4000-8000-000000000001'),2,'same logical key in separate environments creates two distinct orders');
select is((select count(*)::integer from public.idempotency_keys where key='de174000-0000-4000-8000-000000000001' and scope in ('mercadopago.checkout.test','mercadopago.checkout.production')),2,'idempotency scopes are isolated');
select is((select available_quantity from public.inventory where variant_id='de173000-0000-4000-8000-000000000001'),8,'each order reserves one unit');
select is((pg_temp.confirm_mode(true)->>'reused')::boolean,true,'production retry reuses its order');
select is((select available_quantity from public.inventory where variant_id='de173000-0000-4000-8000-000000000001'),8,'retry does not reserve again');
select throws_ok('select pg_temp.confirm_mode(true,''Changed Customer'')','22023','idempotency_conflict','production replay rejects changed identity');
select is((select grand_total from public.orders where customer_id='de170000-0000-4000-8000-000000000001' and commercial_rules_snapshot->>'paymentMode'='production'),66.90::numeric,'production amount includes the existing fixed shipping tariff');
select ok(public.check_mercadopago_order_mode('production',p_order_id := (select id from public.orders where customer_id='de170000-0000-4000-8000-000000000001' and commercial_rules_snapshot->>'paymentMode'='production')),'production order passes matching realm');
select ok(not public.check_mercadopago_order_mode('test',p_order_id := (select id from public.orders where customer_id='de170000-0000-4000-8000-000000000001' and commercial_rules_snapshot->>'paymentMode'='production')),'production order cannot reconcile in test mode');
select ok(not public.check_mercadopago_order_mode('production',p_order_id := (select id from public.orders where customer_id='de170000-0000-4000-8000-000000000001' and commercial_rules_snapshot->>'paymentMode'='production'),p_customer_id := 'de170000-0000-4000-8000-000000000002'),'cancellation checks the owner as well as the realm');
select ok(not public.check_mercadopago_order_mode('production'),'mode lookup requires an order reference');
insert into public.shipping_quotes(id,customer_id,provider,service,service_id,carrier,amount,cost,estimated_days,
  destination_postal_code,cart_fingerprint,provider_environment,expires_at)
values('de175000-0000-4000-8000-000000000001','de170000-0000-4000-8000-000000000001','melhorenvio','Fixture','1','Fixture',12,10,3,'01310100','fixture','sandbox',now()+interval '1 hour');
reset role;
create function pg_temp.confirm_shipping() returns jsonb language sql as $$
  select public.confirm_shipping_production_checkout_order(
    'de174000-0000-4000-8000-000000000002','de170000-0000-4000-8000-000000000001','pix',
    'Fixture Customer','production-fixture@test.local','11999999999','cipher-fixture','4725',
    '{"postalCode":"01310100","street":"Av Paulista","number":"1","complement":"","district":"Bela Vista","city":"Sao Paulo","state":"SP"}',
    '[{"product_id":"de172000-0000-4000-8000-000000000001","variant_id":"de173000-0000-4000-8000-000000000001","quantity":1}]',
    'de175000-0000-4000-8000-000000000001','fixture',null,30);
$$;
set local role service_role;
select throws_ok('select pg_temp.confirm_shipping()','P0001','shipping_quote_changed','production payment rejects sandbox shipping');
update public.shipping_quotes set provider_environment='production' where id='de175000-0000-4000-8000-000000000001';
select lives_ok('select pg_temp.confirm_shipping()','production accepts its server quote');
select is((pg_temp.confirm_shipping()->>'amountInCents')::integer,6200,'shipping retry preserves the persisted quote and total');
select is((select count(*)::integer from public.orders where customer_id='de170000-0000-4000-8000-000000000001'),3,'shipping replay does not create another order');
update public.orders set payment_status='approved',status='payment_approved' where customer_id='de170000-0000-4000-8000-000000000001';
select public.claim_mercadopago_customer('de170000-0000-4000-8000-000000000001','test');
select public.finish_mercadopago_customer(id,creation_key,'mode-test-customer') from public.payment_provider_customers where user_id='de170000-0000-4000-8000-000000000001' and payment_mode='test';
select throws_ok($$select public.claim_mercadopago_card_save('de170000-0000-4000-8000-000000000001',
  (select id from public.payment_provider_customers where user_id='de170000-0000-4000-8000-000000000001' and payment_mode='test'),
  (select id from public.orders where customer_id='de170000-0000-4000-8000-000000000001' and commercial_rules_snapshot->>'paymentMode'='production' order by created_at,id limit 1),
  'de176000-0000-4000-8000-000000000001')$$,'42501','approved_order_required','a production order cannot authorize saving a card on a test customer');
reset role;
select * from finish();
rollback;

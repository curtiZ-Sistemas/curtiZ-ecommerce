begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,instance_id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('cd000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','sandbox-checkout@test.local','{}','{"full_name":"Sandbox Customer"}',now(),now());
update public.profiles set status='active' where id='cd000000-0000-4000-8000-000000000001';
insert into public.user_roles(user_id,role) values('cd000000-0000-4000-8000-000000000001','customer') on conflict do nothing;
insert into public.categories(id,name,slug) values('cd100000-0000-4000-8000-000000000001','Sandbox retry','sandbox-retry');
insert into public.products(id,name,slug,short_description,description,category_id,status,base_price,cost_price,weight_grams,height_cm,width_cm,length_cm)
values('cd200000-0000-4000-8000-000000000001','Sandbox product','sandbox-retry-product','Test','Test',
  'cd100000-0000-4000-8000-000000000001','active',50,20,200,5,10,20);
insert into public.product_variants(id,product_id,sku,color_name,size)
values('cd300000-0000-4000-8000-000000000001','cd200000-0000-4000-8000-000000000001','SANDBOX-RETRY-37','Preto','37');
insert into public.inventory(variant_id,available_quantity) values('cd300000-0000-4000-8000-000000000001',10);

create function pg_temp.confirm_checkout(method text, customer_name text default 'Sandbox Customer')
returns jsonb language sql as $$
  select public.confirm_professional_checkout_order(
    'cd400000-0000-4000-8000-000000000001','cd000000-0000-4000-8000-000000000001',method,
    customer_name,'sandbox-checkout@test.local','11999999999','cipher-real-customer','4725',
    '{"postalCode":"01310100","street":"Av Paulista","number":"1","complement":"","district":"Bela Vista","city":"Sao Paulo","state":"SP"}',
    '[{"product_id":"cd200000-0000-4000-8000-000000000001","variant_id":"cd300000-0000-4000-8000-000000000001","quantity":1}]',null,30);
$$;
create function pg_temp.begin_attempt(attempt_key uuid, method text, fingerprint text)
returns jsonb language sql as $$
  select public.begin_mercadopago_payment_attempt(
    (select id from public.orders where customer_id='cd000000-0000-4000-8000-000000000001'),
    attempt_key,method,fingerprint);
$$;

select ok(not has_function_privilege('anon','public.begin_mercadopago_payment_attempt(uuid,uuid,text,text)','execute'),'Anon cannot begin attempts');
select ok(not has_function_privilege('authenticated','public.begin_mercadopago_payment_attempt(uuid,uuid,text,text)','execute'),'Customer cannot bypass the backend');
select ok(has_function_privilege('service_role','public.begin_mercadopago_payment_attempt(uuid,uuid,text,text)','execute'),'Trusted backend can begin attempts');
select ok(not has_function_privilege('authenticated','public.begin_mercadopago_payment_attempt(uuid,uuid,text)','execute'),'Legacy signature remains protected');
select ok(not has_function_privilege('authenticated','public.confirm_professional_checkout_order(uuid,uuid,text,text,text,text,text,text,jsonb,jsonb,text,integer)','execute'),'Confirmation remains server-only');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.payment_attempts'::regclass),'Attempt RLS stays forced');

set local role service_role;
select lives_ok($$select pg_temp.confirm_checkout('visa')$$,'Logical checkout creates one order');
select lives_ok($$select pg_temp.confirm_checkout('pix')$$,'Changing provider method reuses the same logical checkout');
select is((select count(*)::integer from public.orders where customer_id='cd000000-0000-4000-8000-000000000001'),1,'Method retry does not duplicate order');
select is((select cpf_last_four from public.orders where customer_id='cd000000-0000-4000-8000-000000000001'),'4725','Order retains the real CPF');
select is((select cpf_ciphertext from private.customer_checkout_identity where user_id='cd000000-0000-4000-8000-000000000001'),'cipher-real-customer','Private identity retains the real CPF');
select is((select payment_method_summary from public.payments where order_id=(select id from public.orders where customer_id='cd000000-0000-4000-8000-000000000001')),'selected:visa','Logical replay does not overwrite payment metadata');
select throws_ok($$select pg_temp.confirm_checkout('visa','Changed Customer')$$,'22023','idempotency_conflict','Logical checkout identity cannot change under the same key');

select lives_ok($$select pg_temp.begin_attempt('cd500000-0000-4000-8000-000000000001','visa',repeat('a',64))$$,'First attempt begins');
select lives_ok($$select pg_temp.begin_attempt('cd500000-0000-4000-8000-000000000001','visa',repeat('a',64))$$,'Same HTTP attempt replays');
select is((select count(*)::integer from public.payment_attempts where idempotency_key='cd500000-0000-4000-8000-000000000001'),1,'HTTP replay keeps one attempt');
select throws_ok($$select pg_temp.begin_attempt('cd500000-0000-4000-8000-000000000002','pix',repeat('b',64))$$,'P0001','payment_in_progress','An unresolved attempt blocks a second charge');
select throws_ok($$select pg_temp.begin_attempt('cd500000-0000-4000-8000-000000000001','visa',repeat('b',64))$$,'22023','idempotency_conflict','Same key cannot change provider payload');
select throws_ok($$select pg_temp.begin_attempt('cd500000-0000-4000-8000-000000000001','pix',repeat('a',64))$$,'22023','idempotency_conflict','Same attempt cannot change method');

update public.payment_attempts set status='rejected',status_detail='provider_request_rejected'
where idempotency_key='cd500000-0000-4000-8000-000000000001';
select lives_ok($$select pg_temp.begin_attempt('cd500000-0000-4000-8000-000000000002','pix',repeat('b',64))$$,'Definite provider 400 permits a new attempt');
select is(pg_temp.begin_attempt('cd500000-0000-4000-8000-000000000001','visa',repeat('a',64))->>'status','rejected','Old rejected attempt remains rejected on HTTP replay');
select is((select count(*)::integer from public.payment_attempts where order_id=(select id from public.orders where customer_id='cd000000-0000-4000-8000-000000000001')),2,'New attempt gets its own identity');

update public.payment_attempts set provider_payment_id='sandbox-rejected',status='rejected'
where idempotency_key='cd500000-0000-4000-8000-000000000002';
update public.payments set provider_payment_id='sandbox-rejected',status='rejected'
where order_id=(select id from public.orders where customer_id='cd000000-0000-4000-8000-000000000001');
select lives_ok($$select pg_temp.begin_attempt('cd500000-0000-4000-8000-000000000003','visa',repeat('c',64))$$,'Confirmed rejected payment permits a new attempt on the same order');
select is((select count(*)::integer from public.orders where customer_id='cd000000-0000-4000-8000-000000000001'),1,'Rejected retry still has one order');

update public.payment_attempts set status='rejected',status_detail='provider_request_failed'
where idempotency_key='cd500000-0000-4000-8000-000000000003';
select throws_ok($$select pg_temp.begin_attempt('cd500000-0000-4000-8000-000000000004','visa',repeat('d',64))$$,'P0001','payment_in_progress','Old ambiguous failures do not permit another charge');
select is(pg_temp.begin_attempt('cd500000-0000-4000-8000-000000000003','visa',repeat('c',64))->>'status','pending','An old ambiguous attempt can retry under its original key');

update public.payments set status='approved'
where order_id=(select id from public.orders where customer_id='cd000000-0000-4000-8000-000000000001');
update public.orders set status='payment_approved' where customer_id='cd000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.begin_attempt('cd500000-0000-4000-8000-000000000004','visa',repeat('d',64))$$,'P0001','payment_not_eligible','Approved order never begins another charge');
select lives_ok($$select pg_temp.confirm_checkout('visa')$$,'HTTP creation replay after approval returns the original order');
select is((select count(*)::integer from public.orders where customer_id='cd000000-0000-4000-8000-000000000001'),1,'Approved creation replay still has one order');

select * from finish();
rollback;

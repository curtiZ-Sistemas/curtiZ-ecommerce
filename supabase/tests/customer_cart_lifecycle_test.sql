begin;
create extension if not exists pgtap with schema extensions;
select plan(15);
insert into auth.users(id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
 ('ca000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','lifecycle-one@test.local','{}','{"full_name":"Lifecycle One"}',now(),now()),
 ('ca000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','lifecycle-two@test.local','{}','{"full_name":"Lifecycle Two"}',now(),now());
update public.profiles set status = 'active' where id in ('ca000000-0000-4000-8000-000000000001','ca000000-0000-4000-8000-000000000002');
insert into public.user_roles(user_id,role) values ('ca000000-0000-4000-8000-000000000001','customer'),('ca000000-0000-4000-8000-000000000002','customer') on conflict do nothing;
insert into public.categories(id,name,slug) values ('ca100000-0000-4000-8000-000000000001','Lifecycle','lifecycle-test');
insert into public.products(id,name,slug,category_id,status,base_price,description,weight_grams,height_cm,width_cm,length_cm)
values ('ca200000-0000-4000-8000-000000000001','Lifecycle Product','lifecycle-product','ca100000-0000-4000-8000-000000000001','active',50,'Test product',100,5,10,20);
insert into public.product_variants(id,product_id,sku,color_name,size)
values ('ca300000-0000-4000-8000-000000000001','ca200000-0000-4000-8000-000000000001','LIFECYCLE-37','Preto','37');
insert into public.carts(id,customer_id) values
 ('ca400000-0000-4000-8000-000000000001','ca000000-0000-4000-8000-000000000001'),
 ('ca400000-0000-4000-8000-000000000002','ca000000-0000-4000-8000-000000000002');
insert into public.cart_items(cart_id,variant_id,quantity,unit_price_snapshot)
values ('ca400000-0000-4000-8000-000000000001','ca300000-0000-4000-8000-000000000001',2,50);
select ok(not has_function_privilege('authenticated','public.close_customer_account(uuid)','execute'),'Direct account cleanup is forbidden');
select ok(not has_function_privilege('anon','public.close_customer_account(uuid)','execute'),'Anonymous cleanup is forbidden');
select ok(not has_function_privilege('authenticated','public.sync_customer_cart_available(jsonb,uuid)','execute'),'Old sync cannot bypass wrapper');
select ok(not exists (select 1 from unnest(private.product_deletion_blockers('ca200000-0000-4000-8000-000000000001')) reason where reason ilike '%carrinho%'),'Cart does not block catalog deletion');
update public.products set status='archived' where id='ca200000-0000-4000-8000-000000000001';
select is((select count(*)::integer from public.cart_items where cart_id='ca400000-0000-4000-8000-000000000001'),0,'Archived product removed from purchasable rows');
select is((select count(*)::integer from public.cart_unavailable_items where cart_id='ca400000-0000-4000-8000-000000000001'),1,'Notice preserved');
delete from public.product_variants where id='ca300000-0000-4000-8000-000000000001';
select is((select count(*)::integer from public.cart_unavailable_items where cart_id='ca400000-0000-4000-8000-000000000001'),1,'Physical variant deletion preserves detached notice');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"ca000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is(jsonb_array_length(public.sync_customer_cart('[]',null)->'items'),0,'Another customer cannot see notice');
select set_config('request.jwt.claims','{"sub":"ca000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is(jsonb_array_length(public.sync_customer_cart('[]',null)->'items'),1,'Owner receives notice on first sync');
reset role;
update public.cart_unavailable_items set unavailable_at=now()-interval '3 days' where cart_id='ca400000-0000-4000-8000-000000000001';
set local role authenticated;
select is(jsonb_array_length(public.sync_customer_cart('[]',null)->'items'),0,'Notice expires after three days');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select lives_ok($$select public.close_customer_account('ca000000-0000-4000-8000-000000000001')$$,'Backend closes customer account');
select is((select full_name from public.profiles where id='ca000000-0000-4000-8000-000000000001'),'Conta excluída','Profile anonymized');
select is((select status from public.carts where id='ca400000-0000-4000-8000-000000000001'),'closed','Cart closed without deleting reservation history');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"ca000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is((select count(*)::integer from public.profiles where id='ca000000-0000-4000-8000-000000000001'),0,'Previously issued JWT cannot read closed profile');
select throws_ok($$select public.sync_customer_cart('[]',null)$$,'42501',null,'Closed account cannot recreate cart');
reset role;
select * from finish();
rollback;

begin;
create extension if not exists pgtap with schema extensions;
select plan(10);
insert into auth.users(id,instance_id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
('eb000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','records-owner@example.invalid','{}','{}',now(),now()),
('eb000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','records-admin@example.invalid','{}','{}',now(),now());
update public.profiles set status='active' where id in ('eb000000-0000-4000-8000-000000000001','eb000000-0000-4000-8000-000000000002');
insert into public.user_roles(user_id,role) values ('eb000000-0000-4000-8000-000000000002','admin') on conflict do nothing;
insert into public.orders(id,public_code,customer_id,customer_email_snapshot,customer_name_snapshot,status,payment_status,subtotal,grand_total,shipping_address_snapshot)
values ('eb100000-0000-4000-8000-000000000001','INACTIVE-RECORD-TEST','eb000000-0000-4000-8000-000000000001','records-owner@example.invalid','Fixture','refund_pending','approved',50,50,'{}');
insert into public.addresses(id,user_id,label,recipient_name,postal_code,street,number,district,city,state)
values ('eb200000-0000-4000-8000-000000000001','eb000000-0000-4000-8000-000000000001','Casa','Cliente','01001000','Rua teste','1','Centro','Sao Paulo','SP');
insert into public.carts(id,customer_id) values ('eb300000-0000-4000-8000-000000000001','eb000000-0000-4000-8000-000000000001');
insert into public.notifications(id,user_id,type,title,body) values ('eb400000-0000-4000-8000-000000000001','eb000000-0000-4000-8000-000000000001','test','Teste','Teste');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"eb000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is((select count(id) from public.orders where id='eb100000-0000-4000-8000-000000000001'),1::bigint,'Cliente ativo le pedido');
select is((select count(id) from public.addresses where id='eb200000-0000-4000-8000-000000000001'),1::bigint,'Cliente ativo le endereco');
select is((select count(id) from public.carts where id='eb300000-0000-4000-8000-000000000001'),1::bigint,'Cliente ativo le carrinho');
select is((select count(id) from public.notifications where id='eb400000-0000-4000-8000-000000000001'),1::bigint,'Cliente ativo le notificacao');
reset role;
update public.profiles set status='suspended' where id='eb000000-0000-4000-8000-000000000001';
set local role authenticated;
select is((select count(id) from public.orders where id='eb100000-0000-4000-8000-000000000001'),0::bigint,'Cliente suspenso nao le pedido');
select is((select count(id) from public.addresses where id='eb200000-0000-4000-8000-000000000001'),0::bigint,'Cliente suspenso nao le endereco');
select is((select count(id) from public.carts where id='eb300000-0000-4000-8000-000000000001'),0::bigint,'Cliente suspenso nao le carrinho');
select is((select count(id) from public.notifications where id='eb400000-0000-4000-8000-000000000001'),0::bigint,'Cliente suspenso nao le notificacao');
select set_config('request.jwt.claims','{"sub":"eb000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is((select count(id) from public.orders where id='eb100000-0000-4000-8000-000000000001'),1::bigint,'Admin ativo le pedido autorizado');
reset role;
update public.profiles set status='suspended' where id='eb000000-0000-4000-8000-000000000002';
set local role authenticated;
select is((select count(id) from public.orders where id='eb100000-0000-4000-8000-000000000001'),0::bigint,'Admin suspenso nao le pedido de cliente');
select * from finish();
rollback;

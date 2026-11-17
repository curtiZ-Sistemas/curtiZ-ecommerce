begin;
create extension if not exists pgtap with schema extensions;
select plan(9);
insert into auth.users(id,instance_id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
('e9000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','payment-owner@example.invalid','{}','{}',now(),now()),
('e9000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','payment-other@example.invalid','{}','{}',now(),now());
update public.profiles set status='active' where id in ('e9000000-0000-4000-8000-000000000001','e9000000-0000-4000-8000-000000000002');
insert into public.orders(id,public_code,customer_id,customer_email_snapshot,customer_name_snapshot,status,payment_status,subtotal,grand_total,shipping_address_snapshot)
values ('e9100000-0000-4000-8000-000000000001','PAYMENT-REFERENCE-TEST','e9000000-0000-4000-8000-000000000001','payment-owner@example.invalid','Fixture','refund_pending','approved',50,50,'{}');
insert into public.payment_provider_customers(id,user_id,payment_mode) values ('e9200000-0000-4000-8000-000000000001','e9000000-0000-4000-8000-000000000001','test');
insert into public.payment_provider_card_operations(id,customer_id,order_id) values ('e9300000-0000-4000-8000-000000000001','e9200000-0000-4000-8000-000000000001','e9100000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e9000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is((select count(id) from public.payment_provider_customers where id='e9200000-0000-4000-8000-000000000001'),1::bigint,'Ativo ve sua referencia');
select is((select count(id) from public.payment_provider_card_operations where id='e9300000-0000-4000-8000-000000000001'),1::bigint,'Ativo ve sua operacao');
select set_config('request.jwt.claims','{"sub":"e9000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is((select count(id) from public.payment_provider_customers where id='e9200000-0000-4000-8000-000000000001'),0::bigint,'Outro cliente nao ve referencia');
select is((select count(id) from public.payment_provider_card_operations where id='e9300000-0000-4000-8000-000000000001'),0::bigint,'Outro cliente nao ve operacao');
reset role;
update public.profiles set status='suspended' where id='e9000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e9000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is((select count(id) from public.payment_provider_customers where id='e9200000-0000-4000-8000-000000000001'),0::bigint,'Suspenso nao ve referencia');
select is((select count(id) from public.payment_provider_card_operations where id='e9300000-0000-4000-8000-000000000001'),0::bigint,'Suspenso nao ve operacao');
reset role;
update public.profiles set status='active',account_closed_at=now() where id='e9000000-0000-4000-8000-000000000001';
set local role authenticated;
select is((select count(id) from public.payment_provider_customers where id='e9200000-0000-4000-8000-000000000001'),0::bigint,'Conta encerrada nao ve referencia');
select is((select count(id) from public.payment_provider_card_operations where id='e9300000-0000-4000-8000-000000000001'),0::bigint,'Conta encerrada nao ve operacao');
reset role;
set local role service_role;
select is((select count(id) from public.payment_provider_customers where id='e9200000-0000-4000-8000-000000000001'),1::bigint,'Servidor preserva acesso');
select * from finish();
rollback;

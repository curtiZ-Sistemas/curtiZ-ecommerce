begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

insert into auth.users(id,instance_id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('cb000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','checkout-one@test.local','{}','{"full_name":"Checkout One"}',now(),now()),
('cb000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','checkout-two@test.local','{}','{"full_name":"Checkout Two"}',now(),now());
update public.profiles set status='active' where id in ('cb000000-0000-4000-8000-000000000001','cb000000-0000-4000-8000-000000000002');
insert into public.user_roles(user_id,role) values
('cb000000-0000-4000-8000-000000000001','customer'),('cb000000-0000-4000-8000-000000000002','customer') on conflict do nothing;
insert into public.categories(id,name,slug) values('cb100000-0000-4000-8000-000000000001','Checkout intent','checkout-intent');
insert into public.products(id,name,slug,short_description,description,category_id,status,base_price,cost_price,weight_grams,height_cm,width_cm,length_cm)
values('cb200000-0000-4000-8000-000000000001','Produto checkout','produto-checkout-intent','Teste','Teste',
'cb100000-0000-4000-8000-000000000001','active',50,20,200,5,10,20);
insert into public.product_variants(id,product_id,sku,color_name,size)
values('cb300000-0000-4000-8000-000000000001','cb200000-0000-4000-8000-000000000001','CHECKOUT-INTENT-37','Preto','37');
insert into public.inventory(variant_id,available_quantity) values('cb300000-0000-4000-8000-000000000001',10);

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"cb000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is((select count(*)::integer from public.orders where customer_id=auth.uid()),0,'Abrir checkout nao cria pedido');
select lives_ok($$select public.preview_professional_checkout(
  '[{"product_id":"cb200000-0000-4000-8000-000000000001","variant_id":"cb300000-0000-4000-8000-000000000001","quantity":1}]',null,'01310100')$$,
  'Preencher endereco e frete apenas cota');
select is((select count(*)::integer from public.orders where customer_id=auth.uid()),0,'Chegar ao pagamento sem metodo nao cria pedido');
select lives_ok($$select public.save_my_checkout_identity('cipher','0001')$$,'Identificacao criptografada pode ser salva sem pedido');
select is((select cpf_last_four from public.profiles where id=auth.uid()),'0001','Perfil reutiliza apenas os ultimos quatro digitos');
select throws_ok($$select public.confirm_professional_checkout_order(
  'cb400000-0000-4000-8000-000000000099','cb000000-0000-4000-8000-000000000001','pix','Checkout One','checkout-one@test.local','11999999999','cipher','0001',
  '{"postalCode":"01310100","street":"Av Paulista","number":"1","complement":"","district":"Bela Vista","city":"Sao Paulo","state":"SP"}',
  '[{"product_id":"cb200000-0000-4000-8000-000000000001","variant_id":"cb300000-0000-4000-8000-000000000001","quantity":1}]',null,30)$$,
  '42501',null,'Cliente nao contorna validacao do backend chamando a confirmacao diretamente');
reset role;
set local role service_role;
select throws_ok($$select public.confirm_professional_checkout_order(
  'cb400000-0000-4000-8000-000000000001','cb000000-0000-4000-8000-000000000001',null,'Checkout One','checkout-one@test.local','11999999999','cipher','0001',
  '{"postalCode":"01310100","street":"Av Paulista","number":"1","complement":"","district":"Bela Vista","city":"Sao Paulo","state":"SP"}',
  '[{"product_id":"cb200000-0000-4000-8000-000000000001","variant_id":"cb300000-0000-4000-8000-000000000001","quantity":1}]',null,30)$$,
  '22023',null,'Confirmacao sem metodo e recusada');
select lives_ok($$select public.confirm_professional_checkout_order(
  'cb400000-0000-4000-8000-000000000001','cb000000-0000-4000-8000-000000000001','pix','Checkout One','checkout-one@test.local','11999999999','cipher','0001',
  '{"postalCode":"01310100","street":"Av Paulista","number":"1","complement":"","district":"Bela Vista","city":"Sao Paulo","state":"SP"}',
  '[{"product_id":"cb200000-0000-4000-8000-000000000001","variant_id":"cb300000-0000-4000-8000-000000000001","quantity":1}]',null,30)$$,
  'PIX confirmado cria pedido');
select is((select count(*)::integer from public.orders where customer_id=auth.uid()),1,'Confirmacao cria exatamente um pedido');
select lives_ok($$select public.confirm_professional_checkout_order(
  'cb400000-0000-4000-8000-000000000001','cb000000-0000-4000-8000-000000000001','pix','Checkout One','checkout-one@test.local','11999999999','cipher','0001',
  '{"postalCode":"01310100","street":"Av Paulista","number":"1","complement":"","district":"Bela Vista","city":"Sao Paulo","state":"SP"}',
  '[{"product_id":"cb200000-0000-4000-8000-000000000001","variant_id":"cb300000-0000-4000-8000-000000000001","quantity":1}]',null,30)$$,
  'Retry com a mesma chave e idempotente');
select is((select count(*)::integer from public.orders where customer_id=auth.uid()),1,'Double click nao duplica pedido');
select is((select shipping_address_snapshot->>'postal_code' from public.orders where customer_id=auth.uid()),'01310100','Pedido guarda snapshot canonico');
reset role;
set local role service_role;
select lives_ok($$select public.begin_mercadopago_payment_attempt(
  (select id from public.orders where customer_id='cb000000-0000-4000-8000-000000000001'),
  'cb500000-0000-4000-8000-000000000001','pix')$$,'Registra tentativa de pagamento');
select lives_ok($$select public.begin_mercadopago_payment_attempt(
  (select id from public.orders where customer_id='cb000000-0000-4000-8000-000000000001'),
  'cb500000-0000-4000-8000-000000000001','pix')$$,'Retry reutiliza tentativa');
select is((select count(*)::integer from public.payment_attempts where idempotency_key='cb500000-0000-4000-8000-000000000001'),1,'Tentativa tambem e idempotente');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"cb000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select lives_ok($$select public.save_customer_address(null,'Casa','Checkout One','01310100','Av Paulista','1','','Bela Vista','Sao Paulo','SP',true)$$,'Salva Casa');
select lives_ok($$select public.save_customer_address(
  (select id from public.addresses where user_id=auth.uid() and label='Casa'),
  'Casa','Checkout One','22041001','Rua Nova','99','','Copacabana','Rio de Janeiro','RJ',true)$$,'Edita endereco salvo');
select is((select shipping_address_snapshot->>'postal_code' from public.orders where customer_id=auth.uid()),'01310100','Edicao do cadastro nao altera snapshot antigo');
select lives_ok($$select public.save_customer_address(null,'Casa','Checkout One','01310101','Av Paulista','2','','Bela Vista','Sao Paulo','SP',false)$$,'Salva segunda Casa');
select is((select string_agg(label,',' order by created_at) from public.addresses where user_id=auth.uid()),'Casa,Casa 2','Gera rotulo Casa 2');
select lives_ok($$select public.save_customer_address(null,'Trabalho','Checkout One','01310102','Av Paulista','3','','Bela Vista','Sao Paulo','SP',false)$$,'Salva terceiro endereco');
select throws_ok($$select public.save_customer_address(null,'Trabalho','Checkout One','01310103','Av Paulista','4','','Bela Vista','Sao Paulo','SP',false)$$,
  '23514',null,'Banco bloqueia quarto endereco');
select set_config('request.jwt.claims','{"sub":"cb000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is((select count(*)::integer from public.addresses),0,'Outro cliente nao enxerga enderecos alheios por RLS');

reset role;
set local role service_role;
update public.profiles set status='disabled' where id='cb000000-0000-4000-8000-000000000001';
select is(
  (select count(*)::integer from private.customer_checkout_identity where user_id='cb000000-0000-4000-8000-000000000001'),
  0,
  'Encerramento da conta remove identificacao privada reutilizavel'
);

select * from finish();
rollback;

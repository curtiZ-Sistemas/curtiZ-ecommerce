begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users(id,instance_id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('c6000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','operations-one@test.local','{}','{}',now(),now()),
('c6000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','operations-two@test.local','{}','{}',now(),now());
update public.profiles set status='active' where id in (
  'c6000000-0000-4000-8000-000000000001', 'c6000000-0000-4000-8000-000000000002'
);

insert into public.categories(id,name,slug)
values('c6100000-0000-4000-8000-000000000001','Operações checkout','operacoes-checkout');
insert into public.products(
  id,name,slug,short_description,description,category_id,status,base_price,cost_price,
  weight_grams,height_cm,width_cm,length_cm
) values (
  'c6200000-0000-4000-8000-000000000001','Produto operações','produto-operacoes','Teste','Teste',
  'c6100000-0000-4000-8000-000000000001','active',50,20,200,5,10,20
);
insert into public.product_variants(id,product_id,sku,color_name,size)
values('c6300000-0000-4000-8000-000000000001','c6200000-0000-4000-8000-000000000001','OPS-CHECKOUT-37','Preto','37');
insert into public.inventory(variant_id,available_quantity)
values('c6300000-0000-4000-8000-000000000001',0);

set local role anon;
select ok(has_function_privilege('anon','public.cart_variant_stock_availability(uuid[])','execute'),
  'Anon executa somente a RPC pública de disponibilidade');
select is(
  (public.cart_variant_stock_availability(array['c6300000-0000-4000-8000-000000000001'::uuid])->0->>'available')::boolean,
  false,
  'Estoque zero não fica disponível'
);
reset role;
update public.inventory set available_quantity=2 where variant_id='c6300000-0000-4000-8000-000000000001';
set local role anon;
select is(
  (public.cart_variant_stock_availability(array['c6300000-0000-4000-8000-000000000001'::uuid])->0->>'available')::boolean,
  true,
  'Estoque positivo fica disponível'
);
select ok(not has_function_privilege('anon','public.list_my_visible_orders(integer)','execute'),
  'Anon não lista pedidos de clientes');
reset role;

insert into public.orders(
  id,public_code,customer_id,customer_email_snapshot,customer_name_snapshot,status,payment_status,
  subtotal,grand_total,shipping_address_snapshot,created_at
) values
('c6400000-0000-4000-8000-000000000001','CZT-OPS-VISIBLE','c6000000-0000-4000-8000-000000000001','one@test.local','One','pending_payment','pending',50,50,'{}',now()-interval '1 day'),
('c6400000-0000-4000-8000-000000000002','CZT-OPS-HIDDEN','c6000000-0000-4000-8000-000000000001','one@test.local','One','draft','pending',50,50,'{}',now()),
('c6400000-0000-4000-8000-000000000003','CZT-OPS-OTHER','c6000000-0000-4000-8000-000000000002','two@test.local','Two','pending_payment','pending',50,50,'{}',now());
insert into public.payments(
  order_id,provider,provider_payment_id,external_reference,status,amount,payment_method_summary,expires_at
) values
('c6400000-0000-4000-8000-000000000001','mercadopago','ops-visible','CZT-OPS-VISIBLE','pending',50,'pix',now()+interval '1 hour'),
('c6400000-0000-4000-8000-000000000002','mercadopago',null,'CZT-OPS-HIDDEN','pending',50,null,now()+interval '1 hour'),
('c6400000-0000-4000-8000-000000000003','mercadopago','ops-other','CZT-OPS-OTHER','pending',50,'pix',now()+interval '1 hour');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"c6000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select ok(has_function_privilege('authenticated','public.list_my_visible_orders(integer)','execute'),
  'Cliente autenticado pode listar os próprios pedidos visíveis');
select is(jsonb_array_length(public.list_my_visible_orders(1)),1,
  'Limite é aplicado depois de descartar pedidos internos');
select is(public.list_my_visible_orders(1)->0->>'id','c6400000-0000-4000-8000-000000000001',
  'Pedido visível antigo não é escondido pelo pedido interno recente');
select is(jsonb_array_length(public.list_my_visible_orders(50)),1,
  'Ownership exclui pedido de outro cliente');
select throws_ok($$select public.list_my_visible_orders(51)$$,'22023',null,
  'Consulta não permite carregamento ilimitado');
select throws_ok($$select public.list_my_visible_orders(null)$$,'22023',null,
  'Limite nulo não permite consulta ilimitada');
reset role;
update public.payments set expires_at=now()-interval '1 minute'
where order_id='c6400000-0000-4000-8000-000000000001';
set local role authenticated;
select is(jsonb_array_length(public.list_my_visible_orders(50)),0,
  'Pagamento vencido fica oculto antes da paginação');
reset role;
select throws_ok($$select private.expire_stale_mercadopago_orders(null)$$,'22023',null,
  'Housekeeping também rejeita limite nulo');

select * from finish();
rollback;

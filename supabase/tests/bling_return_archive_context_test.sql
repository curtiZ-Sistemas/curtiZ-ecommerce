-- Synthetic, isolated fixtures only; all changes roll back.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select ok(not has_function_privilege('anon','public.read_bling_return_fiscal_context(uuid)','execute'),'Anon cannot read original fiscal context');
select ok(not has_function_privilege('authenticated','public.read_bling_return_fiscal_context(uuid)','execute'),'Browser cannot read private archive metadata');
select ok(has_function_privilege('service_role','public.read_bling_return_fiscal_context(uuid)','execute'),'Authorized server can read context');
select ok(not has_function_privilege('service_role','private.check_return_item_cumulative_balance()','execute'),'Trigger is not a callable service bypass');
set local role authenticated;
select throws_ok($$select public.read_bling_return_fiscal_context('bb600000-0000-4000-8000-000000000002')$$,'42501',null,'Browser execution is denied, not merely hidden in UI');
reset role;
-- BEGIN RETURN BALANCE FIXTURE
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
values('bb000000-0000-4000-8000-000000000001','authenticated','authenticated','return-archive-test@example.invalid','{}','{"full_name":"Return archive test"}'),
('bb000000-0000-4000-8000-000000000002','authenticated','authenticated','return-archive-other@example.invalid','{}','{"full_name":"Return archive other"}');
update public.profiles set status='active' where id in ('bb000000-0000-4000-8000-000000000001','bb000000-0000-4000-8000-000000000002');
insert into public.categories(id,name,slug) values('bb100000-0000-4000-8000-000000000001','Return archive test','return-archive-test');
insert into public.products(id,name,slug,category_id,status,base_price,description,weight_grams,height_cm,width_cm,length_cm)
values('bb200000-0000-4000-8000-000000000001','Synthetic pair','return-archive-test','bb100000-0000-4000-8000-000000000001','draft',10,'Synthetic pair',100,5,10,20);
insert into public.product_variants(id,product_id,sku,color_name,size)
values('bb300000-0000-4000-8000-000000000001','bb200000-0000-4000-8000-000000000001','RETURN-ARCHIVE-TEST','Test','37');
insert into public.orders(id,customer_id,customer_email_snapshot,customer_name_snapshot,status,payment_status,subtotal,discount_total,shipping_total,grand_total,shipping_address_snapshot)
values('bb400000-0000-4000-8000-000000000001','bb000000-0000-4000-8000-000000000001','return-archive-test@example.invalid','Return archive test','pending_payment','pending',20,10,2,12,'{}');
insert into public.order_items(id,order_id,product_id,variant_id,product_name_snapshot,sku_snapshot,color_snapshot,size_snapshot,quantity,unit_price,total)
values('bb500000-0000-4000-8000-000000000001','bb400000-0000-4000-8000-000000000001','bb200000-0000-4000-8000-000000000001','bb300000-0000-4000-8000-000000000001','Synthetic pair','RETURN-ARCHIVE-TEST','Test','37',2,10,20);
insert into public.returns(id,order_id,customer_id,reason,description,requested_resolution,eligibility_snapshot,status)
select id::uuid,'bb400000-0000-4000-8000-000000000001','bb000000-0000-4000-8000-000000000001','Fixture','Synthetic return fixture','refund','{}',status::public.return_status
from (values('bb600000-0000-4000-8000-000000000001','completed'),('bb600000-0000-4000-8000-000000000002','requested'),('bb600000-0000-4000-8000-000000000003','rejected')) v(id,status);
insert into public.return_items(id,return_id,order_item_id,quantity)
select id::uuid,ret::uuid,'bb500000-0000-4000-8000-000000000001',1 from (values
('bb700000-0000-4000-8000-000000000001','bb600000-0000-4000-8000-000000000001'),
('bb700000-0000-4000-8000-000000000002','bb600000-0000-4000-8000-000000000002'),
('bb700000-0000-4000-8000-000000000003','bb600000-0000-4000-8000-000000000003')) v(id,ret);
-- END RETURN BALANCE FIXTURE
select throws_ok($$update public.return_items set quantity=2 where id='bb700000-0000-4000-8000-000000000002'$$,'23514','return_cumulative_quantity_exceeded','Completed return consumes quantity');
select throws_ok($$update public.returns set status='approved' where id='bb600000-0000-4000-8000-000000000003'$$,'23514','return_cumulative_quantity_exceeded','Reactivation cannot bypass the balance');
select throws_ok($$update public.return_items set return_id='bb600000-0000-4000-8000-000000000003' where id='bb700000-0000-4000-8000-000000000002'$$,'23514','return_item_identity_immutable','Existing item cannot be reassigned');
select throws_ok($$update public.returns set customer_id='bb000000-0000-4000-8000-000000000002' where id='bb600000-0000-4000-8000-000000000002'$$,'23514','return_identity_immutable','Original customer cannot be reassigned');
select is(public.read_bling_return_fiscal_context('bb600000-0000-4000-8000-000000000002'),null::jsonb,'No context without authorized archive');
insert into private.bling_order_links(order_id) values('bb400000-0000-4000-8000-000000000001');
select ok(public.save_bling_order_link('bb400000-0000-4000-8000-000000000001',994001,null),'Synthetic external order linked');
select ok(public.save_bling_invoice_draft('bb400000-0000-4000-8000-000000000001',994002),'Synthetic invoice linked');
select is(public.read_bling_return_fiscal_context('bb600000-0000-4000-8000-000000000002'),null::jsonb,'Draft is not an authorized source');
select ok(public.observe_bling_invoice(994002,(select public_code from public.orders where id='bb400000-0000-4000-8000-000000000001'),5,'1',repeat('1',44),now()),'Synthetic provider authorization observed');
select is(public.read_bling_return_fiscal_context('bb600000-0000-4000-8000-000000000002'),null::jsonb,'Authorization without XML archive is insufficient');
select ok(public.save_bling_invoice_archive('bb400000-0000-4000-8000-000000000001',994002,'xml','bb400000-0000-4000-8000-000000000001/994002/'||repeat('a',64)||'.xml',repeat('a',64)),'Synthetic archive metadata recorded');
select is(public.read_bling_return_fiscal_context('bb600000-0000-4000-8000-000000000002')#>>'{items,0,requestedQuantity}','1','Current requested quantity loaded');
select is(public.read_bling_return_fiscal_context('bb600000-0000-4000-8000-000000000002')#>>'{items,0,otherReturnsQuantity}','1','Completed included; rejected excluded');
set local role service_role;
select is(public.read_bling_return_fiscal_context('bb600000-0000-4000-8000-000000000002')#>>'{items,0,otherReturnsQuantity}','1','Server function reads the canonical cumulative balance with service privileges');
reset role;
select is(public.read_bling_return_fiscal_context('bb600000-0000-4000-8000-000000000002')#>>'{totals,totalInCents}','1200','Original total comes from order, not current price');
update public.products set base_price=999 where id='bb200000-0000-4000-8000-000000000001';
select is(public.read_bling_return_fiscal_context('bb600000-0000-4000-8000-000000000002')#>>'{items,0,unitPriceInCents}','1000','Catalog changes never change archived return price');
select is(public.read_bling_return_fiscal_context('bb600000-0000-4000-8000-000000000003'),null::jsonb,'Rejected return has no fiscal preview context');
select lives_ok($$update public.returns set status='cancelled' where id='bb600000-0000-4000-8000-000000000002'$$,'Cancellation releases request quantity');
select lives_ok($$update public.returns set status='approved' where id='bb600000-0000-4000-8000-000000000003'$$,'Another request may reserve only the released quantity');
select throws_ok($$update public.returns set status='approved' where id='bb600000-0000-4000-8000-000000000002'$$,'23514','return_cumulative_quantity_exceeded','Cancelled request cannot reserve consumed units again');
select * from finish();
rollback;

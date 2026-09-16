begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
values ('e0000000-0000-4000-8000-000000000001','authenticated','authenticated','isolation-a@example.invalid','{}','{"full_name":"Isolation A"}'),
       ('e0000000-0000-4000-8000-000000000002','authenticated','authenticated','isolation-b@example.invalid','{}','{"full_name":"Isolation B"}');
update public.profiles set status='active' where id in ('e0000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000002');
insert into public.user_roles(user_id,role) values
  ('e0000000-0000-4000-8000-000000000001','customer'),('e0000000-0000-4000-8000-000000000002','customer') on conflict do nothing;
insert into public.categories(id,name,slug) values ('e1000000-0000-4000-8000-000000000001','Isolation','isolation-fixture');
insert into public.products(id,name,slug,category_id,status,base_price,description,weight_grams,height_cm,width_cm,length_cm)
values ('e2000000-0000-4000-8000-000000000001','Isolation Product','isolation-fixture','e1000000-0000-4000-8000-000000000001','active',50,'Isolation fixture',100,5,10,20);
insert into public.product_variants(id,product_id,sku,color_name,size)
values ('e3000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','ISOLATION-37','Preto','37');
insert into public.addresses(id,user_id,label,recipient_name,postal_code,street,number,district,city,state)
values ('e4000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000002','Casa','Isolation B','01001000','Fixture','1','Fixture','Fixture','SP');
insert into public.carts(id,customer_id) values ('e5000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000002');
insert into public.cart_items(id,cart_id,variant_id,quantity,unit_price_snapshot)
values ('e5100000-0000-4000-8000-000000000001','e5000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001',1,50);
insert into public.favorites(id,customer_id,product_id,variant_id)
values ('e6000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000002','e2000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001');
insert into public.orders(id,customer_id,customer_email_snapshot,customer_name_snapshot,status,subtotal,grand_total,shipping_address_snapshot)
values ('e7000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000002','isolation-b@example.invalid','Isolation B','delivered',50,50,'{}');
insert into public.order_items(id,order_id,product_id,variant_id,product_name_snapshot,sku_snapshot,color_snapshot,size_snapshot,quantity,unit_price,total)
values ('e7100000-0000-4000-8000-000000000001','e7000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001','Isolation Product','ISOLATION-37','Preto','37',1,50,50);
insert into public.payments(id,order_id,provider,external_reference,amount)
values ('e8000000-0000-4000-8000-000000000001','e7000000-0000-4000-8000-000000000001','mercadopago','isolation-payment-fixture',50);
insert into public.shipments(id,order_id,provider,service)
values ('e9000000-0000-4000-8000-000000000001','e7000000-0000-4000-8000-000000000001','fixture','fixture');
insert into public.tracking_events(id,shipment_id,status,description,occurred_at)
values ('e9100000-0000-4000-8000-000000000001','e9000000-0000-4000-8000-000000000001','pending','Fixture',now());
insert into public.returns(id,order_id,customer_id,reason,description,requested_resolution,eligibility_snapshot)
values ('ea000000-0000-4000-8000-000000000001','e7000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000002','Fixture','Isolation fixture','refund','{}');
insert into public.notifications(id,user_id,type,title,body)
values ('eb000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000002','fixture','Fixture','Fixture');
insert into public.representative_applications(id,user_id)
values ('ec000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000002');
insert into public.representative_application_documents(id,application_id,document_type,storage_path,original_name,mime_type,size_bytes,checksum_sha256,uploaded_by)
values ('ed000000-0000-4000-8000-000000000001','ec000000-0000-4000-8000-000000000001','identity_front','isolation-fixture/document.pdf','fixture.pdf','application/pdf',100,repeat('a',64),'e0000000-0000-4000-8000-000000000002');
insert into storage.objects(id,bucket_id,name)
values ('ee000000-0000-4000-8000-000000000001','customer-private','e0000000-0000-4000-8000-000000000002/avatar/fixture.webp');

create temporary table isolation_targets(target regclass, fixture_id uuid);
insert into isolation_targets values
 ('public.profiles','e0000000-0000-4000-8000-000000000002'),('public.addresses','e4000000-0000-4000-8000-000000000001'),
 ('public.carts','e5000000-0000-4000-8000-000000000001'),('public.cart_items','e5100000-0000-4000-8000-000000000001'),
 ('public.favorites','e6000000-0000-4000-8000-000000000001'),('public.orders','e7000000-0000-4000-8000-000000000001'),
 ('public.order_items','e7100000-0000-4000-8000-000000000001'),('public.payments','e8000000-0000-4000-8000-000000000001'),
 ('public.shipments','e9000000-0000-4000-8000-000000000001'),('public.tracking_events','e9100000-0000-4000-8000-000000000001'),
 ('public.returns','ea000000-0000-4000-8000-000000000001'),('public.notifications','eb000000-0000-4000-8000-000000000001'),
 ('public.representative_applications','ec000000-0000-4000-8000-000000000001'),
 ('public.representative_application_documents','ed000000-0000-4000-8000-000000000001'),('storage.objects','ee000000-0000-4000-8000-000000000001');
grant select on isolation_targets to authenticated;

-- Ephemeral invoker helpers execute under the tested role, never bypassing RLS.
create function public.test_isolation_read(target regclass, fixture_id uuid) returns bigint
language plpgsql security invoker set search_path='' as $$
declare result bigint;
begin
  execute pg_catalog.format('select count(*) from %s where id=$1',target) into result using fixture_id;
  return result;
end;
$$;
create function public.test_isolation_update(target regclass, fixture_id uuid) returns bigint
language plpgsql security invoker set search_path='' as $$
declare result bigint;
begin
  execute pg_catalog.format('update %s set id=id where id=$1',target) using fixture_id;
  get diagnostics result = row_count;
  return result;
exception when insufficient_privilege then return 0;
end;
$$;
grant execute on function public.test_isolation_read(regclass,uuid),public.test_isolation_update(regclass,uuid) to authenticated;
select ok(c.relrowsecurity and c.relforcerowsecurity, target::text || ' preserves forced RLS')
from isolation_targets join pg_class c on c.oid=target where target <> 'storage.objects'::regclass;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e0000000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"role":"admin"}}',true);
select is(public.test_isolation_read(target,fixture_id),0::bigint,'A cannot read B: ' || target::text) from isolation_targets;
select is(public.test_isolation_update(target,fixture_id),0::bigint,'A cannot mutate B: ' || target::text) from isolation_targets;
select throws_ok($$select public.request_customer_return('e7100000-0000-4000-8000-000000000001',1,'Fixture','Isolation fixture','refund')$$,
  'P0002','delivered_item_not_found','Customer cannot request a return against another customer order item');
select throws_ok($$insert into public.returns(order_id,customer_id,reason,description,requested_resolution,eligibility_snapshot)
  values('e7000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000001','Fixture','Isolation fixture','refund','{}')$$,
  '42501',null,'Direct insertion cannot bypass ownership and eligibility RPC');

select set_config('request.jwt.claims','{"sub":"e0000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is(public.test_isolation_read(target,fixture_id),1::bigint,'Owner B can read its fixture: ' || target::text) from isolation_targets;
reset role;
select * from finish();
rollback;

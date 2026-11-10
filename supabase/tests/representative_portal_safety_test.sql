begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data) values
 ('f1000000-0000-4000-8000-000000000001','authenticated','authenticated','portal-a@example.invalid','{}','{"full_name":"Portal A"}'),
 ('f1000000-0000-4000-8000-000000000002','authenticated','authenticated','portal-b@example.invalid','{}','{"full_name":"Portal B"}');
update public.profiles set status='active' where id in ('f1000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000002');
insert into public.user_roles(user_id,role) values
 ('f1000000-0000-4000-8000-000000000001','representative'),
 ('f1000000-0000-4000-8000-000000000002','representative') on conflict do nothing;
insert into public.representative_applications(id,user_id) values
 ('f2000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001'),
 ('f2000000-0000-4000-8000-000000000002','f1000000-0000-4000-8000-000000000002');
insert into public.representatives(id,user_id,application_id,status) values
 ('f3000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','active'),
 ('f3000000-0000-4000-8000-000000000002','f1000000-0000-4000-8000-000000000002','f2000000-0000-4000-8000-000000000002','active');
insert into public.categories(id,name,slug) values ('f8000000-0000-4000-8000-000000000001','Portal fixture','portal-safety-fixture');
insert into public.products(id,name,slug,category_id,status,base_price,description,weight_grams,height_cm,width_cm,length_cm)
values ('f8100000-0000-4000-8000-000000000001','Portal fixture','portal-safety-fixture','f8000000-0000-4000-8000-000000000001','draft',50,'Fixture',100,5,10,20);
insert into public.product_images(product_id,storage_path,alt_text,width,height,is_primary)
values ('f8100000-0000-4000-8000-000000000001','test/portal-safety.webp','Fixture',720,720,true);
update public.products set status='active' where id='f8100000-0000-4000-8000-000000000001';
insert into public.product_variants(id,product_id,sku,color_name,size)
values ('f8200000-0000-4000-8000-000000000001','f8100000-0000-4000-8000-000000000001','PORTAL-SAFETY-37','Preto','37');
insert into public.representative_inventory(representative_id,variant_id,quantity)
values ('f3000000-0000-4000-8000-000000000001','f8200000-0000-4000-8000-000000000001',2);
insert into public.representative_sales(id,representative_id,status,channel,subtotal_in_cents,total_in_cents,idempotency_key) values
 ('f4000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001','confirmed','manual',1000,1000,'portal-safety-sale-a-0001'),
 ('f4000000-0000-4000-8000-000000000002','f3000000-0000-4000-8000-000000000001','cancelled','manual',9000,9000,'portal-safety-sale-a-0002'),
 ('f4000000-0000-4000-8000-000000000003','f3000000-0000-4000-8000-000000000002','confirmed','manual',7000,7000,'portal-safety-sale-b-0001');
insert into public.commission_rules(id,name,version,basis_points,effective_from,created_by)
values ('f5000000-0000-4000-8000-000000000001','Portal safety fixture',1,1000,now(),'f1000000-0000-4000-8000-000000000001');
insert into public.commission_entries(id,representative_id,sale_id,rule_id,source_event,source_event_id,status,eligible_amount_in_cents,commission_in_cents,rule_snapshot) values
 ('f6000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001','f4000000-0000-4000-8000-000000000001','f5000000-0000-4000-8000-000000000001','fixture','portal-safety-1','paid',1000,100,'{}'),
 ('f6000000-0000-4000-8000-000000000002','f3000000-0000-4000-8000-000000000002','f4000000-0000-4000-8000-000000000003','f5000000-0000-4000-8000-000000000001','fixture','portal-safety-2','payable',7000,700,'{}');

select throws_ok($$update public.representative_sales set status='cancelled' where id='f4000000-0000-4000-8000-000000000001'$$,
  '23514','sale has a settled or closed commission','paid commission blocks cancellation');
select is((select status::text from public.representative_sales where id='f4000000-0000-4000-8000-000000000001'),'confirmed','failed cancellation leaves sale confirmed');
select throws_ok($$delete from public.commission_entries where id='f6000000-0000-4000-8000-000000000001'$$,
  '23514','sale commission is already paid','paid commission cannot be deleted even after a stale earlier check');
insert into public.commission_closings(id,period_start,period_end,simulated_by)
values ('f7000000-0000-4000-8000-000000000001',current_date,current_date,'f1000000-0000-4000-8000-000000000001');
insert into public.commission_closing_entries(closing_id,commission_entry_id,amount_in_cents)
values ('f7000000-0000-4000-8000-000000000001','f6000000-0000-4000-8000-000000000002',700);
select throws_ok($$update public.representative_sales set status='cancelled' where id='f4000000-0000-4000-8000-000000000003'$$,
  '23514','sale has a settled or closed commission','closing blocks cancellation');
select throws_ok($$insert into public.commission_closing_entries(closing_id,commission_entry_id,amount_in_cents)
  values ('f7000000-0000-4000-8000-000000000001','f6000000-0000-4000-8000-000000000001',100)$$,
  '23514','commission is not eligible for closing','paid commission cannot be added to a new closing');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is((public.get_representative_portal_totals()->>'confirmed_sales_in_cents')::bigint,1000::bigint,'totals exclude cancelled and other representative sales');
select is((public.get_representative_portal_totals()->>'available_commission_in_cents')::bigint,0::bigint,'totals exclude paid and other representative commission');
select is((select count(*) from public.representative_sales where id='f4000000-0000-4000-8000-000000000003'),0::bigint,'representative cannot read another representative sale');
select throws_ok($$select public.delete_representative_sale('f4000000-0000-4000-8000-000000000003','EXCLUIR')$$,
  'P0002','sale not found','representative cannot delete another representative sale');
select throws_ok($$select public.delete_representative_sale('f4000000-0000-4000-8000-000000000001','EXCLUIR')$$,
  '23514','sale commission is already paid','representative cannot delete a sale with paid commission');
select is((public.delete_representative_sale('f4000000-0000-4000-8000-000000000002','EXCLUIR')->>'deleted')::boolean,true,'owner may delete an eligible cancelled sale');
select set_config('request.jwt.claims','{"sub":"f1000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is((public.get_representative_portal_totals()->>'confirmed_sales_in_cents')::bigint,7000::bigint,'second representative sees own total');
select is((public.get_representative_portal_totals()->>'available_commission_in_cents')::bigint,700::bigint,'second representative sees own payable commission');
select throws_ok($$select public.delete_representative_sale('f4000000-0000-4000-8000-000000000003','EXCLUIR')$$,
  '23514','sale commission is in a closing','representative cannot delete a sale included in a closing');
select set_config('request.jwt.claims','{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is((public.record_representative_sale('f9000000-0000-4000-8000-000000000001',
  '[{"variantId":"f8200000-0000-4000-8000-000000000001","quantity":2}]'::jsonb,null)).total_in_cents,
  10000::bigint,'sale is priced by the server');
select is((public.record_representative_sale('f9000000-0000-4000-8000-000000000001',
  '[{"variantId":"f8200000-0000-4000-8000-000000000001","quantity":2}]'::jsonb,null)).total_in_cents,
  10000::bigint,'retry returns the original sale even after inventory is depleted');
select is((select quantity from public.representative_inventory where representative_id='f3000000-0000-4000-8000-000000000001'
  and variant_id='f8200000-0000-4000-8000-000000000001'),0,'retry does not deduct inventory twice');
select is((select count(*) from public.representative_sales where idempotency_key='f9000000-0000-4000-8000-000000000001'),1::bigint,'retry does not create a second sale');
select throws_ok($$select public.record_representative_sale('f9000000-0000-4000-8000-000000000002',
  '[{"variantId":"f8200000-0000-4000-8000-000000000001","quantity":1}]'::jsonb,null)$$,
  '23514','insufficient representative inventory','new key cannot sell depleted inventory');
reset role;
select * from finish();
rollback;

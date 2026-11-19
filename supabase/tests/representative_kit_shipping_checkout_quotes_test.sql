begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

create temporary table kit_shipping_fixture as
select gen_random_uuid() actor, gen_random_uuid() outsider, gen_random_uuid() application, gen_random_uuid() representative,
  gen_random_uuid() category, gen_random_uuid() product, gen_random_uuid() variant, gen_random_uuid() address,
  null::uuid quote, null::uuid expiry_quote;
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
  select actor,'kit-shipping@example.invalid','{}'::jsonb,'{}'::jsonb from kit_shipping_fixture
  union all select outsider,'kit-shipping-outsider@example.invalid','{}'::jsonb,'{}'::jsonb from kit_shipping_fixture;
update public.profiles set status='active' where id=(select actor from kit_shipping_fixture);
insert into public.representative_applications(id,user_id) select application,actor from kit_shipping_fixture;
insert into public.representatives(id,user_id,application_id,status)
  select representative,actor,application,'approved_waiting_kit' from kit_shipping_fixture;
insert into public.categories(id,name,slug) select category,'Kit shipping test',category::text from kit_shipping_fixture;
insert into public.products(id,name,slug,category_id,status,base_price)
  select product,'Kit shipping test',product::text,category,'draft',50 from kit_shipping_fixture;
insert into public.product_variants(id,product_id,sku,color_name,size)
  select variant,product,'TEST-SHIPPING-'||variant::text,'White','37' from kit_shipping_fixture;
insert into public.product_images(product_id,storage_path,alt_text,width,height,is_primary)
  select product,'test/kit-shipping.webp','Shipping fixture',720,720,true from kit_shipping_fixture;
update public.products set status='active' where id=(select product from kit_shipping_fixture);
insert into public.inventory(variant_id,available_quantity,reserved_quantity)
  select variant,3,0 from kit_shipping_fixture;
insert into private.bling_catalog_metadata(product_id,commercial_unit,pairs_per_sku,ncm,origin,cest,production_type,evidence_reference)
  select product,'UN',2,'64022000',0,'','T','Shipping fixture' from kit_shipping_fixture;
insert into public.addresses(id,user_id,label,recipient_name,postal_code,street,number,district,city,state)
  select address,actor,'Test','Test recipient','30110-100','Test street','1','Test district','Test city','MG' from kit_shipping_fixture;

create function pg_temp.issue_kit_quote(p_actor uuid, p_postal_code text, p_expires_at timestamptz)
returns jsonb language sql as $$
  select public.issue_representative_kit_shipping_quote(p_actor,variant,2,address,p_postal_code,repeat('a',64),
    '1','PAC','Correios',2100,1800,4,'[]'::jsonb,p_expires_at)
  from kit_shipping_fixture;
$$;

select ok(not has_function_privilege('authenticated','public.issue_representative_kit_shipping_quote(uuid,uuid,integer,uuid,text,text,text,text,text,integer,integer,integer,jsonb,timestamptz)','execute'),
  'signed-in clients cannot issue private quotes with a forged price');
select ok(has_function_privilege('service_role','public.issue_representative_kit_shipping_quote(uuid,uuid,integer,uuid,text,text,text,text,text,integer,integer,integer,jsonb,timestamptz)','execute'),
  'only the server can issue production kit freight');
select ok(not has_table_privilege('service_role','private.representative_kit_shipping_checkout_quotes','insert'),
  'direct quote writes are unavailable even to the service role');
select ok(not has_function_privilege('service_role','private.consume_representative_kit_shipping_quote(uuid,uuid,uuid,integer,uuid,text)','execute'),
  'consumption is internal to the eventual order transaction');
select is(pg_temp.issue_kit_quote((select outsider from kit_shipping_fixture),'30110100',now()+interval '1 hour'),null::jsonb,
  'another account cannot use the saved address');
select is(pg_temp.issue_kit_quote((select actor from kit_shipping_fixture),'99999999',now()+interval '1 hour'),null::jsonb,
  'address CEP must match what the provider quoted');
select is(pg_temp.issue_kit_quote((select actor from kit_shipping_fixture),'30110100',now()-interval '1 second'),null::jsonb,
  'expired provider responses cannot be issued');
update public.addresses set state='SP' where id=(select address from kit_shipping_fixture);
select throws_ok($$select pg_temp.issue_kit_quote((select actor from kit_shipping_fixture),'30110100',now()+interval '1 hour')$$,
  '23514','representative_kit_address_outside_mg','a false MG postal/state combination cannot issue a quote');
update public.addresses set state='MG' where id=(select address from kit_shipping_fixture);

update kit_shipping_fixture set quote=(pg_temp.issue_kit_quote(actor,'30110100',now()+interval '1 hour')->>'id')::uuid;
select ok((select quote is not null from kit_shipping_fixture),'a fresh quote is issued');
select is((select q.expires_at from private.representative_kit_shipping_checkout_quotes q join kit_shipping_fixture f on q.id=f.quote),
  now()+interval '30 minutes','validity is capped at thirty minutes');
select is((select (private.consume_representative_kit_shipping_quote(quote,actor,variant,3,address,repeat('a',64))).id from kit_shipping_fixture),
  null::uuid,'quantity changes invalidate the quote');
select is((select (private.consume_representative_kit_shipping_quote(quote,actor,variant,2,address,repeat('b',64))).id from kit_shipping_fixture),
  null::uuid,'changes in the package fingerprint invalidate the quote');
update public.profiles set status='disabled' where id=(select actor from kit_shipping_fixture);
select is((select (private.consume_representative_kit_shipping_quote(quote,actor,variant,2,address,repeat('a',64))).id from kit_shipping_fixture),
  null::uuid,'disabled account cannot consume a previously issued quote');
update public.profiles set status='active' where id=(select actor from kit_shipping_fixture);
update public.product_variants set active=false where id=(select variant from kit_shipping_fixture);
select is((select (private.consume_representative_kit_shipping_quote(quote,actor,variant,2,address,repeat('a',64))).id from kit_shipping_fixture),
  null::uuid,'disabled variant cannot consume a previously issued quote');
update public.product_variants set active=true where id=(select variant from kit_shipping_fixture);
update public.inventory set available_quantity=1 where variant_id=(select variant from kit_shipping_fixture);
select is((select (private.consume_representative_kit_shipping_quote(quote,actor,variant,2,address,repeat('a',64))).id from kit_shipping_fixture),
  null::uuid,'stock shortage cannot consume a previously issued quote');
update public.inventory set available_quantity=3 where variant_id=(select variant from kit_shipping_fixture);
select is((select (private.consume_representative_kit_shipping_quote(quote,actor,variant,2,address,repeat('a',64))).amount_in_cents from kit_shipping_fixture),
  2100,'the transaction obtains the server-quoted amount');
select is((select (private.consume_representative_kit_shipping_quote(quote,actor,variant,2,address,repeat('a',64))).id from kit_shipping_fixture),
  null::uuid,'a consumed quote cannot be used twice');

update kit_shipping_fixture set quote=(pg_temp.issue_kit_quote(actor,'30110100',now()+interval '1 hour')->>'id')::uuid,
  expiry_quote=(pg_temp.issue_kit_quote(actor,'30110100',now()+interval '1 hour')->>'id')::uuid;
update private.representative_kit_shipping_checkout_quotes set created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour'
  where id=(select expiry_quote from kit_shipping_fixture);
select is((select (private.consume_representative_kit_shipping_quote(expiry_quote,actor,variant,2,address,repeat('a',64))).id from kit_shipping_fixture),
  null::uuid,'an expired internal quote cannot be consumed');
update public.addresses set street='Edited street',updated_at=now()+interval '1 second' where id=(select address from kit_shipping_fixture);
select is((select (private.consume_representative_kit_shipping_quote(quote,actor,variant,2,address,repeat('a',64))).id from kit_shipping_fixture),
  null::uuid,'editing address details invalidates a quote even when CEP is unchanged');

select * from finish();
rollback;

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

create temporary table commercial_kit_fixture as
select gen_random_uuid() actor, gen_random_uuid() outsider, gen_random_uuid() application, gen_random_uuid() representative,
  gen_random_uuid() category, gen_random_uuid() product, gen_random_uuid() variant, gen_random_uuid() address,
  null::uuid quote, null::uuid expiry_quote;
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
  select actor,'kit-shipping@example.invalid','{}'::jsonb,'{}'::jsonb from commercial_kit_fixture
  union all select outsider,'kit-shipping-outsider@example.invalid','{}'::jsonb,'{}'::jsonb from commercial_kit_fixture;
update public.profiles set status='active' where id=(select actor from commercial_kit_fixture);
insert into public.representative_applications(id,user_id) select application,actor from commercial_kit_fixture;
insert into public.representatives(id,user_id,application_id,status)
  select representative,actor,application,'approved_waiting_kit' from commercial_kit_fixture;
insert into public.categories(id,name,slug) select category,'Kit shipping test',category::text from commercial_kit_fixture;
insert into public.products(id,name,slug,category_id,status,base_price,weight_grams,width_cm,height_cm,length_cm)
  select product,'Kit shipping test',product::text,category,'draft',50,250,10,5,20 from commercial_kit_fixture;
insert into public.product_variants(id,product_id,sku,color_name,size)
  select variant,product,'TEST-SHIPPING-'||variant::text,'White','37' from commercial_kit_fixture;
insert into public.product_images(product_id,storage_path,alt_text,width,height,is_primary)
  select product,'test/kit-shipping.webp','Shipping fixture',720,720,true from commercial_kit_fixture;
update public.products set status='active' where id=(select product from commercial_kit_fixture);
insert into public.inventory(variant_id,available_quantity,reserved_quantity)
  select variant,3,0 from commercial_kit_fixture;
insert into private.bling_catalog_metadata(product_id,commercial_unit,pairs_per_sku,ncm,origin,cest,production_type,evidence_reference)
  select product,'UN',2,'64022000',0,'','T','Shipping fixture' from commercial_kit_fixture;
insert into public.addresses(id,user_id,label,recipient_name,postal_code,street,number,district,city,state)
  select address,actor,'Test','Test recipient','30110-100','Test street','1','Test district','Test city','MG' from commercial_kit_fixture;
alter table commercial_kit_fixture add column request_key uuid not null default gen_random_uuid(),
  add column rule_version uuid not null default gen_random_uuid(), add column order_id uuid,
  add column expected_payment text not null default '123';

insert into private.bling_kit_fiscal_components(
  kit_variant_id,position,sku,description,unit,quantity_pairs,allocation_weight,ncm,origin,cest,source_hash,evidence_reference
)
select f.variant,n,'SYNTHETIC-PAIR-'||n,'Fixture pair '||n,'PR',1,1,'64022000',0,'',
  private.bling_kit_source_hash(f.variant),'Synthetic fixture evidence'
from commercial_kit_fixture f cross join generate_series(1,2) n;
insert into private.representative_resale_fiscal_rule_versions
  (id,rule_key,version,issuer_reference,product_fingerprint,origin_state,destination_state,person_type,
    icms_status,final_consumer,purpose,valid_from,valid_until,fiscal_parameters)
select rule_version,gen_random_uuid(),1,'synthetic issuer',public.read_representative_resale_product_fingerprint(variant),
  'MG','MG','business','taxpayer',false,'resale',now()-interval '1 day',now()+interval '1 day',
  '{"buyerProfile":"MG02","issuerDocument":"12345678000195","classification":"third_party_no_st","creditEligible":false,"advancePixWithManualInvoice":true,
    "returnRules":{"own_inflow":{"cfop":"1202","taxCodeKind":"CSOSN","taxCode":"102","homologationEvidence":"synthetic return XML"},
      "undelivered_return":{"cfop":"1202","taxCodeKind":"CSOSN","taxCode":"102","homologationEvidence":"synthetic undelivered return XML"}},
    "blingRule":{"scenario":"resale_in_state_no_credit","issuer_state":"MG","series":3,"document_model":55,"cfop":"5102",
    "csosn":"102","icms_rate":0,"pis_cst":"49","cofins_cst":"49","ipi_cst":"99","ipi_cenq":"999",
    "pis_rate":0,"cofins_rate":0,"ipi_rate":0,"natures":[{"final_consumer":false,"external_nature_id":123}]}}'
from commercial_kit_fixture;
insert into private.representative_resale_fiscal_rule_approvals(rule_version_id,approver_reference,evidence_reference)
select rule_version,'synthetic approver','synthetic evidence' from commercial_kit_fixture;
insert into private.representative_kit_checkout_approvals(
  actor_id,rule_version_id,buyer_profile,buyer_fiscal_state,origin_postal_code,buyer_evidence,operation_evidence,
  stock_evidence,homologation_evidence,valid_until)
select actor,rule_version,'MG02','MG','35520000','synthetic buyer','synthetic operation','synthetic stock',
  'synthetic XML authorization',now()+interval '1 hour' from commercial_kit_fixture;

update public.products set width_cm = 15 where id = (select product from commercial_kit_fixture);
select throws_ok($$select pg_temp.reserve_commercial_kit()$$,'23514','kit_shipping_inputs_changed',
  'packing changes invalidate the freight even when unit price stays unchanged');
update public.products set width_cm = 10 where id = (select product from commercial_kit_fixture);

select throws_ok($$select pg_temp.reserve_commercial_kit()$$,'23514','resale_configuration_required',
  'the fiscal buyer and its official registration are required before creating an order');
update private.representative_kit_checkout_approvals set buyer_legal_name = 'Synthetic buyer LTDA',
  buyer_document = '11222333000181', buyer_state_registration = '0012345678900',
  buyer_fiscal_address = '{"state":"MG","postal_code":"30110100","street":"Test street","number":"1","district":"Test district","city":"Test city"}'
  where actor_id = (select actor from commercial_kit_fixture);

alter table commercial_kit_fixture add column receipt_quote uuid, add column receipt_key uuid default gen_random_uuid(),
  add column receipt_order uuid;
update public.profiles set phone='(31) 99999-0000' where id=(select actor from commercial_kit_fixture);

update commercial_kit_fixture set receipt_quote=(public.quote_representative_kit_own_delivery(
  actor,variant,null,1,address,null,true)->>'id')::uuid;
select ok((select receipt_quote is not null from commercial_kit_fixture),
  'an MG address is enough to quote payment on receipt without a route or cash method');
select is((select public.quote_representative_kit_own_delivery(actor,variant,null,1,address,null,true)->'collectionMethods'
  from commercial_kit_fixture),'["cash"]'::jsonb,'the route-free quote offers cash only');
select is((select public.quote_representative_kit_own_delivery(outsider,variant,null,1,address,null,true)
  from commercial_kit_fixture),null::jsonb,'another account cannot quote the address');
select is((select public.quote_representative_kit_own_delivery(actor,variant,null,100,address,null,true)
  from commercial_kit_fixture),null::jsonb,'quantity limits still apply');
select ok((select q.address_only_delivery and q.address_at_receipt and q.address_cash_bling_method is null
    and q.own_delivery_route_id is null and q.collection_route_id is null
  from private.representative_kit_shipping_checkout_quotes q join commercial_kit_fixture f on q.id=f.receipt_quote),
  'the quote records the address-only receipt choice');

select throws_ok($$select public.reserve_representative_kit_own_delivery(actor,variant,null,1,receipt_quote,address,gen_random_uuid(),null)
  from commercial_kit_fixture$$,'23514','kit_quote_unavailable','a receipt quote cannot become a prepaid order');
select throws_ok($$select public.reserve_representative_kit_order(actor,variant,1,receipt_quote,address,gen_random_uuid(),'35520000')
  from commercial_kit_fixture$$,'23514','kit_collection_selection_required','the plain reservation rejects a receipt quote');
select throws_ok($$select public.reserve_representative_kit_own_collection(actor,variant,null,1,receipt_quote,address,receipt_key,null,'pix',9000)
  from commercial_kit_fixture$$,'22023','invalid_kit_collection','only cash is accepted without a route');
select throws_ok($$select public.reserve_representative_kit_own_collection(actor,variant,null,1,receipt_quote,address,receipt_key,null,'cash',4000)
  from commercial_kit_fixture$$,'23514','kit_cash_tender_invalid','cash below the total is rejected');
select is((select i.available_quantity from public.inventory i join commercial_kit_fixture f on f.variant=i.variant_id),
  3,'a rejected cash amount leaves stock untouched');

update commercial_kit_fixture set receipt_order=(public.reserve_representative_kit_own_collection(
  actor,variant,null,1,receipt_quote,address,receipt_key,null,'cash',6000)->>'orderId')::uuid;
select ok((select o.state='awaiting_receipt' and o.collection_method='cash' and o.collection_route_id is null
    and o.collection_bling_method is null and o.cash_tendered_cents=6000 and o.shipping_cents=0
    and o.shipping_snapshot->>'provider'='own_delivery'
  from private.representative_kit_orders o join commercial_kit_fixture f on o.id=f.receipt_order),
  'cash on receipt is reserved by address without a route');
select is((select public.reserve_representative_kit_own_collection(
  actor,variant,null,1,receipt_quote,address,receipt_key,null,'cash',6000)->>'orderId' from commercial_kit_fixture),
  (select receipt_order::text from commercial_kit_fixture),'the same key replays the same order');
select throws_ok($$select public.reserve_representative_kit_own_collection(actor,variant,null,1,receipt_quote,address,receipt_key,null,'cash',7000)
  from commercial_kit_fixture$$,'23505','kit_idempotency_conflict','a reused key cannot change the cash amount');
select is((select i.reserved_quantity from public.inventory i join commercial_kit_fixture f on f.variant=i.variant_id),
  1,'the order holds one reserved kit');
select is((select shipping_snapshot->'deliveryAddress'->>'phone'
  from private.representative_kit_orders o join commercial_kit_fixture f on o.id=f.receipt_order),
  '(31) 99999-0000','the order snapshot stores the buyer phone');
select is((select private.representative_kit_manual_fiscal(o)
  from private.representative_kit_orders o join commercial_kit_fixture f on o.id=f.receipt_order),
  true,'the manual-invoice rule applies to cash on receipt');
select is((select public.can_start_representative_kit_manual_pix(actor,receipt_order) from commercial_kit_fixture),
  false,'a cash order cannot start a Pix');
select is((select private.representative_kit_fiscal_ready(o)
  from private.representative_kit_orders o join commercial_kit_fixture f on o.id=f.receipt_order),
  false,'billing waits for an operating date');

insert into public.user_permission_overrides(user_id,permission_id,allowed,reason,created_by)
select f.outsider,p.id,true,'Synthetic delivery operator',f.outsider
  from public.permissions p cross join commercial_kit_fixture f where p.code='orders.update_operational_status';
select set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true)
  from commercial_kit_fixture;
select throws_ok($$select public.list_representative_kit_collection_work()$$,'42501','permission_denied',
  'the buyer cannot read the delivery queue or its phones');
select set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true)
  from commercial_kit_fixture;
select is((select public.schedule_representative_kit_cash_delivery(receipt_order,current_date+1)
  from commercial_kit_fixture),true,'an authorized operator schedules the delivery');
select is((select private.representative_kit_fiscal_ready(o)
  from private.representative_kit_orders o join commercial_kit_fixture f on o.id=f.receipt_order),
  true,'the delivery date enables the manual invoice for cash on receipt');
select is((select r->'deliveryAddress'->>'phone'
  from jsonb_array_elements(public.list_representative_kit_collection_work()) r
  join commercial_kit_fixture f on r->>'orderId'=f.receipt_order::text),
  '(31) 99999-0000','the operator sees the buyer phone in the delivery queue');
update private.representative_kit_orders set shipping_snapshot=shipping_snapshot #- '{deliveryAddress,phone}'
  where id=(select receipt_order from commercial_kit_fixture);
update public.profiles set phone='(31) 98888-1111' where id=(select actor from commercial_kit_fixture);
select is((select r->'deliveryAddress'->>'phone'
  from jsonb_array_elements(public.list_representative_kit_collection_work()) r
  join commercial_kit_fixture f on r->>'orderId'=f.receipt_order::text),
  '(31) 98888-1111','older orders fall back to the profile phone');

select * from finish();
rollback;

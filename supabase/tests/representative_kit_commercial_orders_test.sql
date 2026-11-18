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
  add column rule_version uuid not null default gen_random_uuid(), add column order_id uuid;

insert into private.bling_kit_fiscal_components(
  kit_variant_id,position,sku,description,unit,quantity_pairs,allocation_weight,ncm,origin,cest,source_hash,evidence_reference
)
select f.variant,n,'SYNTHETIC-PAIR-'||n,'Fixture pair '||n,'PR',1,1,'64022000',0,'',
  private.bling_kit_source_hash(f.variant),'Synthetic fixture evidence'
from commercial_kit_fixture f cross join generate_series(1,2) n;

create function pg_temp.commercial_quote(p_origin text default '35520000', p_cents bigint default 5000)
returns uuid language sql as $$
  select (public.confirm_representative_kit_shipping_quote(actor,variant,2,address,'30110100',repeat('a',64),
    '1','PAC','Correios',2100,1800,4,'[]',now()+interval '20 minutes',p_origin,p_cents,'[250,10,5,20]')->>'id')::uuid
  from commercial_kit_fixture;
$$;

create function pg_temp.reserve_commercial_kit(p_quantity integer default 2, p_other_key boolean default false)
returns jsonb language sql as $$
  select public.reserve_representative_kit_order(actor,variant,p_quantity,quote,address,
    case when p_other_key then gen_random_uuid() else request_key end,'35520000')
  from commercial_kit_fixture;
$$;

select ok(not has_function_privilege('authenticated',
  'public.reserve_representative_kit_order(uuid,uuid,integer,uuid,uuid,uuid,text)','execute'),
  'signed-in clients cannot create commercial orders through SQL');
select ok(not has_table_privilege('service_role','private.representative_kit_orders','update'),
  'the service API cannot mutate the aggregate directly');
select throws_ok($$select pg_temp.commercial_quote('01310100')$$,'23514','representative_kit_origin_outside_mg',
  'origin outside MG cannot confirm freight');
select throws_ok($$select pg_temp.commercial_quote('35520000',1)$$,'23514','kit_shipping_inputs_changed',
  'confirmation compares live merchandise price');

update commercial_kit_fixture set quote = pg_temp.commercial_quote();
select throws_ok($$select pg_temp.reserve_commercial_kit()$$,'23514','resale_not_homologated',
  'order cannot reserve stock without fiscal and operational approval');
select is((select q.used_at from private.representative_kit_shipping_checkout_quotes q
  join commercial_kit_fixture f on f.quote = q.id),null::timestamptz,'failed order rolls back consumption');
select is((select i.available_quantity from public.inventory i join commercial_kit_fixture f on f.variant=i.variant_id),
  3,'failed order leaves inventory untouched');

insert into private.representative_resale_fiscal_rule_versions
  (id,rule_key,version,issuer_reference,product_fingerprint,origin_state,destination_state,person_type,
    icms_status,final_consumer,purpose,valid_from,valid_until,fiscal_parameters)
select rule_version,gen_random_uuid(),1,'synthetic issuer',public.read_representative_resale_product_fingerprint(variant),
  'MG','MG','business','taxpayer',false,'resale',now()-interval '1 day',now()+interval '1 day','{"buyerProfile":"MG02"}'
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

select is(pg_temp.reserve_commercial_kit()->>'amountInCents','12100','uses the locked catalog price and private freight');
update commercial_kit_fixture set order_id = (pg_temp.reserve_commercial_kit()->>'orderId')::uuid;
select ok((select order_id is not null from commercial_kit_fixture),'same request replays the existing order');
select throws_ok($$select pg_temp.reserve_commercial_kit(1)$$,'23505','kit_idempotency_conflict',
  'a reused key cannot change quantity');
select throws_ok($$select pg_temp.reserve_commercial_kit(2,true)$$,'23514','kit_quote_unavailable',
  'a new key cannot reuse consumed freight');
select results_eq(
  $$select available_quantity,reserved_quantity from public.inventory where variant_id=(select variant from commercial_kit_fixture)$$,
  $$values (1,2)$$,'stock is reserved once in the inventory shared with retail');

select is((select public.cancel_unstarted_representative_kit_order(outsider,order_id) from commercial_kit_fixture),
  false,'another buyer cannot release the hold');
select is((select public.cancel_unstarted_representative_kit_order(null,order_id) from commercial_kit_fixture),
  false,'expiration cannot release a live hold');
select is((select public.cancel_unstarted_representative_kit_order(actor,order_id) from commercial_kit_fixture),
  true,'the buyer can cancel an unstarted payment');
select is((select public.cancel_unstarted_representative_kit_order(actor,order_id) from commercial_kit_fixture),
  true,'cancellation is idempotent');
select results_eq(
  $$select available_quantity,reserved_quantity from public.inventory where variant_id=(select variant from commercial_kit_fixture)$$,
  $$values (3,0)$$,'the hold is restored exactly once');

update private.representative_kit_checkout_approvals set buyer_legal_name = 'Synthetic buyer LTDA', buyer_document = '11222333000181'
  where actor_id = (select actor from commercial_kit_fixture);
update commercial_kit_fixture set quote = pg_temp.commercial_quote(), request_key = gen_random_uuid();
update commercial_kit_fixture set order_id = (pg_temp.reserve_commercial_kit()->>'orderId')::uuid;

create function pg_temp.claim_commercial_pix() returns jsonb language sql as $$
  select public.claim_representative_kit_pix(actor,order_id) from commercial_kit_fixture;
$$;

create function pg_temp.settle_commercial_pix(p_status text,p_id text default '123',p_amount bigint default 12100,
  p_refunds jsonb default '[]')
returns jsonb language sql as $$
  select public.settle_representative_kit_payment(order_id,p_id,'KITMG-'||order_id,p_amount,'BRL',p_status,now(),p_refunds)
  from commercial_kit_fixture;
$$;

select ok(not has_function_privilege('authenticated',
  'public.settle_representative_kit_payment(uuid,text,text,bigint,text,text,timestamptz,jsonb)','execute'),
  'buyers cannot confirm their own payment');
select throws_ok($$select pg_temp.settle_commercial_pix('approved')$$,'23514','kit_payment_identity_mismatch',
  'payments cannot attach before the creation claim');
update private.representative_kit_checkout_approvals set revoked_at = now() where actor_id = (select actor from commercial_kit_fixture);
select throws_ok($$select pg_temp.claim_commercial_pix()$$,'23514','resale_payment_blocked',
  'approval is required again before issuing Pix');
update private.representative_kit_checkout_approvals set revoked_at = null where actor_id = (select actor from commercial_kit_fixture);
select is(pg_temp.claim_commercial_pix()->>'buyerDocument','11222333000181','the provider receives the approved fiscal buyer');
select is(pg_temp.claim_commercial_pix(),null::jsonb,'a replay never claims a second provider write');
select is((select public.cancel_unstarted_representative_kit_order(actor,order_id) from commercial_kit_fixture),
  false,'an uncertain provider creation keeps the stock held');
select throws_ok($$select pg_temp.settle_commercial_pix('pending','123',1)$$,'23514','kit_payment_identity_mismatch',
  'provider amount must match exactly');
select is(pg_temp.settle_commercial_pix('pending')->>'state','payment_pending','a matching payment attaches');
select throws_ok($$select pg_temp.settle_commercial_pix('approved','456')$$,'23514','kit_payment_identity_mismatch',
  'a different payment cannot replace the attached identity');
select is((select public.request_representative_kit_payment_cancellation(actor,order_id)->>'cancellationRequested'
  from commercial_kit_fixture),'true','a requested cancellation awaits provider confirmation');
select is(pg_temp.settle_commercial_pix('approved')->>'state','paid','confirmed approval wins the cancellation race');
select is(pg_temp.settle_commercial_pix('pending')->>'state','paid','a stale pending response cannot regress payment');
select results_eq(
  $$select available_quantity,reserved_quantity from public.inventory where variant_id=(select variant from commercial_kit_fixture)$$,
  $$values (1,0)$$,'paid stock is debited once');
select is((select count(*)::integer from public.inventory_movements where reference_id=(select order_id from commercial_kit_fixture)),
  1,'debit has one physical movement');
select is(pg_temp.settle_commercial_pix('approved','123',12100,'[{"id":"99","amountInCents":2100}]')->>'state',
  'manual_review','a partial refund blocks fulfillment without automatically returning stock');
select is(pg_temp.settle_commercial_pix('approved','123',12100,'[{"id":"99","amountInCents":2100}]')->>'refundedInCents',
  '2100','repeated refund events cannot duplicate the refund amount');
select throws_ok($$select pg_temp.settle_commercial_pix('approved','123',12100,'[{"id":"99","amountInCents":2101}]')$$,
  '23514','kit_refund_identity_mismatch','existing refund amount cannot be changed');
select is(pg_temp.settle_commercial_pix('refunded','123',12100,'[{"id":"100","amountInCents":10000}]')->>'state',
  'refunded','full provider refund is recorded');
select is((select available_quantity from public.inventory where variant_id=(select variant from commercial_kit_fixture)),
  1,'a financial refund does not put sold items back on the shelf');

select * from finish();
rollback;

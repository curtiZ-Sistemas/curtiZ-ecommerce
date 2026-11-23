begin;
set local statement_timeout='25s';
set local lock_timeout='3s';
do $guard$ begin if to_regclass('private.representative_kit_orders') is null or (select max(version) from supabase_migrations.schema_migrations) <> '20261120133000' then raise exception 'Staging schema unexpected'; end if; end $guard$;
create temporary table kit_test_running(flag boolean) on commit drop;
create function pg_temp.no_plan() returns text language sql as $$select 'test suite'::text$$;
create function pg_temp.finish() returns setof text language sql as $$select ''::text where false$$;
create function pg_temp.ok(actual boolean, label text) returns text language plpgsql as $$
begin if actual is not true then raise exception 'Assertion failed: % [actual %]', label,actual; end if;
return 'ok - '||label; end $$;
create function pg_temp.is(actual anycompatible, expected anycompatible,label text) returns text language plpgsql as $$
begin if actual is distinct from expected then raise exception 'Assertion failed: % [actual % expected %]', label,actual,expected; end if;
return 'ok - '||label; end $$;
create function pg_temp.isnt(actual anycompatible, expected anycompatible,label text) returns text language plpgsql as $$
begin if actual is not distinct from expected then raise exception 'Assertion failed: % [actual % unexpected %]', label,actual,expected; end if;
return 'ok - '||label; end $$;
create function pg_temp.results_eq(actual text, expected text,label text) returns text language plpgsql as $$
declare result text[]; target text[];
begin execute 'select array_agg(r::text) from ('||actual||') as r' into result;
execute 'select array_agg(r::text) from ('||expected||') as r' into target;
return pg_temp.is(result,target,label); end $$;
create function pg_temp.throws_ok(statement text, code text, expected_message text,label text) returns text language plpgsql as $$
declare seen_code text; seen_message text;
begin
  begin execute statement;
  exception when others then get stacked diagnostics seen_code=returned_sqlstate,seen_message=message_text; end;
  if seen_code is distinct from code or (expected_message is not null and seen_message is distinct from expected_message)
    then raise exception 'Assertion failed: % [actual %: % expected %: %]',label,seen_code,seen_message,code,expected_message;
  end if;
  return 'ok - '||label;
end $$;


set local search_path = public, extensions;
select pg_temp.no_plan();

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

select pg_temp.ok(not has_function_privilege('authenticated',
  'public.reserve_representative_kit_order(uuid,uuid,integer,uuid,uuid,uuid,text)','execute'),
  'signed-in clients cannot create commercial orders through SQL');
select pg_temp.ok(not has_table_privilege('service_role','private.representative_kit_orders','update'),
  'the service API cannot mutate the aggregate directly');
select pg_temp.throws_ok($$select pg_temp.commercial_quote('01310100')$$,'23514','representative_kit_origin_outside_mg',
  'origin outside MG cannot confirm freight');
select pg_temp.throws_ok($$select pg_temp.commercial_quote('35520000',1)$$,'23514','kit_shipping_inputs_changed',
  'confirmation compares live merchandise price');

update commercial_kit_fixture set quote = pg_temp.commercial_quote();
select pg_temp.throws_ok($$select pg_temp.reserve_commercial_kit()$$,'23514','resale_not_homologated',
  'order cannot reserve stock without fiscal and operational approval');
select pg_temp.is((select q.used_at from private.representative_kit_shipping_checkout_quotes q
  join commercial_kit_fixture f on f.quote = q.id),null::timestamptz,'failed order rolls back consumption');
select pg_temp.is((select i.available_quantity from public.inventory i join commercial_kit_fixture f on f.variant=i.variant_id),
  3,'failed order leaves inventory untouched');

insert into private.representative_resale_fiscal_rule_versions
  (id,rule_key,version,issuer_reference,product_fingerprint,origin_state,destination_state,person_type,
    icms_status,final_consumer,purpose,valid_from,valid_until,fiscal_parameters)
select rule_version,gen_random_uuid(),1,'synthetic issuer',public.read_representative_resale_product_fingerprint(variant),
  'MG','MG','business','taxpayer',false,'resale',now()-interval '1 day',now()+interval '1 day',
  '{"buyerProfile":"MG02","issuerDocument":"12345678000195","classification":"third_party_no_st","creditEligible":false,
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
select pg_temp.throws_ok($$select pg_temp.reserve_commercial_kit()$$,'23514','kit_shipping_inputs_changed',
  'packing changes invalidate the freight even when unit price stays unchanged');
update public.products set width_cm = 10 where id = (select product from commercial_kit_fixture);

select pg_temp.throws_ok($$select pg_temp.reserve_commercial_kit()$$,'23514','resale_configuration_required',
  'the fiscal buyer and its official registration are required before creating an order');
update private.representative_kit_checkout_approvals set buyer_legal_name = 'Synthetic buyer LTDA',
  buyer_document = '11222333000181', buyer_state_registration = '0012345678900',
  buyer_fiscal_address = '{"state":"MG","postal_code":"30110100","street":"Test street","number":"1","district":"Test district","city":"Test city"}'
  where actor_id = (select actor from commercial_kit_fixture);

select pg_temp.is(pg_temp.reserve_commercial_kit()->>'amountInCents','12100','uses the locked catalog price and private freight');
update commercial_kit_fixture set order_id = (pg_temp.reserve_commercial_kit()->>'orderId')::uuid;
select pg_temp.ok((select order_id is not null from commercial_kit_fixture),'same request replays the existing order');
select pg_temp.throws_ok($$select pg_temp.reserve_commercial_kit(1)$$,'23505','kit_idempotency_conflict',
  'a reused key cannot change quantity');
select pg_temp.throws_ok($$select pg_temp.reserve_commercial_kit(2,true)$$,'23514','kit_quote_unavailable',
  'a new key cannot reuse consumed freight');
select pg_temp.results_eq(
  $$select available_quantity,reserved_quantity from public.inventory where variant_id=(select variant from commercial_kit_fixture)$$,
  $$values (1,2)$$,'stock is reserved once in the inventory shared with retail');

select pg_temp.is((select public.cancel_unstarted_representative_kit_order(outsider,order_id) from commercial_kit_fixture),
  false,'another buyer cannot release the hold');
select pg_temp.is((select public.cancel_unstarted_representative_kit_order(null,order_id) from commercial_kit_fixture),
  false,'expiration cannot release a live hold');
select pg_temp.is((select public.cancel_unstarted_representative_kit_order(actor,order_id) from commercial_kit_fixture),
  true,'the buyer can cancel an unstarted payment');
select pg_temp.is((select public.cancel_unstarted_representative_kit_order(actor,order_id) from commercial_kit_fixture),
  true,'cancellation is idempotent');
select pg_temp.results_eq(
  $$select available_quantity,reserved_quantity from public.inventory where variant_id=(select variant from commercial_kit_fixture)$$,
  $$values (3,0)$$,'the hold is restored exactly once');

update commercial_kit_fixture set quote = pg_temp.commercial_quote(), request_key = gen_random_uuid();
update commercial_kit_fixture set order_id = (pg_temp.reserve_commercial_kit()->>'orderId')::uuid;

create function pg_temp.claim_commercial_pix() returns jsonb language sql as $$
  select public.claim_representative_kit_pix(actor,order_id) from commercial_kit_fixture;
$$;

create function pg_temp.settle_commercial_pix(p_status text,p_id text default null,p_amount bigint default 12100,
  p_refunds jsonb default '[]')
returns jsonb language sql as $$
  select public.settle_representative_kit_payment(order_id,coalesce(p_id,expected_payment),'KITMG-'||order_id,p_amount,'BRL',p_status,now(),p_refunds)
  from commercial_kit_fixture;
$$;

select pg_temp.ok(not has_function_privilege('authenticated',
  'public.settle_representative_kit_payment(uuid,text,text,bigint,text,text,timestamptz,jsonb)','execute'),
  'buyers cannot confirm their own payment');
select pg_temp.throws_ok($$select pg_temp.settle_commercial_pix('approved')$$,'23514','kit_payment_identity_mismatch',
  'payments cannot attach before the creation claim');
update private.representative_kit_checkout_approvals set revoked_at = now() where actor_id = (select actor from commercial_kit_fixture);
select pg_temp.throws_ok($$select pg_temp.claim_commercial_pix()$$,'23514','resale_payment_blocked',
  'approval is required again before issuing Pix');
update private.representative_kit_checkout_approvals set revoked_at = null where actor_id = (select actor from commercial_kit_fixture);
update private.representative_kit_checkout_approvals set buyer_state_registration='0099999999999'
  where actor_id=(select actor from commercial_kit_fixture);
select pg_temp.throws_ok($$select pg_temp.claim_commercial_pix()$$,'23514','resale_payment_blocked',
  'changing the verified fiscal buyer after checkout cannot start payment for the old snapshot');
update private.representative_kit_checkout_approvals set buyer_state_registration='0012345678900'
  where actor_id=(select actor from commercial_kit_fixture);
select pg_temp.is(pg_temp.claim_commercial_pix()->>'buyerDocument','11222333000181','the provider receives the approved fiscal buyer');
select pg_temp.is(pg_temp.claim_commercial_pix(),null::jsonb,'a replay never claims a second provider write');
select pg_temp.is((select public.cancel_unstarted_representative_kit_order(actor,order_id) from commercial_kit_fixture),
  false,'an uncertain provider creation keeps the stock held');
select pg_temp.throws_ok($$select pg_temp.settle_commercial_pix('pending','123',1)$$,'23514','kit_payment_identity_mismatch',
  'provider amount must match exactly');
select pg_temp.is(pg_temp.settle_commercial_pix('pending')->>'state','payment_pending','a matching payment attaches');
select pg_temp.throws_ok($$select pg_temp.settle_commercial_pix('approved','456')$$,'23514','kit_payment_identity_mismatch',
  'a different payment cannot replace the attached identity');
select pg_temp.is((select public.request_representative_kit_payment_cancellation(actor,order_id)->>'cancellationRequested'
  from commercial_kit_fixture),'true','a requested cancellation awaits provider confirmation');
select pg_temp.is(pg_temp.settle_commercial_pix('approved')->>'state','paid','confirmed approval wins the cancellation race');
select pg_temp.is(pg_temp.settle_commercial_pix('pending')->>'state','paid','a stale pending response cannot regress payment');
select pg_temp.results_eq(
  $$select available_quantity,reserved_quantity from public.inventory where variant_id=(select variant from commercial_kit_fixture)$$,
  $$values (1,0)$$,'paid stock is debited once');
select pg_temp.is((select count(*)::integer from public.inventory_movements where reference_id=(select order_id from commercial_kit_fixture)),
  1,'debit has one physical movement');
select pg_temp.is((select count(*)::integer from private.representative_kit_refund_requests
  where order_id=(select order_id from commercial_kit_fixture) and reason='undispatched_cancellation'),
  1,'the cancellation race enqueues one full estorno before fulfillment');
select pg_temp.is((select public.claim_representative_kit_refund(id,'{}') from private.representative_kit_refund_requests
  where order_id=(select order_id from commercial_kit_fixture)),true,'the unshipped order can refund after confirmed payment');
select pg_temp.is(pg_temp.settle_commercial_pix('refunded',null,12100,'[{"id":"88","amountInCents":12100}]')->>'state',
  'refunded','an approved full refund reconciles to the payment ledger');
select pg_temp.is((select public.acknowledge_representative_kit_refund(id,'88') from private.representative_kit_refund_requests
  where order_id=(select order_id from commercial_kit_fixture)),true,'the exact provider refund receipt is recorded');
select pg_temp.is((select public.finish_representative_kit_refund(id,'88') from private.representative_kit_refund_requests
  where order_id=(select order_id from commercial_kit_fixture)),true,'the provider receipt closes the local refund');
select pg_temp.is((select public.finish_representative_kit_refund(id,'88') from private.representative_kit_refund_requests
  where order_id=(select order_id from commercial_kit_fixture)),true,'the unshipped refund can replay safely');
select pg_temp.results_eq(
  $$select available_quantity,reserved_quantity from public.inventory where variant_id=(select variant from commercial_kit_fixture)$$,
  $$values (3,0)$$,'confirmed unshipped refund returns stock exactly once');

update commercial_kit_fixture set quote=pg_temp.commercial_quote(),request_key=gen_random_uuid(),expected_payment='222';
update commercial_kit_fixture set order_id=(pg_temp.reserve_commercial_kit()->>'orderId')::uuid;
select pg_temp.is(pg_temp.claim_commercial_pix()->>'buyerDocument','11222333000181','a second order has an independent payment claim');
select pg_temp.is(pg_temp.settle_commercial_pix('approved')->>'state','paid','an ordinary payment enqueues fulfillment');
update private.representative_kit_fulfillment set bling_sale_id=123,bling_invoice_id=456,shipment_id='synthetic-carrier'
  where order_id=(select order_id from commercial_kit_fixture);
create function pg_temp.record_kit_invoice(p_series text default '002')
returns boolean language sql as $$
  select public.record_representative_kit_authorized_invoice(order_id,123,456,
    '3126111234567800019555'||p_series||repeat('1',19),'100000000000001',repeat('a',64))
  from commercial_kit_fixture;
$$;
create function pg_temp.record_kit_tracking(p_status text)
returns boolean language sql as $$
  select public.record_representative_kit_tracking(order_id,'synthetic-carrier',
    '3126111234567800019555002'||repeat('1',19),p_status,'SYNTHETICCODE')
  from commercial_kit_fixture;
$$;
select pg_temp.is(pg_temp.record_kit_tracking('dispatched'),false,'carrier state requires validated fiscal clearance');
select pg_temp.is(pg_temp.record_kit_invoice('003'),false,'the return series cannot clear a sale for dispatch');
select pg_temp.is(pg_temp.record_kit_invoice(),true,'the backend can record a verified sale identity');
select pg_temp.is(pg_temp.record_kit_tracking('in_transit'),true,'tracking can proceed once the paid order has fiscal clearance');
select pg_temp.is(pg_temp.record_kit_tracking('ready'),false,'an old provider state cannot regress tracking');
select pg_temp.is((select public.read_representative_kit_tracking(outsider,order_id) from commercial_kit_fixture),
  null::jsonb,'tracking projection is scoped to the purchaser');

insert into private.representative_kit_refund_requests(order_id,amount_cents,reason,operational_evidence,fiscal_evidence,original_invoice_key)
select order_id,2100,'undispatched_cancellation','synthetic cancellation','synthetic fiscal evidence',
  '3126111234567800019555002'||repeat('1',19) from commercial_kit_fixture;
select pg_temp.is((select public.claim_representative_kit_refund(id,'{}') from private.representative_kit_refund_requests
  where order_id=(select order_id from commercial_kit_fixture)),false,'an order in transit cannot use the unshipped refund path');

create function pg_temp.request_kit_return(p_quantity integer,p_key uuid)
returns jsonb language sql as $$
  select public.request_representative_kit_return(actor,order_id,p_quantity,'Synthetic return request',p_key)
  from commercial_kit_fixture;
$$;
select pg_temp.throws_ok($$select pg_temp.request_kit_return(1,'11111111-1111-4111-8111-111111111111')$$,
  '23514','kit_return_unavailable','a shipment in transit cannot be refunded as a received return');
select pg_temp.is(pg_temp.record_kit_tracking('delivered'),true,'delivery is recorded from the confirmed carrier');
select pg_temp.is(pg_temp.request_kit_return(1,'11111111-1111-4111-8111-111111111111')->>'state','requested','buyer can request one returned kit');
select pg_temp.is(pg_temp.request_kit_return(1,'11111111-1111-4111-8111-111111111111')->>'state','requested','return request is idempotent');
select pg_temp.throws_ok($$select pg_temp.request_kit_return(2,'22222222-2222-4222-8222-222222222222')$$,
  '23514','kit_return_unavailable','return requests share one order quantity balance');
select pg_temp.is((select public.list_representative_kit_returns(outsider,order_id) from commercial_kit_fixture),
  '[]'::jsonb,'another buyer cannot see private return records');
select pg_temp.is((select public.record_representative_kit_return_invoice(id,'3126111234567800019555003'||repeat('1',19),
  '100000000000003',repeat('a',64)) from private.representative_kit_returns where order_id=(select order_id from commercial_kit_fixture)),
  false,'XML cannot bypass inspection and receipt');

create function pg_temp.manage_kit_return(p_action text,p_data jsonb default '{}'::jsonb)
returns text language sql as $$
  select public.manage_representative_kit_return(r.id,p_action,p_data)->>'state'
  from private.representative_kit_returns r join commercial_kit_fixture f using(order_id);
$$;
select set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true) from commercial_kit_fixture;
select pg_temp.throws_ok($$select pg_temp.manage_kit_return('approve','{"instructions":"No support role"}')$$,
  '42501','permission denied','the buyer cannot approve their own return');
update public.profiles set status='active' where id=(select outsider from commercial_kit_fixture);
insert into public.user_permission_overrides(user_id,permission_id,allowed,reason,created_by)
select f.outsider,p.id,true,'Synthetic return reviewer permissions',f.outsider
from public.permissions p cross join commercial_kit_fixture f where p.code in ('returns.approve','returns.inspect','returns.refund');
select set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true) from commercial_kit_fixture;
select pg_temp.is(pg_temp.manage_kit_return('approve','{"instructions":"Synthetic store return instructions"}'),
  'approved','authorized staff can approve the return');
select pg_temp.is(pg_temp.manage_kit_return('receive',jsonb_build_object('invoiceId',901,'refundInCents',6050,'restockQuantity',1,
  'invoiceKey','3126111234567800019555003'||repeat('1',19),'documentOrigin','own_inflow','inspectionReference','Synthetic inspected kit')),
  'received','receiving inventory alone does not authorize the refund');
select pg_temp.is(pg_temp.manage_kit_return('refund'),null::text,'staff cannot authorize the refund before XML validation');
select pg_temp.is((select public.record_representative_kit_return_invoice(id,'3126111234567800019555003'||repeat('1',19),
  '100000000000003',repeat('a',64)) from private.representative_kit_returns where order_id=(select order_id from commercial_kit_fixture)),
  true,'trusted verification attaches the exact authorized return');
delete from private.representative_kit_refund_requests where order_id=(select order_id from commercial_kit_fixture);
select pg_temp.is(pg_temp.manage_kit_return('refund'),null::text,'a refund must be prepared first');
select pg_temp.is(pg_temp.manage_kit_return('prepare_refund'),'verified','preparation leaves the refund unqueued');
select pg_temp.is(pg_temp.manage_kit_return('refund'),null::text,'a preparer cannot approve the same refund');
alter table commercial_kit_fixture add column refund_reviewer uuid default gen_random_uuid();
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
  select refund_reviewer,'kit-refund-reviewer@example.invalid','{}'::jsonb,'{}'::jsonb from commercial_kit_fixture;
update public.profiles set status='active' where id=(select refund_reviewer from commercial_kit_fixture);
insert into public.user_permission_overrides(user_id,permission_id,allowed,reason,created_by)
  select f.refund_reviewer,p.id,true,'Synthetic second refund reviewer',f.outsider
  from public.permissions p cross join commercial_kit_fixture f where p.code='returns.refund';
select set_config('request.jwt.claims',jsonb_build_object('sub',refund_reviewer,'role','authenticated')::text,true)
  from commercial_kit_fixture;
select pg_temp.is(pg_temp.manage_kit_return('refund'),'refund_pending','the authorized partial refund is queued');
select pg_temp.is((select public.claim_representative_kit_refund(id,'{}') from private.representative_kit_refund_requests
  where order_id=(select order_id from commercial_kit_fixture)),true,'verified partial refund can claim one external write');
select pg_temp.is((select available_quantity from public.inventory where variant_id=(select variant from commercial_kit_fixture)),
  1,'stock waits for the actual refund receipt');

select pg_temp.is(pg_temp.settle_commercial_pix('approved',null,12100,'[{"id":"99","amountInCents":6050}]')->>'state',
  'manual_review','a partial refund blocks fulfillment without automatically returning stock');
select pg_temp.is(pg_temp.settle_commercial_pix('approved',null,12100,'[{"id":"99","amountInCents":6050}]')->>'refundedInCents',
  '6050','repeated refund events cannot duplicate the refund amount');
select pg_temp.is((select public.acknowledge_representative_kit_refund(id,'99') from private.representative_kit_refund_requests
  where order_id=(select order_id from commercial_kit_fixture)),true,'provider acknowledgement is associated with the reviewed return');
select pg_temp.is((select public.finish_representative_kit_refund(id,'99') from private.representative_kit_refund_requests
  where order_id=(select order_id from commercial_kit_fixture)),true,'settled return completes');
select pg_temp.is((select public.finish_representative_kit_refund(id,'99') from private.representative_kit_refund_requests
  where order_id=(select order_id from commercial_kit_fixture)),true,'receipt replay is harmless');
select pg_temp.is((select r.state from private.representative_kit_returns r join commercial_kit_fixture f using(order_id)),
  'completed','buyer reads completed return after settlement');
select pg_temp.is((select available_quantity from public.inventory where variant_id=(select variant from commercial_kit_fixture)),
  2,'the inspected resellable kit returns to inventory exactly once');
select pg_temp.throws_ok($$select pg_temp.settle_commercial_pix('approved',null,12100,'[{"id":"99","amountInCents":2101}]')$$,
  '23514','kit_refund_identity_mismatch','existing refund amount cannot be changed');
select pg_temp.is(pg_temp.settle_commercial_pix('refunded',null,12100,'[{"id":"100","amountInCents":6050}]')->>'state',
  'refunded','full provider refund is recorded');
select pg_temp.is((select available_quantity from public.inventory where variant_id=(select variant from commercial_kit_fixture)),
  2,'an external financial refund without a second inspected return does not restock');

select pg_temp.is((select jsonb_object_agg(size,pairs) from private.representative_kit_grade_templates() where code='standard'),
  '{"34":1,"35":2,"36":3,"37":3,"38":2,"39":1}'::jsonb,'standard sheet matches the approved sizes');
select pg_temp.is((select jsonb_object_agg(size,pairs) from private.representative_kit_grade_templates() where code='lower_restock'),
  '{"34":1,"35":3,"36":4,"37":4}'::jsonb,'lower restock matches the approved sizes');
select pg_temp.is((select jsonb_object_agg(size,pairs) from private.representative_kit_grade_templates() where code='upper_restock'),
  '{"37":4,"38":4,"39":4}'::jsonb,'upper restock matches the approved sizes');

alter table commercial_kit_fixture add column own_quote uuid, add column own_key uuid default gen_random_uuid();
update commercial_kit_fixture set own_quote=(public.quote_representative_kit_own_delivery(actor,variant,null,1,address,
  null,false)->>'id')::uuid;
select pg_temp.ok((select own_quote is not null from commercial_kit_fixture),'the prepaid quote needs no route or configured origin');
create function pg_temp.reserve_own_kit()
returns jsonb language sql as $$
  select public.reserve_representative_kit_own_delivery(actor,variant,null,1,own_quote,address,own_key,'35520000')
    from commercial_kit_fixture;
$$;
select pg_temp.is(pg_temp.reserve_own_kit()->>'amountInCents','5000','the prepaid order includes no delivery charge');
select pg_temp.is((select shipping_snapshot->>'provider' from private.representative_kit_orders
  where id=(pg_temp.reserve_own_kit()->>'orderId')::uuid),'own_delivery','the prepaid order preserves the delivery provider');
select pg_temp.ok((select own_delivery_route_id is null and shipping_snapshot->>'estimatedDays' is null
  and shipping_snapshot->'deliveryAddress'->>'state'='MG' from private.representative_kit_orders
  where id=(pg_temp.reserve_own_kit()->>'orderId')::uuid),'the order stores the MG address without a route or estimated date');
select pg_temp.is((select public.request_representative_kit_payment_cancellation(actor,(pg_temp.reserve_own_kit()->>'orderId')::uuid)->>'state'
  from commercial_kit_fixture),'cancelled','unused prepaid own-delivery stock can be released');
insert into private.representative_kit_collection_routes(name,origin_postal_code,destination_from,destination_through,
  delivery_cents,estimated_days,bling_method_ids,point_terminal_id,verified_evidence,valid_until)
values('Synthetic delivery','35520000','30110000','30110999',1300,2,
  '{"cash":11,"pix":22,"debit_card":33,"credit_card":44}','SYNTHETIC_POINT','Synthetic verified local delivery',now()+interval '1 day');
alter table commercial_kit_fixture add column collection_quote uuid, add column collection_key uuid default gen_random_uuid();
update commercial_kit_fixture set collection_quote=(public.quote_representative_kit_collection(actor,variant,null,1,address,
  '35520000')->>'id')::uuid;

create function pg_temp.reserve_cash_kit(p_cash bigint)
returns jsonb language sql as $$
  select public.reserve_representative_kit_collection_order(actor,variant,null,1,collection_quote,address,collection_key,
    '35520000','cash',p_cash) from commercial_kit_fixture;
$$;

select pg_temp.throws_ok($$select pg_temp.reserve_cash_kit(6299)$$,'23514','kit_cash_tender_invalid','insufficient cash rejects the whole transaction');
select pg_temp.is((select q.used_at from private.representative_kit_shipping_checkout_quotes q
  join commercial_kit_fixture f on q.id=f.collection_quote),null::timestamptz,'invalid cash leaves the quote available');
select pg_temp.is(pg_temp.reserve_cash_kit(7000)->>'cashChangeInCents','700','database computes change from the confirmed order total');
select pg_temp.is(pg_temp.reserve_cash_kit(7000)->>'state','awaiting_receipt','cash selection reserves stock without marking the order paid');
select pg_temp.throws_ok($$select pg_temp.reserve_cash_kit(8000)$$,'23505','kit_idempotency_conflict','replay cannot alter the planned cash');
select pg_temp.is((select public.request_representative_kit_payment_cancellation(actor,(pg_temp.reserve_cash_kit(7000)->>'orderId')::uuid)->>'state'
  from commercial_kit_fixture),'cancelled','collection cancellation before any external action is available');
select pg_temp.is((select available_quantity from public.inventory where variant_id=(select variant from commercial_kit_fixture)),
  2,'an unpaid cancellation releases the reservation');

alter table commercial_kit_fixture add column grade_product uuid default gen_random_uuid(),
  add column grade_kit uuid default gen_random_uuid(),add column grade_rule uuid default gen_random_uuid(),
  add column grade_key uuid default gen_random_uuid(),add column grade_quote uuid;
insert into public.products(id,name,slug,category_id,status,base_price,weight_grams,width_cm,height_cm,length_cm)
  select grade_product,'Grade fixture',grade_product::text,category,'draft',35,150,8,4,16 from commercial_kit_fixture;
insert into public.product_variants(product_id,sku,color_name,size)
  select grade_product,'TEST-GRADE-'||s,'White',s::text from commercial_kit_fixture cross join generate_series(34,39) s;
insert into public.product_images(product_id,storage_path,alt_text,width,height,is_primary)
  select grade_product,'test/kit-grade.webp','Grade fixture',720,720,true from commercial_kit_fixture;
update public.products set status='active' where id=(select grade_product from commercial_kit_fixture);
insert into public.inventory(variant_id,available_quantity,reserved_quantity)
  select v.id,5,0 from public.product_variants v join commercial_kit_fixture f on v.product_id=f.grade_product;
insert into private.bling_catalog_metadata(product_id,commercial_unit,pairs_per_sku,ncm,origin,cest,production_type,evidence_reference)
  select grade_product,'PR',1,'64022000',0,'','T','Grade synthetic evidence' from commercial_kit_fixture;
insert into public.kits(id,name,slug,description,price_in_cents,grade_product_id,grade_color,created_by)
  select grade_kit,'Grade test kit',grade_kit::text,'Grade fixture',36001,grade_product,'White',actor from commercial_kit_fixture;
select pg_temp.is((select private.representative_kit_grade_snapshot(grade_kit,'upper_restock')->>'priceCents'
  from commercial_kit_fixture),'36001','an existing kit retains its common price until configured');
select pg_temp.throws_ok($$update public.kits set grade_standard_price_cents=36001
  where id=(select grade_kit from commercial_kit_fixture)$$,
  '23514',null,'a kit cannot have a partial price configuration');
update public.kits set grade_standard_price_cents=36001,
  grade_lower_restock_price_cents=35001,grade_upper_restock_price_cents=37001
  where id=(select grade_kit from commercial_kit_fixture);
select set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true)
  from commercial_kit_fixture;
select pg_temp.is((select jsonb_object_agg(template->>'code',template->'unitPriceInCents')
  from jsonb_array_elements(public.list_representative_kit_grade_offers()) offer
  cross join lateral jsonb_array_elements(offer->'templates') template
  where (offer->>'kitId')::uuid=(select grade_kit from commercial_kit_fixture)),
  '{"standard":36001,"lower_restock":35001,"upper_restock":37001}'::jsonb,
  'the catalog publishes the individual prices of all three grades');
select pg_temp.is((select private.representative_kit_grade_snapshot(grade_kit,'lower_restock')->>'priceCents'
  from commercial_kit_fixture),'35001','the freight snapshot uses the lower restock price');
select pg_temp.is((select private.representative_kit_grade_snapshot(grade_kit,'upper_restock')->>'priceCents'
  from commercial_kit_fixture),'37001','the freight snapshot uses the upper restock price');
insert into private.representative_resale_fiscal_rule_versions(
  id,rule_key,version,issuer_reference,product_fingerprint,origin_state,destination_state,person_type,icms_status,
  final_consumer,purpose,valid_from,valid_until,fiscal_parameters)
select f.grade_rule,gen_random_uuid(),1,r.issuer_reference,public.read_representative_kit_grade_fingerprint(f.grade_kit,'standard'),
  r.origin_state,r.destination_state,r.person_type,r.icms_status,r.final_consumer,r.purpose,r.valid_from,r.valid_until,
  r.fiscal_parameters || '{"cashAtDelivery":{"blingPaymentMethodId":"11","homologationEvidence":"Synthetic cash XML"}}'::jsonb
from private.representative_resale_fiscal_rule_versions r join commercial_kit_fixture f on r.id=f.rule_version;
insert into private.representative_resale_fiscal_rule_approvals(rule_version_id,approver_reference,evidence_reference)
select grade_rule,'Synthetic grade approver','Synthetic grade evidence' from commercial_kit_fixture;
insert into private.representative_kit_checkout_approvals(
  actor_id,rule_version_id,buyer_profile,buyer_fiscal_state,origin_postal_code,buyer_evidence,operation_evidence,
  stock_evidence,homologation_evidence,valid_until,buyer_legal_name,buyer_document,buyer_state_registration,buyer_fiscal_address)
select f.actor,f.grade_rule,a.buyer_profile,a.buyer_fiscal_state,a.origin_postal_code,a.buyer_evidence,a.operation_evidence,
  a.stock_evidence,a.homologation_evidence,a.valid_until,a.buyer_legal_name,a.buyer_document,a.buyer_state_registration,a.buyer_fiscal_address
from private.representative_kit_checkout_approvals a join commercial_kit_fixture f on a.rule_version_id=f.rule_version and a.actor_id=f.actor;
update commercial_kit_fixture set grade_quote=(public.quote_representative_kit_collection(actor,grade_kit,'standard',1,address,
  '35520000')->>'id')::uuid;
create function pg_temp.reserve_grade_cash()
returns jsonb language sql as $$
  select public.reserve_representative_kit_collection_order(actor,grade_kit,'standard',1,grade_quote,address,grade_key,
    '35520000','cash',40000) from commercial_kit_fixture;
$$;
update public.kits set grade_standard_price_cents=36501 where id=(select grade_kit from commercial_kit_fixture);
select pg_temp.throws_ok($$select pg_temp.reserve_grade_cash()$$,'23514','kit_grade_quote_changed',
  'changing the chosen grade price invalidates the previous quote');
select pg_temp.is((select used_at from private.representative_kit_shipping_checkout_quotes
  where id=(select grade_quote from commercial_kit_fixture)),null::timestamptz,
  'a stale quote remains unused');
update commercial_kit_fixture set grade_quote=(public.quote_representative_kit_collection(actor,grade_kit,'standard',1,address,
  '35520000')->>'id')::uuid;
update public.inventory set available_quantity=0 where variant_id in (
  select v.id from public.product_variants v join commercial_kit_fixture f on v.product_id=f.grade_product where v.size='38');
select pg_temp.throws_ok($$select pg_temp.reserve_grade_cash()$$,'23514','kit_grade_quote_changed',
  'a missing grade size rejects the complete sheet');
select pg_temp.is((select sum(i.reserved_quantity)::integer from public.inventory i join public.product_variants v on v.id=i.variant_id
  join commercial_kit_fixture f on v.product_id=f.grade_product),0,'failure leaves all reservations untouched');
update public.inventory set available_quantity=5 where variant_id in (
  select v.id from public.product_variants v join commercial_kit_fixture f on v.product_id=f.grade_product where v.size='38');
select pg_temp.is(pg_temp.reserve_grade_cash()->>'cashChangeInCents','2199','the new grade price and freight determine cash change');
update public.kits set grade_standard_price_cents=37501 where id=(select grade_kit from commercial_kit_fixture);
select pg_temp.is(pg_temp.reserve_grade_cash()->>'amountInCents','37801','an idempotent replay retains the reserved grade price');
select pg_temp.is((select jsonb_object_agg(v.size,i.reserved_quantity) from public.inventory i join public.product_variants v on v.id=i.variant_id
  join commercial_kit_fixture f on v.product_id=f.grade_product),
  '{"34":1,"35":2,"36":3,"37":3,"38":2,"39":1}'::jsonb,'reserving a sheet holds its exact shared stock');
select pg_temp.is((select public.request_representative_kit_payment_cancellation(actor,(pg_temp.reserve_grade_cash()->>'orderId')::uuid)->>'state'
  from commercial_kit_fixture),'cancelled','the unpaid grade can be cancelled as a whole');
select pg_temp.is((select sum(i.available_quantity)::integer from public.inventory i join public.product_variants v on v.id=i.variant_id
  join commercial_kit_fixture f on v.product_id=f.grade_product),30,'all of the original grade stock is restored');

alter table commercial_kit_fixture add column delivery_order uuid, add column pair_return uuid;
update private.representative_kit_collection_routes set closed_at=now() where name='Synthetic delivery';
update commercial_kit_fixture set grade_key=gen_random_uuid(),grade_quote=(public.quote_representative_kit_own_delivery(
  actor,grade_kit,'standard',1,address,null,true)->>'id')::uuid;
update commercial_kit_fixture set delivery_order=(public.reserve_representative_kit_own_collection(
  actor,grade_kit,'standard',1,grade_quote,address,grade_key,null,'cash',40000)->>'orderId')::uuid;
select pg_temp.ok((select o.collection_route_id is null and o.collection_method='cash' and o.collection_bling_method=11
    and o.shipping_cents=0 and o.shipping_snapshot->>'estimatedDays' is null
  from private.representative_kit_orders o join commercial_kit_fixture f on o.id=f.delivery_order),
  'cash at delivery uses the rule and the MG address without a route');
select pg_temp.is((select private.representative_kit_fiscal_ready(o)
  from private.representative_kit_orders o join commercial_kit_fixture f on o.id=f.delivery_order),
  false,'address-only cash billing waits for an operating date');
insert into public.user_permission_overrides(user_id,permission_id,allowed,reason,created_by)
select f.outsider,p.id,true,'Synthetic delivery operator',f.outsider
  from public.permissions p cross join commercial_kit_fixture f where p.code='orders.update_operational_status';
select set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true)
  from commercial_kit_fixture;
select pg_temp.is((select public.schedule_representative_kit_cash_delivery(delivery_order,current_date+1)
  from commercial_kit_fixture),true,'an authorized operator schedules cash delivery');
select pg_temp.is((select private.representative_kit_fiscal_ready(o)
  from private.representative_kit_orders o join commercial_kit_fixture f on o.id=f.delivery_order),
  true,'the delivery date enables the usual billing queue');
select pg_temp.is((select public.claim_representative_kit_bling_write_for_delivery(delivery_order,'bling_sale',null,current_date+2)
  from commercial_kit_fixture),false,'a stale delivery snapshot cannot claim a billing write');
update private.representative_kit_fulfillment
  set bling_sale_id=912,bling_invoice_id=913,invoice_access_key='3126111234567800019555003'||repeat('4',19),
    invoice_protocol='100000000000004',invoice_xml_sha256=repeat('b',64),
    invoice_confirmed_at=clock_timestamp(),shipment_status='dispatched',shipment_rank=4
  where order_id=(select delivery_order from commercial_kit_fixture);
select pg_temp.is((select public.manage_representative_kit_collection(delivery_order,'cash_received','Synthetic cash receipt')->>'ok'
  from commercial_kit_fixture),'true','cash can be confirmed independently of delivery');
select pg_temp.is((select f.shipment_status from private.representative_kit_fulfillment f join commercial_kit_fixture t
  on f.order_id=t.delivery_order),'dispatched','cash receipt cannot complete the physical delivery');
select pg_temp.is((select public.manage_representative_kit_collection(delivery_order,'confirm_delivery','Synthetic signed delivery')->>'ok'
  from commercial_kit_fixture),'true','authorized staff can confirm the physical delivery');
select pg_temp.is((select f.shipment_status from private.representative_kit_fulfillment f join commercial_kit_fixture t
  on f.order_id=t.delivery_order),'delivered','both confirmations complete the order');

select pg_temp.throws_ok($$select public.request_representative_kit_pair_return(actor,delivery_order,
  '{"TEST-GRADE-35":3}','Synthetic excess return',gen_random_uuid()) from commercial_kit_fixture$$,
  '23514','kit_return_unavailable','a pair request cannot exceed the sold quantity for its SKU');
update commercial_kit_fixture set pair_return=(public.request_representative_kit_pair_return(actor,delivery_order,
  '{"TEST-GRADE-35":1}','Synthetic pair return',gen_random_uuid())->>'id')::uuid;
select pg_temp.is((select public.manage_representative_kit_return(pair_return,'approve',
  '{"instructions":"Synthetic approved return"}')->>'state' from commercial_kit_fixture),
  'approved','the operator approves the selected pair');
select pg_temp.isnt((select public.manage_representative_kit_return(pair_return,'schedule_pickup',
  jsonb_build_object('pickupDate',current_date+1)) from commercial_kit_fixture),null::jsonb,'pickup can be scheduled for a pair');
select pg_temp.isnt((select public.manage_representative_kit_return(pair_return,'confirm_pickup',
  '{"pickupReference":"Synthetic documented pickup"}') from commercial_kit_fixture),null::jsonb,'pickup evidence is recorded');
select pg_temp.is((select public.manage_representative_kit_return(pair_return,'receive',jsonb_build_object(
  'invoiceId',917,'invoiceKey','3126111234567800019555004'||repeat('7',19),'documentOrigin','own_inflow',
  'restockQuantity',0,'restockPairs','{"TEST-GRADE-34":1}'::jsonb,'refundInCents',3000,
  'inspectionReference','Synthetic pair inspection')) from commercial_kit_fixture),
  null::jsonb,'the inspector cannot restock a different SKU');
select pg_temp.is((select public.manage_representative_kit_return(pair_return,'receive',jsonb_build_object(
  'invoiceId',917,'invoiceKey','3126111234567800019555004'||repeat('7',19),'documentOrigin','own_inflow',
  'restockQuantity',0,'restockPairs','{"TEST-GRADE-35":1}'::jsonb,'refundInCents',3000,
  'inspectionReference','Synthetic pair inspection'))->>'state' from commercial_kit_fixture),
  'received','the inspected SKU and fiscal reference are recorded together');
select pg_temp.is((select public.record_representative_kit_return_invoice_lines(pair_return,
  '3126111234567800019555004'||repeat('7',19),'100000000000009',repeat('e',64),
  '[{"signature":"synthetic price line","sku":"TEST-GRADE-35","quantity":1,"saleQuantity":2}]')
  from commercial_kit_fixture),true,'the provider proof verifies the requested SKU and sold quantity');
select pg_temp.is((select public.manage_representative_kit_return(pair_return,'refund','{}')->>'state'
  from commercial_kit_fixture),'refund_pending','the fiscal evidence allows the usual cash return workflow');
select pg_temp.is((select public.prepare_representative_kit_collection_refund(pair_return,'Synthetic confirmed cash return')->>'confirmed'
  from commercial_kit_fixture),'true','cash return confirmation finalizes inventory without a route');
select pg_temp.is((select jsonb_object_agg(v.size,i.available_quantity) from public.inventory i
  join public.product_variants v on v.id=i.variant_id join commercial_kit_fixture f on v.product_id=f.grade_product),
  '{"34":4,"35":4,"36":2,"37":2,"38":3,"39":4}'::jsonb,'only the inspected variant returns to inventory');

select pg_temp.is((select public.quote_representative_kit_own_delivery(actor,variant,null,1,address,null,true)
  from commercial_kit_fixture),null::jsonb,'cash approval for a grade cannot authorize a different product');
update private.representative_kit_collection_routes set closed_at=null where name='Synthetic delivery';
update private.representative_kit_collection_routes set delivery_cents=0 where name='Synthetic delivery';
update commercial_kit_fixture set collection_key=gen_random_uuid(),collection_quote=(public.quote_representative_kit_own_delivery(
  actor,variant,null,1,address,'35520000',true)->>'id')::uuid;
update commercial_kit_fixture set delivery_order=(pg_temp.reserve_cash_kit(5000)->>'orderId')::uuid;
update private.representative_kit_fulfillment
  set bling_sale_id=914,bling_invoice_id=915,invoice_access_key='3126111234567800019555003'||repeat('5',19),
    invoice_protocol='100000000000005',invoice_xml_sha256=repeat('c',64),
    invoice_confirmed_at=clock_timestamp(),shipment_status='pending',shipment_rank=0
  where order_id=(select delivery_order from commercial_kit_fixture);
select pg_temp.is(private.representative_kit_requires_mdfe('{
  "originPostalCode":"35524168","address":{"postalCode":"35522001"},
  "deliveryAddress":{"city":"Nova Serrana","state":"MG","postalCode":"35522001"}}'),false,
  'a confirmed municipal Nova Serrana delivery can leave without a manifesto');
select pg_temp.is(private.representative_kit_requires_mdfe('{
  "originPostalCode":"35524168","address":{"postalCode":"30110100"},
  "deliveryAddress":{"city":"Nova Serrana","state":"MG","postalCode":"30110100"}}'),true,
  'a municipality name alone cannot exempt an intermunicipal CEP');
select pg_temp.is(private.representative_kit_requires_mdfe('{}'::jsonb),true,'an incomplete snapshot requires verification');
select pg_temp.throws_ok($$select public.manage_representative_kit_collection(delivery_order,'dispatch','Synthetic dispatch attempt')
  from commercial_kit_fixture$$,'23514','kit_mdfe_required','intermunicipal dispatch requires proof independently from the panel');
select pg_temp.is((select public.confirm_representative_kit_mdfe(delivery_order,'31261112345678000195580010000000011123456780',
  '100000000000006','Synthetic SEFAZ consultation') from commercial_kit_fixture),false,'invalid check digit cannot authorize dispatch');
select pg_temp.is((select public.confirm_representative_kit_mdfe(delivery_order,'31261112345678000195580010000000011123456787',
  '100000000000006','Synthetic SEFAZ consultation') from commercial_kit_fixture),true,'staff records a manifesto for the authorized NF-e');
select pg_temp.is((select private.representative_kit_pending_mdfe(delivery_order,'3126111234567800019555003'||repeat('6',19))
  from commercial_kit_fixture),null::text,'the evidence is bound to the invoice for which it was reviewed');
select pg_temp.is((select public.manage_representative_kit_collection(delivery_order,'dispatch','Synthetic dispatch after review')->>'ok'
  from commercial_kit_fixture),'true','matching verified manifesto unlocks the intermunicipal dispatch');
select pg_temp.is((select private.representative_kit_pending_mdfe(delivery_order,'3126111234567800019555003'||repeat('5',19))
  from commercial_kit_fixture),null::text,'dispatch consumes the authorization for this order');
select pg_temp.is((select public.manage_representative_kit_collection(delivery_order,'delivery_failed','Synthetic delivery refusal')->>'ok'
  from commercial_kit_fixture),'true','the delivery refusal is recorded after circulation');
select pg_temp.is((select o.cancellation_requested_at from private.representative_kit_orders o join commercial_kit_fixture t
  on o.id=t.delivery_order),null::timestamptz,'a refusal does not start invoice cancellation');
select pg_temp.is((select public.manage_representative_kit_collection(delivery_order,'returned_unpaid','Synthetic physical return')
  from commercial_kit_fixture),null::jsonb,'a physical return alone does not release stock');
select pg_temp.is((select o.stock_state from private.representative_kit_orders o join commercial_kit_fixture t
  on o.id=t.delivery_order),'reserved','the stock stays reserved until the fiscal return can be verified');

insert into public.user_permission_overrides(user_id,permission_id,allowed,reason,created_by)
select f.outsider,p.id,true,'Synthetic inspection operator',f.outsider
  from public.permissions p cross join commercial_kit_fixture f where p.code='returns.inspect'
on conflict (user_id,permission_id) do nothing;
select pg_temp.is((select public.register_representative_kit_undelivered_return(delivery_order,916,
  '3126111234567800019555004'||repeat('6',19),1,'Synthetic physical count') from commercial_kit_fixture),
  true,'the operator can register physically inspected stock with the independent return document');
select pg_temp.is((select o.stock_state from private.representative_kit_orders o join commercial_kit_fixture t
  on o.id=t.delivery_order),'reserved','registration alone still does not release stock');
select pg_temp.is((select public.record_representative_kit_return_invoice(r.id,r.invoice_key,'100000000000008',repeat('d',64))
  from private.representative_kit_returns r join commercial_kit_fixture t on t.delivery_order=r.order_id),true,
  'authorized return verification releases the unpaid stock');
select pg_temp.is((select public.record_representative_kit_return_invoice(r.id,r.invoice_key,'100000000000008',repeat('d',64))
  from private.representative_kit_returns r join commercial_kit_fixture t on t.delivery_order=r.order_id),true,
  'the authorized return verifier can replay without creating another stock movement');
select pg_temp.is((select o.stock_state from private.representative_kit_orders o join commercial_kit_fixture t
  on o.id=t.delivery_order),'released','the final state reflects the released reservation');

select * from pg_temp.finish();

rollback;
select '145 assertions completed and rolled back' as verification;
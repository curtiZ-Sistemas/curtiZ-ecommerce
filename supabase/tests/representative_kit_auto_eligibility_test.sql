begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- An active representative buys kits without any manual MG02 approval or pre-seeded rule.
create temporary table auto_kit_fixture as
select gen_random_uuid() actor, gen_random_uuid() outsider, gen_random_uuid() application, gen_random_uuid() representative,
  gen_random_uuid() category, gen_random_uuid() product, gen_random_uuid() variant, gen_random_uuid() address,
  gen_random_uuid() product2, gen_random_uuid() variant2, gen_random_uuid() outsider_address,
  gen_random_uuid() receipt_key, null::uuid receipt_quote, null::uuid receipt_order;
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
  select actor,'kit-auto@example.invalid','{}'::jsonb,'{}'::jsonb from auto_kit_fixture
  union all select outsider,'kit-auto-outsider@example.invalid','{}'::jsonb,'{}'::jsonb from auto_kit_fixture;
update public.profiles set status='active' where id in (select actor from auto_kit_fixture union select outsider from auto_kit_fixture);
insert into public.representative_applications(id,user_id) select application,actor from auto_kit_fixture;
insert into public.representatives(id,user_id,application_id,status)
  select representative,actor,application,'approved_waiting_kit' from auto_kit_fixture;
insert into public.categories(id,name,slug) select category,'Kit auto test',category::text from auto_kit_fixture;
insert into public.products(id,name,slug,category_id,status,base_price,weight_grams,width_cm,height_cm,length_cm)
  select product,'Kit auto test',product::text,category,'draft',50,250,10,5,20 from auto_kit_fixture;
insert into public.product_variants(id,product_id,sku,color_name,size)
  select variant,product,'TEST-AUTO-'||variant::text,'White','37' from auto_kit_fixture;
insert into public.product_images(product_id,storage_path,alt_text,width,height,is_primary)
  select product,'test/kit-auto.webp','Auto fixture',720,720,true from auto_kit_fixture;
update public.products set status='active' where id=(select product from auto_kit_fixture);
insert into public.inventory(variant_id,available_quantity,reserved_quantity)
  select variant,5,0 from auto_kit_fixture;
insert into private.bling_catalog_metadata(product_id,commercial_unit,pairs_per_sku,ncm,origin,cest,production_type,evidence_reference)
  select product,'UN',2,'64022000',0,'','T','Auto fixture' from auto_kit_fixture;
insert into public.addresses(id,user_id,label,recipient_name,postal_code,street,number,district,city,state)
  select address,actor,'Test','Test recipient','30110-100','Test street','1','Test district','Test city','MG' from auto_kit_fixture
  union all select outsider_address,outsider,'Other','Other recipient','30110-100','Other street','2','Other district','Other city','MG'
  from auto_kit_fixture;
insert into private.bling_kit_fiscal_components(
  kit_variant_id,position,sku,description,unit,quantity_pairs,allocation_weight,ncm,origin,cest,source_hash,evidence_reference
)
select f.variant,n,'AUTO-PAIR-'||n,'Fixture pair '||n,'PR',1,1,'64022000',0,'',
  private.bling_kit_source_hash(f.variant),'Synthetic fixture evidence'
from auto_kit_fixture f cross join generate_series(1,2) n;
update public.profiles set phone='(31) 99999-0000' where id=(select actor from auto_kit_fixture);

select is((select count(*)::integer from private.representative_kit_checkout_approvals a join auto_kit_fixture f on a.actor_id=f.actor),
  0,'the representative starts without any buyer approval');
select is((select count(*)::integer from private.representative_resale_fiscal_rule_versions r
  where r.product_fingerprint=public.read_representative_resale_product_fingerprint((select variant from auto_kit_fixture))),
  0,'the new kit starts without any fiscal rule');

-- The portal check reflects the account, not a manual approval.
select set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true) from auto_kit_fixture;
select is(public.read_representative_kit_buyer_enabled(),true,'a representative waiting for the first kit is enabled');
select ok(exists(select 1 from private.representative_kit_checkout_approvals a join auto_kit_fixture f on a.actor_id=f.actor
  join private.representative_resale_fiscal_rule_versions r on r.id=a.rule_version_id
  where a.granted_automatically and r.product_fingerprint=public.read_representative_resale_product_fingerprint(f.variant)),
  'the portal check creates the automatic approval for the current kit');
select set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true) from auto_kit_fixture;
select is(public.read_representative_kit_buyer_enabled(),false,'an account without a representative profile is not enabled');
select is((select count(*)::integer from private.representative_kit_checkout_approvals a join auto_kit_fixture f on a.actor_id=f.outsider),
  0,'the outsider received no approval');
select set_config('request.jwt.claims','{}',true);

-- Quote without manual approval.
update auto_kit_fixture set receipt_quote=(public.quote_representative_kit_own_delivery(
  actor,variant,null,1,address,null,true)->>'id')::uuid;
select ok((select receipt_quote is not null from auto_kit_fixture),'an active representative quotes without a manual approval');
select is((select public.quote_representative_kit_own_delivery(actor,variant,null,1,address,null,true)->'collectionMethods'
  from auto_kit_fixture),'["cash"]'::jsonb,'the automatic quote offers cash on receipt');

select ok((select r.fiscal_parameters #>> '{blingRule,cfop}'='5102' and r.fiscal_parameters #>> '{blingRule,csosn}'='102'
    and r.fiscal_parameters #>> '{blingRule,series}'='3'
    and r.fiscal_parameters #> '{blingRule,natures}'='[{"final_consumer":false,"external_nature_id":15111975260}]'::jsonb
    and r.fiscal_parameters #>> '{blingRule,ipi_cst}'='99'
    and r.fiscal_parameters #>> '{blingRule,ipi_cenq}'='999'
    and r.fiscal_parameters #>> '{blingRule,pis_cst}'='49'
    and r.fiscal_parameters #>> '{blingRule,cofins_cst}'='49'
    and r.fiscal_parameters #> '{blingRule,ipi_rate}'='0'::jsonb
    and r.fiscal_parameters #> '{blingRule,pis_rate}'='0'::jsonb
    and r.fiscal_parameters #> '{blingRule,cofins_rate}'='0'::jsonb
    and r.fiscal_parameters #>> '{returnRules,own_inflow,cfop}'='1202'
    and r.fiscal_parameters #>> '{returnRules,own_inflow,series}'='4'
    and r.fiscal_parameters -> 'creditEligible'='false'::jsonb and r.issuer_reference='68267385000191'
  from private.representative_resale_fiscal_rule_versions r
  where r.product_fingerprint=public.read_representative_resale_product_fingerprint((select variant from auto_kit_fixture))),
  'the seeded rule keeps the owner-approved MG02 no-credit parameters');
select is((select count(*)::integer from private.representative_resale_fiscal_rule_versions r
  where r.product_fingerprint=public.read_representative_resale_product_fingerprint((select variant from auto_kit_fixture))),
  1,'asking twice does not append a second rule');
select ok((select a.granted_automatically and a.buyer_profile='MG02' and a.buyer_document is null
    and a.buyer_state_registration is null and a.buyer_legal_name is not null
    and a.buyer_fiscal_address ->> 'postal_code'='30110100' and a.buyer_fiscal_address ->> 'state'='MG'
  from private.representative_kit_checkout_approvals a join auto_kit_fixture f on a.actor_id=f.actor
  join private.representative_resale_fiscal_rule_versions r on r.id=a.rule_version_id
  where r.product_fingerprint=public.read_representative_resale_product_fingerprint(f.variant)),
  'the automatic approval uses the profile name and the buyer MG address, without a CNPJ');

-- Another user cannot borrow the eligibility.
select is((select public.quote_representative_kit_own_delivery(outsider,variant,null,1,address,null,true)
  from auto_kit_fixture),null::jsonb,'another account cannot quote the representative address');
select is((select public.quote_representative_kit_own_delivery(outsider,variant,null,1,outsider_address,null,true)
  from auto_kit_fixture),null::jsonb,'a non-representative cannot quote even with an own MG address');
select is((select count(*)::integer from private.representative_kit_checkout_approvals a join auto_kit_fixture f on a.actor_id=f.outsider),
  0,'quoting never creates an approval for a non-representative');

-- The reservation works with the automatic approval.
update auto_kit_fixture set receipt_order=(public.reserve_representative_kit_own_collection(
  actor,variant,null,1,receipt_quote,address,receipt_key,null,'cash',6000)->>'orderId')::uuid;
select ok((select o.state='awaiting_receipt' and o.buyer_snapshot->'address'->>'state'='MG'
    and o.buyer_snapshot->>'document' is null
  from private.representative_kit_orders o join auto_kit_fixture f on o.id=f.receipt_order),
  'cash on receipt is reserved with the automatic approval and the fiscal address snapshot');

-- A kit created later is quotable without any manual step.
insert into public.products(id,name,slug,category_id,status,base_price,weight_grams,width_cm,height_cm,length_cm)
  select product2,'Kit auto test later',product2::text,category,'draft',60,250,10,5,20 from auto_kit_fixture;
insert into public.product_variants(id,product_id,sku,color_name,size)
  select variant2,product2,'TEST-AUTO-'||variant2::text,'White','38' from auto_kit_fixture;
insert into public.product_images(product_id,storage_path,alt_text,width,height,is_primary)
  select product2,'test/kit-auto-2.webp','Auto fixture 2',720,720,true from auto_kit_fixture;
update public.products set status='active' where id=(select product2 from auto_kit_fixture);
insert into public.inventory(variant_id,available_quantity,reserved_quantity) select variant2,5,0 from auto_kit_fixture;
insert into private.bling_catalog_metadata(product_id,commercial_unit,pairs_per_sku,ncm,origin,cest,production_type,evidence_reference)
  select product2,'UN',2,'64022000',0,'','T','Auto fixture 2' from auto_kit_fixture;
insert into private.bling_kit_fiscal_components(
  kit_variant_id,position,sku,description,unit,quantity_pairs,allocation_weight,ncm,origin,cest,source_hash,evidence_reference
)
select f.variant2,n,'AUTO2-PAIR-'||n,'Fixture pair '||n,'PR',1,1,'64022000',0,'',
  private.bling_kit_source_hash(f.variant2),'Synthetic fixture evidence'
from auto_kit_fixture f cross join generate_series(1,2) n;
select ok((select public.quote_representative_kit_own_delivery(actor,variant2,null,1,address,null,true) is not null
  from auto_kit_fixture),'a kit created after the first approval is quotable automatically');
select ok((select r.fiscal_parameters #> '{blingRule,natures}'='[{"final_consumer":false,"external_nature_id":15111975260}]'::jsonb
    and r.fiscal_parameters #>> '{blingRule,series}'='3'
  from private.representative_resale_fiscal_rule_versions r
  where r.product_fingerprint=public.read_representative_resale_product_fingerprint((select variant2 from auto_kit_fixture))),
  'a subsequently created kit also uses the corrected MG02 nature and series 003');

-- Accounts outside the program never quote.
update public.representatives set status='suspended' where id=(select representative from auto_kit_fixture);
select is((select public.quote_representative_kit_own_delivery(actor,variant,null,1,address,null,true)
  from auto_kit_fixture),null::jsonb,'a suspended representative cannot quote');
select set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true) from auto_kit_fixture;
select is(public.read_representative_kit_buyer_enabled(),false,'a suspended representative is not enabled');
select set_config('request.jwt.claims','{}',true);
update public.representatives set status='cancelled' where id=(select representative from auto_kit_fixture);
select is((select public.quote_representative_kit_own_delivery(actor,variant2,null,1,address,null,true)
  from auto_kit_fixture),null::jsonb,'a cancelled representative cannot quote');
update public.representatives set status='inactive' where id=(select representative from auto_kit_fixture);
select is((select public.quote_representative_kit_own_delivery(actor,variant2,null,1,address,null,true)
  from auto_kit_fixture),null::jsonb,'an inactive representative cannot quote');
update public.representatives set status='active' where id=(select representative from auto_kit_fixture);
select ok((select public.quote_representative_kit_own_delivery(actor,variant2,null,1,address,null,true) is not null
  from auto_kit_fixture),'an active representative quotes again');

-- Security and privacy.
select ok(not has_function_privilege('anon','public.read_representative_kit_buyer_enabled()','execute')
  and has_function_privilege('authenticated','public.read_representative_kit_buyer_enabled()','execute'),
  'only signed-in accounts can ask whether they are enabled');
select ok(not has_function_privilege('authenticated','private.ensure_representative_kit_auto_eligibility(uuid,uuid)','execute')
  and not has_function_privilege('service_role','private.ensure_representative_kit_auto_eligibility(uuid,uuid)','execute')
  and not has_function_privilege('authenticated','private.ensure_representative_kit_mg02_rules()','execute'),
  'the provisioning helpers are not callable by clients');
select ok(not has_function_privilege('anon','public.quote_representative_kit_own_delivery(uuid,uuid,text,integer,uuid,text,boolean)','execute')
  and not has_function_privilege('authenticated','public.quote_representative_kit_own_delivery(uuid,uuid,text,integer,uuid,text,boolean)','execute'),
  'clients cannot quote on behalf of another account');
select ok(exists(select 1 from public.audit_logs a where a.action='representative.kit.mg02.auto_enabled'),
  'the automatic enabling is audited');
select ok(not exists(select 1 from public.audit_logs a
  where a.action='representative.kit.mg02.auto_enabled' and (to_jsonb(a)::text like '%99999-0000%'
    or to_jsonb(a)::text like '%Test street%' or to_jsonb(a)::text like '%30110%')),
  'the audit entry carries no phone, address or document');

select * from finish();
rollback;

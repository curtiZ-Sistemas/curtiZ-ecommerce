begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select ok(not has_function_privilege('anon', 'public.find_representative_resale_fiscal_rule_candidate(text,text,text,text,text,text,boolean,text)', 'execute'), 'anonymous role cannot look up fiscal rules');
select ok(not has_function_privilege('authenticated', 'public.find_representative_resale_fiscal_rule_candidate(text,text,text,text,text,text,boolean,text)', 'execute'), 'authenticated clients cannot look up private rules');
select ok(has_function_privilege('service_role', 'public.find_representative_resale_fiscal_rule_candidate(text,text,text,text,text,text,boolean,text)', 'execute'), 'server can look up a candidate');
select ok(not has_table_privilege('service_role', 'private.representative_resale_fiscal_rule_approvals', 'insert'), 'service role cannot grant approvals directly');

insert into private.representative_resale_fiscal_rule_versions
  (id,rule_key,version,issuer_reference,product_fingerprint,origin_state,destination_state,person_type,icms_status,final_consumer,purpose,valid_from,valid_until,fiscal_parameters)
values
  ('aa100000-0000-4000-8000-000000000001','aa200000-0000-4000-8000-000000000001',1,'synthetic-issuer',repeat('a',64),'MG','SP','business','taxpayer',false,'resale',now()-interval '1 day',now()+interval '1 day','{"fixture":true}'::jsonb),
  ('aa100000-0000-4000-8000-000000000002','aa200000-0000-4000-8000-000000000001',2,'synthetic-issuer',repeat('a',64),'MG','SP','business','taxpayer',false,'resale',now()-interval '1 day',now()+interval '1 day','{"fixture":true}'::jsonb),
  ('aa100000-0000-4000-8000-000000000003','aa200000-0000-4000-8000-000000000002',1,'synthetic-issuer',repeat('b',64),'MG','SP','business','taxpayer',false,'resale',now()-interval '2 days',now()-interval '1 day','{"fixture":true}'::jsonb);

select is(public.find_representative_resale_fiscal_rule_candidate('synthetic-issuer',repeat('a',64),'MG','SP','business','taxpayer',false,'resale'),null::jsonb,'unapproved rule is not returned');
insert into private.representative_resale_fiscal_rule_approvals(rule_version_id,approver_reference,evidence_reference) values
  ('aa100000-0000-4000-8000-000000000001','synthetic-reviewer','synthetic-evidence-1'),
  ('aa100000-0000-4000-8000-000000000003','synthetic-reviewer','synthetic-evidence-3');
select is(public.find_representative_resale_fiscal_rule_candidate('synthetic-issuer',repeat('a',64),'MG','SP','business','taxpayer',false,'resale')->>'id','aa100000-0000-4000-8000-000000000001','one approved matching version is a candidate');
select is(public.find_representative_resale_fiscal_rule_candidate('synthetic-issuer',repeat('a',64),'MG','SP','individual','taxpayer',false,'resale'),null::jsonb,'different recipient does not match');
select is(public.find_representative_resale_fiscal_rule_candidate('synthetic-issuer',repeat('a',64),'MG','SP','business','taxpayer',null,'resale'),null::jsonb,'missing consumer status fails closed');
select is(public.find_representative_resale_fiscal_rule_candidate('synthetic-issuer',repeat('b',64),'MG','SP','business','taxpayer',false,'resale'),null::jsonb,'expired version is not returned');
select throws_ok($$update private.representative_resale_fiscal_rule_versions set fiscal_parameters='{"fixture":false}'::jsonb where id='aa100000-0000-4000-8000-000000000001'$$,'23514','resale_fiscal_history_is_append_only','approved rule contents cannot be edited');
select throws_ok($$delete from private.representative_resale_fiscal_rule_approvals where rule_version_id='aa100000-0000-4000-8000-000000000001'$$,'23514','resale_fiscal_history_is_append_only','approval cannot be silently removed');

insert into private.representative_resale_fiscal_rule_approvals(rule_version_id,approver_reference,evidence_reference)
values ('aa100000-0000-4000-8000-000000000002','synthetic-reviewer','synthetic-evidence-2');
select is(public.find_representative_resale_fiscal_rule_candidate('synthetic-issuer',repeat('a',64),'MG','SP','business','taxpayer',false,'resale'),null::jsonb,'overlapping approved versions fail closed');
insert into private.representative_resale_fiscal_rule_revocations(rule_version_id,reason)
values ('aa100000-0000-4000-8000-000000000002','synthetic revocation reason');
select is(public.find_representative_resale_fiscal_rule_candidate('synthetic-issuer',repeat('a',64),'MG','SP','business','taxpayer',false,'resale')->>'id','aa100000-0000-4000-8000-000000000001','revocation excludes only that version');
select throws_ok($$delete from private.representative_resale_fiscal_rule_revocations where rule_version_id='aa100000-0000-4000-8000-000000000002'$$,'23514','resale_fiscal_history_is_append_only','revocation cannot be silently removed');

select ok(not has_function_privilege('authenticated','public.read_representative_resale_product_fingerprint(uuid)','execute'),'clients cannot calculate trusted fiscal fingerprints');
select ok(has_function_privilege('service_role','public.read_representative_resale_product_fingerprint(uuid)','execute'),'server may calculate a product fingerprint');
select is(public.read_representative_resale_product_fingerprint('ab100000-0000-4000-8000-000000000001'),null::text,'unknown variant has no fingerprint');
insert into public.categories(id,name,slug) values ('ab200000-0000-4000-8000-000000000001','Fiscal fixture','resale-fiscal-rule-fixture');
insert into public.products(id,name,slug,category_id,status,base_price,description,weight_grams,height_cm,width_cm,length_cm)
values ('ab300000-0000-4000-8000-000000000001','Fiscal fixture','resale-fiscal-rule-fixture','ab200000-0000-4000-8000-000000000001','draft',50,'Synthetic fixture',100,5,10,20);
insert into public.product_variants(id,product_id,sku,color_name,size)
values ('ab100000-0000-4000-8000-000000000001','ab300000-0000-4000-8000-000000000001','RESALE-RULE-FIXTURE','Synthetic','37');
insert into private.bling_catalog_metadata(product_id,commercial_unit,pairs_per_sku,ncm,origin,cest,production_type,evidence_reference)
values ('ab300000-0000-4000-8000-000000000001','UN',2,'11111111',0,'','T','synthetic fixture evidence');
select is(public.read_representative_resale_product_fingerprint('ab100000-0000-4000-8000-000000000001'),null::text,'inactive product has no fingerprint');
insert into public.product_images(product_id,storage_path,alt_text,width,height,is_primary)
values ('ab300000-0000-4000-8000-000000000001','test/resale-rule-fixture.webp','Synthetic fixture',720,720,true);
update public.products set status='active' where id='ab300000-0000-4000-8000-000000000001';
select is(public.read_representative_resale_product_fingerprint('ab100000-0000-4000-8000-000000000001'),null::text,'missing composition has no fingerprint');
insert into private.bling_kit_fiscal_components(kit_variant_id,position,sku,description,unit,quantity_pairs,allocation_weight,ncm,origin,cest,source_hash,evidence_reference)
values
 ('ab100000-0000-4000-8000-000000000001',1,'RESALE-RULE-PAIR-1','Synthetic pair 1','PR',1,1,'11111111',0,'',private.bling_kit_source_hash('ab100000-0000-4000-8000-000000000001'),'synthetic fixture evidence'),
 ('ab100000-0000-4000-8000-000000000001',2,'RESALE-RULE-PAIR-2','Synthetic pair 2','PR',1,1,'11111111',0,'',private.bling_kit_source_hash('ab100000-0000-4000-8000-000000000001'),'synthetic fixture evidence');
create temporary table resale_fingerprint_fixture as select public.read_representative_resale_product_fingerprint('ab100000-0000-4000-8000-000000000001') as fingerprint;
select matches((select fingerprint from resale_fingerprint_fixture),'^[a-f0-9]{64}$','complete current kit has a deterministic fingerprint');
select is(public.read_representative_resale_product_fingerprint('ab100000-0000-4000-8000-000000000001'),(select fingerprint from resale_fingerprint_fixture),'unchanged product has the same fingerprint');
select ok(not has_function_privilege('authenticated','public.find_representative_resale_fiscal_rule_for_variant(uuid,text,text,text,text,text,boolean,text)','execute'),'clients cannot select approved rule candidates');
insert into private.representative_resale_fiscal_rule_versions
  (id,rule_key,version,issuer_reference,product_fingerprint,origin_state,destination_state,person_type,icms_status,final_consumer,purpose,valid_from,valid_until,fiscal_parameters)
select 'aa100000-0000-4000-8000-000000000004','aa200000-0000-4000-8000-000000000004',1,'synthetic-issuer',fingerprint,'MG','SP','business','taxpayer',false,'resale',now()-interval '1 day',now()+interval '1 day','{"fixture":true}'::jsonb from resale_fingerprint_fixture;
insert into private.representative_resale_fiscal_rule_approvals(rule_version_id,approver_reference,evidence_reference)
values ('aa100000-0000-4000-8000-000000000004','synthetic-reviewer','synthetic-evidence-4');
select is(public.find_representative_resale_fiscal_rule_for_variant('ab100000-0000-4000-8000-000000000001','synthetic-issuer','MG','SP','business','taxpayer',false,'resale')->>'id','aa100000-0000-4000-8000-000000000004','server-derived fingerprint matches the exact kit rule');
update private.bling_kit_fiscal_components set quantity_pairs=2 where kit_variant_id='ab100000-0000-4000-8000-000000000001' and position=1;
select is(public.read_representative_resale_product_fingerprint('ab100000-0000-4000-8000-000000000001'),null::text,'component quantities must match the kit');
select is(public.find_representative_resale_fiscal_rule_for_variant('ab100000-0000-4000-8000-000000000001','synthetic-issuer','MG','SP','business','taxpayer',false,'resale'),null::jsonb,'incomplete kit cannot match a rule');
update private.bling_kit_fiscal_components set quantity_pairs=1 where kit_variant_id='ab100000-0000-4000-8000-000000000001' and position=1;
update private.bling_kit_fiscal_components set description='Synthetic changed pair' where kit_variant_id='ab100000-0000-4000-8000-000000000001' and position=1;
select isnt(public.read_representative_resale_product_fingerprint('ab100000-0000-4000-8000-000000000001'),(select fingerprint from resale_fingerprint_fixture),'composition change alters fingerprint');
select is(public.find_representative_resale_fiscal_rule_for_variant('ab100000-0000-4000-8000-000000000001','synthetic-issuer','MG','SP','business','taxpayer',false,'resale'),null::jsonb,'changed composition does not reuse prior approval');
update public.products set name='Synthetic changed product' where id='ab300000-0000-4000-8000-000000000001';
select is(public.read_representative_resale_product_fingerprint('ab100000-0000-4000-8000-000000000001'),null::text,'stale composition cannot produce a fingerprint');

select * from finish();
rollback;

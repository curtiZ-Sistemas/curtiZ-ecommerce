begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Four representatives: approved application with a valid CNPJ, application not approved,
-- invalid CNPJ, and one that already holds a manual approval for the second kit.
create temporary table app_kit_fixture as
select gen_random_uuid() category,gen_random_uuid() product,gen_random_uuid() variant,
  gen_random_uuid() product2,gen_random_uuid() variant2,gen_random_uuid() rule2;
create temporary table app_kit_actor as
select n,gen_random_uuid() actor,gen_random_uuid() application,gen_random_uuid() representative,gen_random_uuid() address
from generate_series(1,4) n;

insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
  select actor,'kit-app-'||n||'@example.invalid','{}'::jsonb,'{}'::jsonb from app_kit_actor;
update public.profiles p set status='active',full_name='Pessoa Teste '||x.n
  from app_kit_actor x where p.id=x.actor;
insert into public.representative_applications(id,user_id,status,answers,cpf_ciphertext,cpf_last_four)
select application,actor,
  case when n=2 then 'submitted' else 'approved' end::public.representative_application_status,
  case n
    when 1 then '{"2":{"city":"BH","cnpj":"11222333000181","legalName":"Loja Teste LTDA","stateRegistration":"0012345670089"}}'
    when 2 then '{"2":{"city":"BH","cnpj":"11222333000181","legalName":"Loja Pendente LTDA"}}'
    when 3 then '{"2":{"city":"BH","cnpj":"11222333000182","legalName":"Loja Invalida LTDA","stateRegistration":"0012345670089"}}'
    else '{"2":{"city":"BH"}}'
  end::jsonb,
  'v1.synthetic.ciphertext.only','4725'
from app_kit_actor;
insert into public.representatives(id,user_id,application_id,status)
  select representative,actor,application,'approved_waiting_kit' from app_kit_actor;
insert into public.addresses(id,user_id,label,recipient_name,postal_code,street,number,district,city,state)
  select address,actor,'Test','Test recipient','30110-100','Test street','1','Test district','Test city','MG' from app_kit_actor;

insert into public.categories(id,name,slug) select category,'Kit app test',category::text from app_kit_fixture;
insert into public.products(id,name,slug,category_id,status,base_price,weight_grams,width_cm,height_cm,length_cm)
  select product,'Kit app test',product::text,category,'draft',50,250,10,5,20 from app_kit_fixture
  union all select product2,'Kit app test 2',product2::text,category,'draft',60,250,10,5,20 from app_kit_fixture;
insert into public.product_variants(id,product_id,sku,color_name,size)
  select variant,product,'TEST-APP-'||variant::text,'White','37' from app_kit_fixture
  union all select variant2,product2,'TEST-APP-'||variant2::text,'White','38' from app_kit_fixture;
insert into public.product_images(product_id,storage_path,alt_text,width,height,is_primary)
  select product,'test/kit-app.webp','App fixture',720,720,true from app_kit_fixture
  union all select product2,'test/kit-app-2.webp','App fixture 2',720,720,true from app_kit_fixture;
update public.products set status='active'
  where id in (select product from app_kit_fixture union select product2 from app_kit_fixture);
insert into public.inventory(variant_id,available_quantity,reserved_quantity)
  select variant,5,0 from app_kit_fixture union all select variant2,5,0 from app_kit_fixture;
insert into private.bling_catalog_metadata(product_id,commercial_unit,pairs_per_sku,ncm,origin,cest,production_type,evidence_reference)
  select product,'UN',2,'64022000',0,'','T','App fixture' from app_kit_fixture
  union all select product2,'UN',2,'64022000',0,'','T','App fixture 2' from app_kit_fixture;
insert into private.bling_kit_fiscal_components(
  kit_variant_id,position,sku,description,unit,quantity_pairs,allocation_weight,ncm,origin,cest,source_hash,evidence_reference)
select v.variant,n,'APP-PAIR-'||n,'Fixture pair '||n,'PR',1,1,'64022000',0,'',
  private.bling_kit_source_hash(v.variant),'Synthetic fixture evidence'
from (select variant from app_kit_fixture union all select variant2 from app_kit_fixture) v cross join generate_series(1,2) n;

-- The second kit already has an MG02 rule from another issuer and a manual approval for actor 4.
insert into private.representative_resale_fiscal_rule_versions
  (id,rule_key,version,issuer_reference,product_fingerprint,origin_state,destination_state,person_type,
    icms_status,final_consumer,purpose,valid_from,valid_until,fiscal_parameters)
select rule2,gen_random_uuid(),1,'synthetic issuer',public.read_representative_resale_product_fingerprint(variant2),
  'MG','MG','business','taxpayer',false,'resale',now()-interval '1 day',now()+interval '1 day',
  '{"buyerProfile":"MG02","issuerDocument":"12345678000195","classification":"third_party_no_st","creditEligible":false,"advancePixWithManualInvoice":true,
    "returnRules":{"own_inflow":{"cfop":"1202","taxCodeKind":"CSOSN","taxCode":"102","homologationEvidence":"synthetic return XML"}},
    "blingRule":{"scenario":"resale_in_state_no_credit","issuer_state":"MG","series":3,"document_model":55,"cfop":"5102",
    "csosn":"102","icms_rate":0,"pis_cst":"49","cofins_cst":"49","ipi_cst":"99","ipi_cenq":"999",
    "pis_rate":0,"cofins_rate":0,"ipi_rate":0,"natures":[{"final_consumer":false,"external_nature_id":123}]}}'
from app_kit_fixture;
insert into private.representative_resale_fiscal_rule_approvals(rule_version_id,approver_reference,evidence_reference)
select rule2,'synthetic approver','synthetic evidence' from app_kit_fixture;
insert into private.representative_kit_checkout_approvals(
  actor_id,rule_version_id,buyer_profile,buyer_fiscal_state,origin_postal_code,buyer_evidence,operation_evidence,
  stock_evidence,homologation_evidence,valid_until)
select a.actor,f.rule2,'MG02','MG','35520000','synthetic buyer','synthetic operation','synthetic stock',
  'synthetic XML authorization',now()+interval '1 hour'
from app_kit_fixture f join app_kit_actor a on a.n=4;

create function pg_temp.enable_for(p_n integer) returns boolean language plpgsql as $$
declare v_actor uuid;
begin
  select actor into v_actor from app_kit_actor where n=p_n;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_actor,'role','authenticated')::text,true);
  return public.read_representative_kit_buyer_enabled();
end;
$$;
select is(pg_temp.enable_for(1),true,'representative 1 is enabled');
select is(pg_temp.enable_for(2),true,'representative 2 is enabled');
select is(pg_temp.enable_for(3),true,'representative 3 is enabled');
select is(pg_temp.enable_for(4),true,'representative 4 is enabled');
select set_config('request.jwt.claims','{}',true);

create function pg_temp.auto_approval(p_n integer) returns private.representative_kit_checkout_approvals language sql as $$
  select a.* from private.representative_kit_checkout_approvals a
  join app_kit_actor x on x.actor=a.actor_id and x.n=p_n
  join private.representative_resale_fiscal_rule_versions r on r.id=a.rule_version_id
  join app_kit_fixture f on r.product_fingerprint=public.read_representative_resale_product_fingerprint(f.variant)
  where a.granted_automatically;
$$;

select ok((select a.buyer_document='11222333000181' and a.buyer_legal_name='Loja Teste LTDA'
    and a.buyer_state_registration='0012345670089' and a.buyer_fiscal_address ->> 'postal_code'='30110100'
  from pg_temp.auto_approval(1) a),
  'the automatic approval uses the CNPJ, legal name and state registration of the approved application');
select ok((select a.buyer_document is null and a.buyer_state_registration is null and a.buyer_legal_name='Pessoa Teste 2'
  from pg_temp.auto_approval(2) a),'an application that is not approved never supplies a CNPJ');
select ok((select a.buyer_document is null and a.buyer_state_registration is null and a.buyer_legal_name='Pessoa Teste 3'
  from pg_temp.auto_approval(3) a),'an invalid CNPJ is ignored, with its registration and legal name');
select ok((select a.buyer_document is null and a.buyer_legal_name='Pessoa Teste 4' from pg_temp.auto_approval(4) a),
  'an application without company data keeps the approval without a CNPJ');

-- A later change of the application is picked up until an order depends on the approval.
update public.representative_applications set answers='{"2":{"cnpj":"11.222.333/0001-81","legalName":"Loja Nova LTDA"}}'::jsonb
  where id=(select application from app_kit_actor where n=4);
select is(pg_temp.enable_for(4),true,'representative 4 asks again');
select set_config('request.jwt.claims','{}',true);
select is((select a.buyer_document||'/'||a.buyer_legal_name from pg_temp.auto_approval(4) a),'11222333000181/Loja Nova LTDA',
  'the automatic approval is refreshed from the application');

-- Existing approvals and rules are never duplicated.
select is((select count(*)::integer from private.representative_kit_checkout_approvals a
  join app_kit_actor x on x.actor=a.actor_id and x.n=4 join private.representative_resale_fiscal_rule_versions r on r.id=a.rule_version_id
  where r.product_fingerprint=public.read_representative_resale_product_fingerprint((select variant2 from app_kit_fixture))),
  1,'a manual approval for a kit blocks a second automatic one for the same fingerprint');
select is((select count(*)::integer from private.representative_resale_fiscal_rule_versions r
  where r.product_fingerprint=public.read_representative_resale_product_fingerprint((select variant2 from app_kit_fixture))),
  1,'an MG02 rule from another issuer prevents seeding a second rule');
select is((select count(*)::integer from private.representative_kit_checkout_approvals a
  join app_kit_actor x on x.actor=a.actor_id and x.n=1
  join private.representative_resale_fiscal_rule_versions r on r.id=a.rule_version_id
  where r.product_fingerprint=public.read_representative_resale_product_fingerprint((select variant from app_kit_fixture))),
  1,'asking again never adds a second approval for the same kit');

-- The CPF stays encrypted: only the service role reads the ciphertext, and only for approved applications.
select is((select public.read_representative_kit_payer_cpf(actor) from app_kit_actor where n=1),
  'v1.synthetic.ciphertext.only','the service role reads the ciphertext of an approved representative');
select is((select public.read_representative_kit_payer_cpf(actor) from app_kit_actor where n=2),null::text,
  'an application that is not approved yields no CPF');
select is(public.read_representative_kit_payer_cpf(gen_random_uuid()),null::text,'an unknown account yields no CPF');
select ok(not has_function_privilege('authenticated','public.read_representative_kit_payer_cpf(uuid)','execute')
  and not has_function_privilege('anon','public.read_representative_kit_payer_cpf(uuid)','execute')
  and has_function_privilege('service_role','public.read_representative_kit_payer_cpf(uuid)','execute'),
  'only the service role reads the payer CPF ciphertext');
select ok(not has_function_privilege('authenticated','public.claim_representative_kit_pix(uuid,uuid,boolean)','execute')
  and has_function_privilege('service_role','public.claim_representative_kit_pix(uuid,uuid,boolean)','execute'),
  'only the service role claims the Pix creation');
select ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='claim_representative_kit_pix' and p.pronargs=2),
  'the two-argument claim no longer exists');
select ok(private.is_valid_cnpj('11222333000181') and not private.is_valid_cnpj('11222333000182')
  and not private.is_valid_cnpj('00000000000000') and not private.is_valid_cnpj(null) and not private.is_valid_cnpj('123'),
  'CNPJ check digits are verified');
select ok(not exists(select 1 from public.audit_logs a
  where a.action='representative.kit.mg02.auto_enabled' and (to_jsonb(a)::text like '%11222333000181%'
    or to_jsonb(a)::text like '%Loja%')),'the audit entries carry no CNPJ or company name');

select * from finish();
rollback;

-- MG02 wholesale setup is separate from the retail sale_in_state rule.
-- The return series remains in the per-channel fiscal snapshot so retail keeps its current numbering.
do $$
declare changed integer;
begin
  update private.bling_fiscal_rules
  set series=3,external_nature_id=15111725693,
      evidence_reference='Owner instruction 2026-11-22: MG02 CFOP5102/CSOSN102 sem credito, serie003 e natureza Bling 15111725693; sem autorizacao SEFAZ alegada.',
      updated_at=clock_timestamp()
  where scenario='resale_in_state_no_credit' and issuer_state='MG' and cfop='5102' and csosn='102'
    and series=2 and external_nature_id is null;
  get diagnostics changed=row_count;
  if changed<>1 then raise exception 'mg02_sale_fiscal_rule_unexpected'; end if;

  update private.bling_fiscal_natures
  set final_consumer=false,
      evidence_reference='Owner instruction 2026-11-22 identifies return nature 15111772281 as not final consumer; actual NF-e remains subject to SEFAZ authorization.',
      updated_at=clock_timestamp()
  where scenario='return_in_state' and final_consumer=true and external_nature_id=15111772281;
  get diagnostics changed=row_count;
  if changed<>1 then raise exception 'mg02_return_nature_unexpected'; end if;
end;
$$;

-- Append one shared, no-credit MG02 rule for each active kit with a current
-- server-derived fiscal fingerprint. Source references truthfully identify
-- the owner's report; deleted test artifacts are not represented as records.
with fingerprints as (
  select distinct public.read_representative_resale_product_fingerprint(v.id) as fingerprint
  from public.product_variants v join public.products p on p.id=v.product_id
  where v.active and p.status='active'
    and public.read_representative_resale_product_fingerprint(v.id) is not null
), inserted as (
  insert into private.representative_resale_fiscal_rule_versions(
    rule_key,version,issuer_reference,product_fingerprint,origin_state,destination_state,
    person_type,icms_status,final_consumer,purpose,valid_from,valid_until,fiscal_parameters
  )
  select gen_random_uuid(),1,'68267385000191',f.fingerprint,'MG','MG','business','taxpayer',false,'resale',
    clock_timestamp(),'infinity'::timestamptz,
    jsonb_build_object(
      'buyerProfile','MG02','issuerDocument','68267385000191','classification','third_party_no_st',
      'creditEligible',false,'advancePixWithManualInvoice',true,
      'returnRules',jsonb_build_object('own_inflow',jsonb_build_object(
        'cfop','1202','taxCodeKind','CSOSN','taxCode','102','series',4,
        'external_nature_id',15111772281,
        'homologationEvidence','Owner reports sale and return tests passed on 2026-11-22; records were deleted, no XML or SEFAZ protocol retained. Verify each real return document.'
      )),
      'blingRule',jsonb_build_object(
        'scenario','resale_in_state_no_credit','issuer_state','MG','series',3,'document_model',55,
        'cfop','5102','csosn','102','icms_rate',0,'pis_cst','49','cofins_cst','49',
        'ipi_cst','99','ipi_cenq','999','pis_rate',0,'cofins_rate',0,'ipi_rate',0,
        'natures',jsonb_build_array(jsonb_build_object('final_consumer',false,'external_nature_id',15111725693))
      )
    )
  from fingerprints f
  where not exists (
    select 1 from private.representative_resale_fiscal_rule_versions old
    where old.issuer_reference='68267385000191' and old.product_fingerprint=f.fingerprint
      and old.origin_state='MG' and old.destination_state='MG' and old.person_type='business'
      and old.icms_status='taxpayer' and not old.final_consumer and old.purpose='resale'
      and old.fiscal_parameters ->> 'buyerProfile'='MG02'
  )
  returning id
)
insert into private.representative_resale_fiscal_rule_approvals(rule_version_id,approver_reference,evidence_reference)
select id,'Curti Z owner instruction 2026-11-22',
  'Owner reports accounting approval and successful manual sale/return tests; records were deleted. No accountant document, XML or protocol is retained.'
from inserted;

create function public.approve_representative_kit_mg02(
  p_representative_code text,p_document text,p_legal_name text,p_state_registration text,p_fiscal_address jsonb,
  p_buyer_evidence text,p_operation_evidence text,p_stock_evidence text,p_homologation_evidence text,
  p_valid_until timestamptz
) returns integer language plpgsql security definer set search_path = '' as $$
declare approved_count integer; v_actor uuid;
begin
  perform private.require_permission('representatives.rules.manage');
  if auth.uid() is null or coalesce(p_representative_code,'') !~ '^REP-[A-Fa-f0-9]{10}$'
    or coalesce(p_document,'') !~ '^[0-9]{14}$'
    or length(btrim(coalesce(p_legal_name,''))) not between 2 and 180
    or coalesce(p_state_registration,'') !~ '^[0-9]{2,14}$'
    or jsonb_typeof(p_fiscal_address) is distinct from 'object'
    or coalesce(p_fiscal_address ->> 'state','')<>'MG'
    or coalesce(p_fiscal_address ->> 'postal_code','') !~ '^3[0-9]{7}$'
    or length(btrim(coalesce(p_fiscal_address ->> 'street','')))=0
    or length(btrim(coalesce(p_fiscal_address ->> 'number','')))=0
    or length(btrim(coalesce(p_fiscal_address ->> 'district','')))=0
    or length(btrim(coalesce(p_fiscal_address ->> 'city','')))=0
    or length(btrim(coalesce(p_buyer_evidence,''))) not between 10 and 500
    or length(btrim(coalesce(p_operation_evidence,''))) not between 10 and 500
    or length(btrim(coalesce(p_stock_evidence,''))) not between 10 and 500
    or length(btrim(coalesce(p_homologation_evidence,''))) not between 10 and 500
    or p_valid_until is null or not isfinite(p_valid_until) or p_valid_until<=statement_timestamp() then
    return 0;
  end if;

  select p.id into v_actor from public.profiles p join public.representatives r on r.user_id=p.id
    where upper(r.public_code)=upper(btrim(p_representative_code)) and p.status::text='active'
      and r.status::text in ('approved_waiting_kit','active','unqualified') for update of p,r;
  if not found or v_actor=auth.uid() then return 0; end if;
  perform pg_advisory_xact_lock(hashtextextended('representative_kit_mg02:'||v_actor::text,0));
  if exists(select 1 from private.representative_kit_orders o
    where o.actor_id=v_actor and o.payment_started_at is not null) then return 0; end if;

  if not exists(select 1 from public.product_variants v join public.products product on product.id=v.product_id
      where v.active and product.status='active'
        and public.read_representative_resale_product_fingerprint(v.id) is not null) then return 0; end if;
  if exists(
    with fingerprints as (
      select distinct public.read_representative_resale_product_fingerprint(v.id) as fingerprint
      from public.product_variants v join public.products product on product.id=v.product_id
      where v.active and product.status='active'
        and public.read_representative_resale_product_fingerprint(v.id) is not null
    )
    select 1 from fingerprints f where 1<(
      select count(*) from private.representative_resale_fiscal_rule_versions rule
      join private.representative_resale_fiscal_rule_approvals evidence on evidence.rule_version_id=rule.id
      left join private.representative_resale_fiscal_rule_revocations revoked on revoked.rule_version_id=rule.id
      where rule.issuer_reference='68267385000191' and rule.product_fingerprint=f.fingerprint
        and rule.origin_state='MG' and rule.destination_state='MG' and rule.person_type='business'
        and rule.icms_status='taxpayer' and not rule.final_consumer and rule.purpose='resale'
        and rule.valid_from<=statement_timestamp() and statement_timestamp()<rule.valid_until
        and revoked.rule_version_id is null
        and rule.fiscal_parameters ->> 'buyerProfile'='MG02'
        and rule.fiscal_parameters -> 'creditEligible'='false'::jsonb
        and rule.fiscal_parameters -> 'advancePixWithManualInvoice'='true'::jsonb
        and rule.fiscal_parameters #>> '{blingRule,scenario}'='resale_in_state_no_credit'
        and rule.fiscal_parameters #>> '{blingRule,series}'='3'
        and rule.fiscal_parameters #>> '{blingRule,cfop}'='5102'
        and rule.fiscal_parameters #>> '{blingRule,csosn}'='102'
        and rule.fiscal_parameters #>> '{returnRules,own_inflow,cfop}'='1202'
        and rule.fiscal_parameters #>> '{returnRules,own_inflow,series}'='4'
    )
  ) then return 0; end if;

  with fingerprints as (
    select distinct public.read_representative_resale_product_fingerprint(v.id) as fingerprint
    from public.product_variants v join public.products product on product.id=v.product_id
    where v.active and product.status='active'
      and public.read_representative_resale_product_fingerprint(v.id) is not null
  )
  insert into private.representative_kit_checkout_approvals(
    actor_id,rule_version_id,buyer_profile,buyer_fiscal_state,origin_postal_code,
    buyer_evidence,operation_evidence,stock_evidence,homologation_evidence,valid_until,
    buyer_legal_name,buyer_document,buyer_state_registration,buyer_fiscal_address
  )
  select v_actor,rule.id,'MG02','MG','35524168',p_buyer_evidence,p_operation_evidence,p_stock_evidence,
    p_homologation_evidence,p_valid_until,btrim(p_legal_name),p_document,p_state_registration,
    jsonb_build_object('state','MG','postal_code',p_fiscal_address ->> 'postal_code',
      'street',btrim(p_fiscal_address ->> 'street'),'number',btrim(p_fiscal_address ->> 'number'),
      'district',btrim(p_fiscal_address ->> 'district'),'city',btrim(p_fiscal_address ->> 'city'))
  from private.representative_resale_fiscal_rule_versions rule
  join fingerprints on fingerprints.fingerprint=rule.product_fingerprint
  where rule.issuer_reference='68267385000191' and rule.origin_state='MG' and rule.destination_state='MG'
    and rule.person_type='business' and rule.icms_status='taxpayer' and not rule.final_consumer
    and rule.purpose='resale' and rule.valid_from<=statement_timestamp() and statement_timestamp()<rule.valid_until
    and rule.fiscal_parameters ->> 'buyerProfile'='MG02'
    and rule.fiscal_parameters -> 'creditEligible'='false'::jsonb
    and rule.fiscal_parameters -> 'advancePixWithManualInvoice'='true'::jsonb
    and rule.fiscal_parameters #>> '{blingRule,scenario}'='resale_in_state_no_credit'
    and rule.fiscal_parameters #>> '{blingRule,series}'='3'
    and rule.fiscal_parameters #>> '{blingRule,cfop}'='5102'
    and rule.fiscal_parameters #>> '{blingRule,csosn}'='102'
    and rule.fiscal_parameters #>> '{returnRules,own_inflow,cfop}'='1202'
    and rule.fiscal_parameters #>> '{returnRules,own_inflow,series}'='4'
  on conflict(actor_id,rule_version_id) do update set
    buyer_profile=excluded.buyer_profile,buyer_fiscal_state=excluded.buyer_fiscal_state,
    origin_postal_code=excluded.origin_postal_code,buyer_evidence=excluded.buyer_evidence,
    operation_evidence=excluded.operation_evidence,stock_evidence=excluded.stock_evidence,
    homologation_evidence=excluded.homologation_evidence,valid_until=excluded.valid_until,revoked_at=null,
    buyer_legal_name=excluded.buyer_legal_name,buyer_document=excluded.buyer_document,
    buyer_state_registration=excluded.buyer_state_registration,buyer_fiscal_address=excluded.buyer_fiscal_address;
  get diagnostics approved_count=row_count;
  if approved_count=0 then return 0; end if;
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
  values(auth.uid(),private.current_app_role(),'representative.kit.mg02.approved',
    'representative_kit_checkout_approval',v_actor,
    jsonb_build_object('profile','MG02','originPostalCode','35524168','ruleVersions',approved_count,
      'validUntil',p_valid_until,'evidenceRecorded',true));
  return approved_count;
end;
$$;
revoke all on function public.approve_representative_kit_mg02(text,text,text,text,jsonb,text,text,text,text,timestamptz)
  from public,anon,service_role;
grant execute on function public.approve_representative_kit_mg02(text,text,text,text,jsonb,text,text,text,text,timestamptz)
  to authenticated;

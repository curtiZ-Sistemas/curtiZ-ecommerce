-- Correct the MG02 Bling nature mapping without changing fiscal parameters or historical documents.
-- Evidence: owner-provided Bling configuration 2026-11-26: 15111975260, series 003,
-- MG, CFOP 5102, CSOSN 102, IPI 99, PIS/COFINS 49, zero rates.
do $migration$
declare
  r private.representative_resale_fiscal_rule_versions;
  new_id uuid;
  def text;
  cutover timestamptz := statement_timestamp();
begin
  perform pg_advisory_xact_lock(hashtextextended('representative_kit_mg02_rules',0));
  -- Existing representative orders require separate reconciliation before a rule cutover.
  if exists (select 1 from private.representative_kit_orders o
    join private.representative_resale_fiscal_rule_versions v on v.id=o.rule_version_id
    where v.fiscal_parameters #>> '{blingRule,natures,0,external_nature_id}'='15111725693') then
    raise exception 'MG02 cutover: reconcile existing representative orders first';
  end if;
  if exists (select 1 from private.wholesale_kit_invoices where status='issuing') then
    raise exception 'MG02 cutover: active invoice issuance';
  end if;

  update private.bling_fiscal_rules set external_nature_id=15111975260,
    evidence_reference='Owner instruction 2026-11-26: correct MG02 Bling nature to 15111975260, series 003; screenshots of ICMS, IPI, PIS, COFINS; no SEFAZ authorization claimed.',
    updated_at=cutover
  where scenario='resale_in_state_no_credit' and issuer_state='MG' and cfop='5102' and csosn='102'
    and series=3 and external_nature_id=15111725693;
  update private.bling_fiscal_natures set external_nature_id=15111975260,
    evidence_reference='Owner instruction 2026-11-26: MG02 production nature 15111975260, series 003; old nature was series 002.',
    updated_at=cutover
  where scenario='resale_in_state_no_credit' and not final_consumer and external_nature_id=15111725693;

  for r in
    select v.* from private.representative_resale_fiscal_rule_versions v
    join private.representative_resale_fiscal_rule_approvals a on a.rule_version_id=v.id
    left join private.representative_resale_fiscal_rule_revocations x on x.rule_version_id=v.id
    where x.rule_version_id is null and v.valid_from<=cutover and cutover<v.valid_until
      and v.origin_state='MG' and v.destination_state='MG' and v.person_type='business'
      and v.icms_status='taxpayer' and not v.final_consumer and v.purpose='resale'
      and v.fiscal_parameters->>'buyerProfile'='MG02'
      and v.fiscal_parameters->'creditEligible'='false'::jsonb
      and v.fiscal_parameters #>> '{blingRule,scenario}'='resale_in_state_no_credit'
      and v.fiscal_parameters #>> '{blingRule,series}'='3'
      and v.fiscal_parameters #>> '{blingRule,cfop}'='5102'
      and v.fiscal_parameters #>> '{blingRule,csosn}'='102'
      and v.fiscal_parameters #> '{blingRule,natures}'='[{"final_consumer":false,"external_nature_id":15111725693}]'::jsonb
  loop
    insert into private.representative_resale_fiscal_rule_versions
      (rule_key,version,issuer_reference,product_fingerprint,origin_state,destination_state,person_type,icms_status,final_consumer,purpose,valid_from,valid_until,fiscal_parameters)
    values (r.rule_key,(select max(v.version)+1 from private.representative_resale_fiscal_rule_versions v where v.rule_key=r.rule_key),
      r.issuer_reference,r.product_fingerprint,r.origin_state,r.destination_state,r.person_type,r.icms_status,r.final_consumer,r.purpose,
      cutover,r.valid_until,jsonb_set(r.fiscal_parameters,'{blingRule,natures,0,external_nature_id}','15111975260'::jsonb,false))
    returning id into new_id;
    insert into private.representative_resale_fiscal_rule_approvals(rule_version_id,approver_reference,evidence_reference)
    values(new_id,'Curti Z owner instruction 2026-11-26','Technical correction of MG02 mapping only: Bling nature 15111975260, series 003, screenshots supplied by owner; prior tax parameters preserved, no new accountant approval or authorized XML claimed.');
    -- Preserve buyer approvals and their expiry/revocation exactly; historical rows stay intact.
    insert into private.representative_kit_checkout_approvals
      (actor_id,rule_version_id,buyer_profile,buyer_fiscal_state,origin_postal_code,buyer_evidence,operation_evidence,stock_evidence,homologation_evidence,valid_until,revoked_at,buyer_document,buyer_legal_name,buyer_state_registration,buyer_fiscal_address,granted_automatically)
    select actor_id,new_id,buyer_profile,buyer_fiscal_state,origin_postal_code,buyer_evidence,operation_evidence,stock_evidence,homologation_evidence,valid_until,revoked_at,buyer_document,buyer_legal_name,buyer_state_registration,buyer_fiscal_address,granted_automatically
    from private.representative_kit_checkout_approvals where rule_version_id=r.id;
    insert into private.representative_resale_fiscal_rule_revocations(rule_version_id,reason)
    values(r.id,'Superseded 2026-11-26: old Bling homologation nature generates series 002; corrected MG02 nature generates series 003.');
  end loop;

  -- Keep existing drafts bound to their historical rule and external IDs.
  -- Future product fingerprints must never reintroduce the old nature.
  def := pg_get_functiondef('private.ensure_representative_kit_mg02_rules()'::regprocedure);
  if position('15111725693' in def)>0 then
    execute replace(def,'15111725693','15111975260');
  elsif position('15111975260' in def)=0 then
    raise exception 'MG02 seed definition changed; review before mapping correction';
  end if;
end;
$migration$;

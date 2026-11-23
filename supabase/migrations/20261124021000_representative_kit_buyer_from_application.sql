-- Follow-up to 20261124020000 (already applied): the automatic buyer approval now takes the
-- company data from the representative's approved application, never duplicates an approval or
-- a rule that already exists, and the Pix can be issued to a CPF when no CNPJ is on file.
--
-- Where the data lives (checked on 2026-11-23, read-only):
--   public.representative_applications.answers -> '2' (clear text jsonb, step "Perfil comercial"):
--     cnpj, legalName, stateRegistration are optional fields collected by the application form.
--   public.representative_applications.cpf_ciphertext: CPF encrypted by the application (AES key
--     only the app holds). The database never decrypts it; the Pix path reads the ciphertext
--     through a service-role-only RPC and decrypts it in the server.
--   The solicitation has no street address; the fiscal address stays the buyer's own MG row in
--   public.addresses.
--
-- What changes
--  1. private.is_valid_cnpj(text): digits and check digits.
--  2. ensure_representative_kit_mg02_rules(): an MG02 rule of any issuer for the same fingerprint
--     counts as existing (a second one would make every approval lookup ambiguous).
--  3. ensure_representative_kit_auto_eligibility(): never adds an automatic approval for a
--     fingerprint where the actor already has any approval (manual, revoked or expired); fills
--     buyer_document / buyer_legal_name / buyer_state_registration from the approved application
--     when the CNPJ is valid, and refreshes them while no order depends on the approval.
--  4. claim_representative_kit_pix(actor,order,payer_cpf_ready): a buyer without CNPJ can pay when
--     the server confirms it holds a valid CPF for the payer.
--  5. read_representative_kit_payer_cpf(actor): ciphertext of the representative's CPF (service role).

create or replace function private.is_valid_cnpj(p_value text)
returns boolean language plpgsql immutable set search_path = '' as $$
declare d integer[]; s integer; i integer; w integer[]; dv integer;
begin
  if p_value is null or p_value !~ '^[0-9]{14}$' or p_value ~ '^(.)\1{13}$' then return false; end if;
  d := array(select substr(p_value,g,1)::integer from generate_series(1,14) g);
  w := array[5,4,3,2,9,8,7,6,5,4,3,2];
  s := 0; for i in 1..12 loop s := s + d[i]*w[i]; end loop;
  dv := s % 11; dv := case when dv < 2 then 0 else 11 - dv end;
  if dv <> d[13] then return false; end if;
  w := array[6,5,4,3,2,9,8,7,6,5,4,3,2];
  s := 0; for i in 1..13 loop s := s + d[i]*w[i]; end loop;
  dv := s % 11; dv := case when dv < 2 then 0 else 11 - dv end;
  return dv = d[14];
end;
$$;
revoke all on function private.is_valid_cnpj(text) from public,anon,authenticated,service_role;

create or replace function private.ensure_representative_kit_mg02_rules()
returns integer language plpgsql security definer set search_path = '' as $$
declare created integer;
begin
  -- Serialize seeding: the rule table has no unique key per fingerprint.
  perform pg_advisory_xact_lock(hashtextextended('representative_kit_mg02_rules',0));
  with missing as (
    select f.fingerprint from private.representative_kit_mg02_fingerprints() f(fingerprint)
    where not exists (
      select 1 from private.representative_resale_fiscal_rule_versions old
      where old.product_fingerprint=f.fingerprint
        and old.origin_state='MG' and old.destination_state='MG' and old.person_type='business'
        and old.icms_status='taxpayer' and not old.final_consumer and old.purpose='resale'
        and old.fiscal_parameters ->> 'buyerProfile'='MG02')
  ), inserted as (
    insert into private.representative_resale_fiscal_rule_versions(
      rule_key,version,issuer_reference,product_fingerprint,origin_state,destination_state,
      person_type,icms_status,final_consumer,purpose,valid_from,valid_until,fiscal_parameters)
    select gen_random_uuid(),1,'68267385000191',m.fingerprint,'MG','MG','business','taxpayer',false,'resale',
      statement_timestamp(),'infinity'::timestamptz,
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
    from missing m
    returning id
  )
  insert into private.representative_resale_fiscal_rule_approvals(rule_version_id,approver_reference,evidence_reference)
  select id,'Curti Z owner instruction 2026-11-23',
    'Owner decision: every active representative may buy kits; same MG02 no-credit parameters reported as approved on 2026-11-22. No new accountant document is retained.'
  from inserted;
  get diagnostics created=row_count;
  return created;
end;
$$;
revoke all on function private.ensure_representative_kit_mg02_rules()
  from public,anon,authenticated,service_role;
create or replace function private.ensure_representative_kit_auto_eligibility(p_actor uuid,p_address uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_name text; v_app uuid; addr public.addresses; fiscal jsonb; created integer := 0;
  v_cnpj text; v_legal text; v_ie text;
begin
  if p_actor is null then return false; end if;
  select p.full_name,r.application_id into v_name,v_app from public.profiles p
    join public.representatives r on r.user_id=p.id
    where p.id=p_actor and p.status::text='active'
      and r.status::text in ('approved_waiting_kit','active','unqualified');
  if not found then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('representative_kit_mg02:'||p_actor::text,0));
  perform private.ensure_representative_kit_mg02_rules();

  -- Company data typed by the applicant in the approved application (optional step 2 fields).
  select regexp_replace(coalesce(app.answers #>> '{2,cnpj}',''),'[^0-9]','','g'),
    btrim(coalesce(app.answers #>> '{2,legalName}','')),
    regexp_replace(coalesce(app.answers #>> '{2,stateRegistration}',''),'[^0-9]','','g')
    into v_cnpj,v_legal,v_ie
    from public.representative_applications app
    where app.id=v_app and app.user_id=p_actor and app.status::text='approved';
  if not found or not private.is_valid_cnpj(v_cnpj) then v_cnpj:=null; v_ie:=null; v_legal:=null; end if;
  if v_legal is not null and length(v_legal) not between 2 and 200 then v_legal:=null; end if;
  if v_ie is not null and v_ie !~ '^[0-9]{2,14}$' then v_ie:=null; end if;
  v_legal:=coalesce(v_legal,btrim(v_name));

  -- Only the buyer's own MG address can become the fiscal address; the quoted one wins.
  select a.* into addr from public.addresses a
    where a.user_id=p_actor and a.state='MG' and a.country='BR'
      and regexp_replace(a.postal_code,'[^0-9]','','g') ~ '^3[0-9]{7}$'
      and length(btrim(a.street))>0 and length(btrim(a.number))>0
      and length(btrim(a.district))>0 and length(btrim(a.city))>0
    order by (a.id is not distinct from p_address) desc,a.is_default desc,a.updated_at desc limit 1;
  if found then
    fiscal:=jsonb_build_object('state','MG','postal_code',regexp_replace(addr.postal_code,'[^0-9]','','g'),
      'street',btrim(addr.street),'number',btrim(addr.number),'district',btrim(addr.district),
      'city',btrim(addr.city));
  end if;

  with qualified as (
    select rule.id,rule.product_fingerprint
    from private.representative_resale_fiscal_rule_versions rule
    join private.representative_resale_fiscal_rule_approvals evidence on evidence.rule_version_id=rule.id
    left join private.representative_resale_fiscal_rule_revocations revoked on revoked.rule_version_id=rule.id
    where rule.issuer_reference='68267385000191' and rule.origin_state='MG' and rule.destination_state='MG'
      and rule.person_type='business' and rule.icms_status='taxpayer' and not rule.final_consumer
      and rule.purpose='resale' and rule.valid_from<=statement_timestamp() and statement_timestamp()<rule.valid_until
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
      and rule.product_fingerprint in (select f.fingerprint from private.representative_kit_mg02_fingerprints() f(fingerprint))
  ), single_rule as (
    select q.product_fingerprint,(array_agg(q.id))[1] as id from qualified q
    where not exists (
      select 1 from private.representative_kit_checkout_approvals have
      join private.representative_resale_fiscal_rule_versions have_rule on have_rule.id=have.rule_version_id
      where have.actor_id=p_actor and have_rule.product_fingerprint=q.product_fingerprint)
    group by q.product_fingerprint having count(*)=1
  ), inserted as (
    insert into private.representative_kit_checkout_approvals(
      actor_id,rule_version_id,buyer_profile,buyer_fiscal_state,origin_postal_code,
      buyer_evidence,operation_evidence,stock_evidence,homologation_evidence,valid_until,
      buyer_legal_name,buyer_document,buyer_state_registration,buyer_fiscal_address,granted_automatically)
    select p_actor,s.id,'MG02','MG','35524168',
      'Automatic eligibility: active representative account (owner decision 2026-11-23).',
      'Same MG02 manual-invoice operation the owner reported as approved on 2026-11-22.',
      'Stock is checked and reserved per order at checkout.',
      'Owner reports MG02 sale and return tests on 2026-11-22; no XML or SEFAZ protocol retained.',
      '2099-12-31 00:00:00+00',v_legal,v_cnpj,v_ie,fiscal,true
    from single_rule s
    on conflict(actor_id,rule_version_id) do nothing
    returning 1
  )
  select count(*) into created from inserted;

  -- Keep the automatic rows current until an order depends on them.
  update private.representative_kit_checkout_approvals a
    set buyer_fiscal_address=coalesce(fiscal,a.buyer_fiscal_address),buyer_legal_name=v_legal,
      buyer_document=v_cnpj,buyer_state_registration=v_ie
    where a.actor_id=p_actor and a.granted_automatically and a.revoked_at is null
      and (a.buyer_fiscal_address is distinct from coalesce(fiscal,a.buyer_fiscal_address)
        or a.buyer_legal_name is distinct from v_legal or a.buyer_document is distinct from v_cnpj
        or a.buyer_state_registration is distinct from v_ie)
      and not exists (select 1 from private.representative_kit_orders o
        where o.actor_id=p_actor and o.rule_version_id=a.rule_version_id);

  if created>0 then
    insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
    values(p_actor,null,'representative.kit.mg02.auto_enabled','representative_kit_checkout_approval',p_actor,
      jsonb_build_object('profile','MG02','automatic',true,'ruleVersions',created));
  end if;
  return true;
end;
$$;
revoke all on function private.ensure_representative_kit_auto_eligibility(uuid,uuid)
  from public,anon,authenticated,service_role;

-- Pix claim: the provider payer is the approved CNPJ or, without one, the representative's CPF.
-- The CPF is encrypted by the application, so the server states (p_payer_cpf_ready) that it holds
-- a decrypted, valid CPF before the one-time claim is consumed. Nothing here logs a document.
drop function if exists public.claim_representative_kit_pix(uuid,uuid);
create function public.claim_representative_kit_pix(p_actor uuid, p_order uuid, p_payer_cpf_ready boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  o private.representative_kit_orders;
  a private.representative_kit_checkout_approvals;
begin
  select * into o from private.representative_kit_orders where id = p_order and actor_id = p_actor for update;
  if not found then raise exception 'kit_access_denied' using errcode = '42501'; end if;
  if o.payment_started_at is not null then return null; end if;
  if o.state <> 'reserved' or o.reserved_until <= clock_timestamp() or not private.representative_kit_payment_allowed(o) then
    raise exception 'resale_payment_blocked' using errcode = '23514';
  end if;
  select * into a from private.representative_kit_checkout_approvals
    where actor_id = o.actor_id and rule_version_id = o.rule_version_id for share;
  if a.buyer_legal_name is null or a.revoked_at is not null or a.valid_until <= clock_timestamp()
    or (a.buyer_document is null and p_payer_cpf_ready is not true) then
    raise exception 'resale_payment_blocked' using errcode = '23514';
  end if;
  update private.representative_kit_orders set payment_started_at = clock_timestamp(),
    payment_checked_at = clock_timestamp(), payment_expires_at = clock_timestamp() + interval '30 minutes'
    where id = p_order returning * into o;
  return private.representative_kit_order_summary(o) || jsonb_build_object(
    'buyerDocument', a.buyer_document, 'buyerName', a.buyer_legal_name, 'expiresAt', o.payment_expires_at);
end;
$$;
revoke all on function public.claim_representative_kit_pix(uuid,uuid,boolean) from public, anon, authenticated;
grant execute on function public.claim_representative_kit_pix(uuid,uuid,boolean) to service_role;

-- Ciphertext of the CPF the person typed in the approved application. Only the server can
-- decrypt it. Returns null for anyone who is not a representative with an application.
create function public.read_representative_kit_payer_cpf(p_actor uuid)
returns text language sql stable security definer set search_path = '' as $$
  select app.cpf_ciphertext
  from public.representatives r
  join public.representative_applications app on app.id=r.application_id and app.user_id=r.user_id
  where r.user_id=p_actor and app.status::text='approved' and app.cpf_ciphertext is not null;
$$;
revoke all on function public.read_representative_kit_payer_cpf(uuid) from public, anon, authenticated;
grant execute on function public.read_representative_kit_payer_cpf(uuid) to service_role;

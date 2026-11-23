-- Automatic kit eligibility for every representative with an active program account.
--
-- Owner decision (2026-11-23): a person who has the representative account is eligible
-- automatically. The manual MG02 approval (approve_representative_kit_mg02) is no longer
-- required; its RPC and table stay in place and manual approvals keep working.
--
-- Prerequisites (already applied in production): 20261122205331 (MG02 rules and Bling fiscal
-- rule), 20261123120000 (quote without routes), 20261123150000 (own grade stock).
-- 20261124010000 is NOT a prerequisite: everything needed from it (kit sheet fingerprints) is
-- redefined here with CREATE OR REPLACE, so applying both in order, or only this one, is safe.
--
-- What changes
--  1. private.ensure_representative_kit_mg02_rules(): appends the owner-approved MG02 no-credit
--     rule (CFOP 5102, CSOSN 102, series 3, nature 15111725693, return CFOP 1202 series 4, no
--     credit; same parameters seeded on 2026-11-22) for every current product and kit sheet
--     fingerprint that has none. Rules are never edited or deleted; a revoked rule is respected.
--  2. private.ensure_representative_kit_auto_eligibility(actor,address): for a representative in
--     approved_waiting_kit/active/unqualified (profile active) creates the missing buyer
--     approvals (marked granted_automatically) from data the system already holds:
--       name     = public.profiles.full_name
--       address  = the buyer's own MG row in public.addresses (the quoted address, else default)
--       document = NOT available: the CPF is encrypted by the application (cpf_ciphertext) and the
--                  database cannot decrypt it; the approval keeps document and state registration
--                  null (optional columns). Audit rows carry only counts, never personal data.
--     Existing approvals (manual or automatic) are never replaced; automatic rows only refresh the
--     name and fiscal address while no order exists for that rule.
--  3. quote_representative_kit_own_delivery calls it first and answers null for any account that
--     is not an active representative (suspended, cancelled and inactive never quote).
--  4. representative_kit_commercial_configuration accepts an automatic approval without CNPJ and
--     state registration; manual approvals keep the old requirement.
--  5. read_representative_kit_buyer_enabled() now means "eligible representative" and also
--     provisions the approvals, so the grade checkout works without a prior quote.
--
-- Fiscal impact / pending owner decisions (nothing here changes CFOP, CSOSN, series or nature):
--  * The MG02 rule is person_type business / taxpayer. A representative is an individual (CPF),
--    so the NF-e must still be issued MANUALLY in Bling (advancePixWithManualInvoice) and the
--    accountant should confirm how a CPF recipient without state registration is invoiced under
--    CFOP 5102 / CSOSN 102. This migration does not claim that approval.
--  * Pix: the provider call (createRepresentativeKitPix) and claim_representative_kit_pix still
--    require a 14-digit CNPJ, so an automatic buyer without one cannot pay by Pix until the owner
--    decides how to identify the payer (the CPF would have to be decrypted in the application).
--    Cash on receipt by address (manual rule) works without it.
--  * The automated Bling contact/XML checks (representative-commercial-fulfillment) also expect
--    CNPJ and state registration, so they keep refusing these orders; operate them manually.

alter table private.representative_kit_checkout_approvals
  add column if not exists granted_automatically boolean not null default false;

-- Kit sheet and product fingerprints that need an MG02 rule (same as 20261124010000).
create or replace function private.representative_kit_grade_mg02_fingerprints()
returns setof text language sql stable security definer set search_path = '' as $$
  select distinct f.fingerprint
  from public.kits k
  cross join (select distinct code from private.representative_kit_grade_templates()) t
  cross join lateral (select public.read_representative_kit_grade_fingerprint(k.id,t.code) as fingerprint) f
  where k.active and k.deleted_at is null and f.fingerprint is not null;
$$;
revoke all on function private.representative_kit_grade_mg02_fingerprints()
  from public,anon,authenticated,service_role;

create or replace function private.representative_kit_mg02_fingerprints()
returns setof text language sql stable security definer set search_path = '' as $$
  select public.read_representative_resale_product_fingerprint(v.id)
  from public.product_variants v join public.products product on product.id=v.product_id
  where v.active and product.status='active'
    and public.read_representative_resale_product_fingerprint(v.id) is not null
  union
  select g.fingerprint from private.representative_kit_grade_mg02_fingerprints() g(fingerprint);
$$;
revoke all on function private.representative_kit_mg02_fingerprints()
  from public,anon,authenticated,service_role;

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
      where old.issuer_reference='68267385000191' and old.product_fingerprint=f.fingerprint
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

-- Same function as 20261120000432, except that an automatic approval needs only the buyer name.
create or replace function private.representative_kit_commercial_configuration(p_actor uuid, p_rule uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1 from private.representative_kit_checkout_approvals a
    join private.representative_resale_fiscal_rule_versions r on r.id = a.rule_version_id
    cross join lateral (select r.fiscal_parameters as config, r.fiscal_parameters -> 'blingRule' as bling) as fiscal
    where a.actor_id = p_actor and a.rule_version_id = p_rule and a.revoked_at is null
      and a.valid_until > statement_timestamp()
      and a.buyer_legal_name is not null
      and (a.granted_automatically or (a.buyer_document is not null and a.buyer_state_registration is not null))
      and config ->> 'issuerDocument' ~ '^[0-9]{14}$'
      and config ->> 'classification' = 'third_party_no_st'
      and jsonb_typeof(config -> 'creditEligible') = 'boolean'
      and bling ->> 'issuer_state' = 'MG' and bling ->> 'series' = '3' and bling ->> 'document_model' = '55'
      and bling ->> 'cfop' = '5102' and bling ->> 'icms_rate' ~ '^0([.]0+)?$'
      and bling ->> 'pis_cst' = '49' and bling ->> 'cofins_cst' = '49'
      and bling ->> 'ipi_cst' = '99' and bling ->> 'ipi_cenq' = '999'
      and bling ->> 'pis_rate' ~ '^0([.]0+)?$' and bling ->> 'cofins_rate' ~ '^0([.]0+)?$'
      and bling ->> 'ipi_rate' ~ '^0([.]0+)?$'
      and exists (
        select 1 from jsonb_each(case when jsonb_typeof(config -> 'returnRules')='object'
          then config -> 'returnRules' else '{}'::jsonb end) as returns(route,rule)
        where ((route='buyer_outflow' and rule ->> 'cfop' = '5202')
            or (route='own_inflow' and rule ->> 'cfop' = '1202'))
          and ((rule ->> 'taxCodeKind'='CST' and rule ->> 'taxCode' ~ '^[0-9]{2}$')
            or (rule ->> 'taxCodeKind'='CSOSN' and rule ->> 'taxCode' ~ '^[0-9]{3}$'))
          and length(btrim(rule ->> 'homologationEvidence')) >= 10
      )
      and 1 = (select count(*) from jsonb_array_elements(
        case when jsonb_typeof(bling -> 'natures') = 'array' then bling -> 'natures' else '[]'::jsonb end
      ) nature where nature -> 'final_consumer' = 'false'::jsonb and nature ->> 'external_nature_id' ~ '^[1-9][0-9]{0,15}$')
      and (
        (config -> 'creditEligible' = 'false'::jsonb and bling ->> 'csosn' = '102'
          and bling ->> 'scenario' = 'resale_in_state_no_credit')
        or (a.buyer_profile = 'MG01' and config -> 'creditEligible' = 'true'::jsonb
          and config ->> 'creditBase' in ('merchandise','merchandise_with_shipping')
          and bling ->> 'csosn' = '101' and bling ->> 'scenario' = 'resale_in_state_credit'
          and 1 = (
            select count(*) from jsonb_array_elements(
              case when jsonb_typeof(bling -> 'credit_periods') = 'array' then bling -> 'credit_periods' else '[]'::jsonb end
            ) credit
            where credit ->> 'application_month' = to_char(statement_timestamp() at time zone 'America/Sao_Paulo','YYYY-MM-01')
              and credit ->> 'reference_month' = to_char((statement_timestamp() at time zone 'America/Sao_Paulo') - interval '1 month','YYYY-MM-01')
              and credit ->> 'rate' ~ '^([1-9][0-9]?|0)([.][0-9]{1,4})?$'
              and credit ->> 'rate' !~ '^0([.]0+)?$' and length(credit ->> 'evidence_reference') >= 10
              and credit ->> 'revision' ~ '^[1-9][0-9]{0,7}$'
              and credit ->> 'approved_by' ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
              and credit ->> 'approved_at' is not null
          ))
      )
  );
$$;

create or replace function private.ensure_representative_kit_auto_eligibility(p_actor uuid,p_address uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_name text; addr public.addresses; fiscal jsonb; created integer := 0;
begin
  if p_actor is null then return false; end if;
  select p.full_name into v_name from public.profiles p
    join public.representatives r on r.user_id=p.id
    where p.id=p_actor and p.status::text='active'
      and r.status::text in ('approved_waiting_kit','active','unqualified');
  if not found then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('representative_kit_mg02:'||p_actor::text,0));
  perform private.ensure_representative_kit_mg02_rules();

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
      '2099-12-31 00:00:00+00',btrim(v_name),null,null,fiscal,true
    from single_rule s
    on conflict(actor_id,rule_version_id) do nothing
    returning 1
  )
  select count(*) into created from inserted;

  -- Keep the automatic rows current until an order depends on them.
  if fiscal is not null then
    update private.representative_kit_checkout_approvals a
      set buyer_fiscal_address=fiscal,buyer_legal_name=btrim(v_name)
      where a.actor_id=p_actor and a.granted_automatically and a.revoked_at is null
        and (a.buyer_fiscal_address is distinct from fiscal or a.buyer_legal_name is distinct from btrim(v_name))
        and not exists (select 1 from private.representative_kit_orders o
          where o.actor_id=p_actor and o.rule_version_id=a.rule_version_id);
  end if;

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

-- Same function as 20261123120000, with the automatic eligibility step added after the address checks.
create or replace function public.quote_representative_kit_own_delivery(
  p_actor uuid,p_selection uuid,p_template text,p_quantity integer,p_address uuid,p_origin text,p_at_receipt boolean
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  route private.representative_kit_collection_routes;
  service_id text;
  cash_method bigint;
  cash_rule uuid;
  receipt_by_address boolean := false;
  address_row public.addresses;
  postal text;
  grade_shipping jsonb;
  inserted jsonb;
  price bigint;
  dimensions jsonb;
  expiry timestamptz := clock_timestamp()+interval '15 minutes';
begin
  if p_at_receipt is null or p_quantity is null or p_quantity not between 1 and 99 then return null; end if;
  select * into address_row from public.addresses a where a.user_id=p_actor
    and a.id=p_address and a.state='MG' and a.country='BR' for share;
  if not found then return null; end if;
  postal:=regexp_replace(address_row.postal_code,'[^0-9]','','g');
  if postal is null or postal !~ '^3[0-9]{7}$' then return null; end if;
  if not private.ensure_representative_kit_auto_eligibility(p_actor,address_row.id) then return null; end if;
  if p_origin is null then
    select min(a.origin_postal_code) into p_origin
      from private.representative_kit_checkout_approvals a
      where a.actor_id=p_actor and a.revoked_at is null and a.valid_until>expiry
      having count(distinct a.origin_postal_code)=1;
  end if;
  if p_at_receipt and p_origin is not null then
    cash_rule := case when p_template is null
      then private.find_representative_kit_checkout_approval(p_actor,p_selection,p_origin)
      else private.find_representative_kit_approval_by_fingerprint(
        p_actor,public.read_representative_kit_grade_fingerprint(p_selection,p_template),p_origin)
    end;
    cash_method := private.representative_kit_direct_cash_method(p_actor,p_origin,cash_rule);
  end if;
  if p_at_receipt and cash_method is null then
    select q.* into route from private.representative_kit_collection_routes q
      where (p_origin is null or q.origin_postal_code=p_origin) and postal between q.destination_from and q.destination_through
        and q.valid_until>expiry and q.closed_at is null
        and 1=(select count(*) from private.representative_kit_collection_routes t
          where (p_origin is null or t.origin_postal_code=p_origin) and postal between t.destination_from and t.destination_through
            and t.valid_until>expiry and t.closed_at is null)
      for share;
    if found and route.bling_method_ids<>'{}'::jsonb then
      p_origin := route.origin_postal_code;
      service_id := 'recebimento';
    elsif cash_rule is not null and private.representative_kit_manual_rule(p_actor,cash_rule) then
      -- No registered route: the buyer's verified MG address is enough for cash on receipt.
      route := null;
      receipt_by_address := true;
      service_id := 'entrega_propria_endereco';
      route.name := 'Entrega própria';
      route.delivery_cents := 0;
    else
      return null;
    end if;
  else
    if p_origin is null then return null; end if;
    service_id := 'entrega_propria_endereco';
    route.name := 'Entrega própria';
    route.delivery_cents := 0;
  end if;
  if p_template is null then
    if not public.representative_kit_purchase_available(p_actor,p_selection,p_origin) then return null; end if;
    select inputs.price_cents,inputs.dimensions into price,dimensions
      from private.representative_kit_shipping_inputs(p_selection) inputs
      join private.bling_catalog_metadata m on m.product_id=(select product_id from public.product_variants where id=p_selection)
      join public.inventory i on i.variant_id=p_selection
      where m.pairs_per_sku>1 and i.available_quantity>=p_quantity;
    if not found or price<=0 then return null; end if;
    inserted:=public.confirm_representative_kit_shipping_quote(
      p_actor,p_selection,p_quantity,p_address,postal,repeat('0',64),service_id,route.name,route.name,
      route.delivery_cents,route.delivery_cents,route.estimated_days,'[]'::jsonb,expiry,p_origin,price,dimensions);
  else
    grade_shipping:=public.read_representative_kit_grade_shipping(p_actor,p_selection,p_template,p_quantity,p_address,p_origin);
    if grade_shipping -> 'purchaseAvailable' is distinct from 'true'::jsonb then return null; end if;
    price:=(grade_shipping ->> 'priceCents')::bigint;
    inserted:=public.confirm_representative_kit_grade_shipping(
      p_actor,p_selection,p_template,p_quantity,p_address,p_origin,grade_shipping ->> 'catalogHash',
      address_row.updated_at,repeat('0',64),service_id,route.name,route.name,route.delivery_cents,
      route.delivery_cents,route.estimated_days,'[]'::jsonb,expiry);
  end if;
  if inserted ->> 'id' is null then return null; end if;
  update private.representative_kit_shipping_checkout_quotes set address_only_delivery=route.id is null,
    address_cash_bling_method=cash_method,own_delivery_route_id=route.id,address_at_receipt=receipt_by_address,
    collection_route_id=case when p_at_receipt then route.id end
    where id=(inserted ->> 'id')::uuid;
  return jsonb_build_object('id',inserted -> 'id','shippingInCents',route.delivery_cents,
    'amountInCents',price*p_quantity+route.delivery_cents,'estimatedDays',route.estimated_days,'service',route.name,
    'collectionMethods',case when cash_method is not null or receipt_by_address then '["cash"]'::jsonb
      else (select coalesce(jsonb_agg(m.name order by m.name),'[]'::jsonb)
      from jsonb_object_keys(route.bling_method_ids) m(name) where p_at_receipt) end);
end;
$$;

revoke all on function public.quote_representative_kit_own_delivery(uuid,uuid,text,integer,uuid,text,boolean)
  from public,anon,authenticated;
grant execute on function public.quote_representative_kit_own_delivery(uuid,uuid,text,integer,uuid,text,boolean)
  to service_role;

-- The portal asks this before offering the checkout. It now means "this account is an active
-- representative" and provisions the approvals for the caller only (auth.uid()).
create or replace function public.read_representative_kit_buyer_enabled()
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return false; end if;
  return private.ensure_representative_kit_auto_eligibility(auth.uid(),null);
end;
$$;
revoke all on function public.read_representative_kit_buyer_enabled() from public,anon;
grant execute on function public.read_representative_kit_buyer_enabled() to authenticated;

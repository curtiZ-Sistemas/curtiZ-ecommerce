-- Do not silently classify every CNPJ as MG02. Only the approved Simples scenario may reserve stock.
CREATE OR REPLACE FUNCTION public.create_wholesale_kit_invoice(p_key uuid, p_kit uuid, p_template text, p_quantity integer, p_unit_price_cents integer, p_payment_method text, p_buyer jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_document text; v_name text; v_registration text; v_address jsonb; v_buyer jsonb;
  v_kit public.kits; v_snapshot jsonb; v_rule private.representative_resale_fiscal_rule_versions;
  v_row private.wholesale_kit_invoices;
begin
  perform private.require_wholesale_invoice_access();
  if p_key is null or p_kit is null or p_template is null or p_template not in ('standard', 'lower_restock', 'upper_restock')
    or p_quantity is null or p_quantity not between 1 and 99
    or p_unit_price_cents is null or p_unit_price_cents not between 12 and 100000000
    or p_payment_method is null or p_payment_method not in ('pix', 'cash')
    or jsonb_typeof(p_buyer) is distinct from 'object' or jsonb_typeof(p_buyer -> 'address') is distinct from 'object' then
    raise exception 'invalid_wholesale_invoice' using errcode = '22023';
  end if;
  if p_buyer->>'regime' is distinct from 'simples' then
    raise exception 'wholesale_buyer_regime_not_approved' using errcode='23514';
  end if;
  v_document := coalesce(p_buyer ->> 'document', '');
  v_name := btrim(coalesce(p_buyer ->> 'name', ''));
  v_registration := btrim(coalesce(p_buyer ->> 'registration', ''));
  v_address := p_buyer -> 'address';
  if not private.is_valid_cnpj(v_document) then
    raise exception 'wholesale_buyer_cnpj_invalid' using errcode = '22023';
  end if;
  if coalesce(v_address ->> 'state', '') <> 'MG' or coalesce(v_address ->> 'postal_code', '') !~ '^3[0-9]{7}$' then
    raise exception 'wholesale_buyer_outside_mg' using errcode = '23514';
  end if;
  if length(v_name) not between 2 and 180 or (v_registration !~ '^[0-9]{13}$')
    or length(btrim(coalesce(v_address ->> 'street', ''))) not between 1 and 180
    or length(btrim(coalesce(v_address ->> 'number', ''))) not between 1 and 30
    or length(btrim(coalesce(v_address ->> 'district', ''))) not between 1 and 100
    or length(btrim(coalesce(v_address ->> 'city', ''))) not between 1 and 100
    or length(btrim(coalesce(v_address ->> 'complement', ''))) > 100 then
    raise exception 'invalid_wholesale_invoice' using errcode = '22023';
  end if;
  v_buyer := jsonb_build_object('document', v_document, 'name', v_name, 'registration', v_registration, 'regime', 'simples',
    'address', jsonb_build_object('state', 'MG', 'postal_code', v_address ->> 'postal_code',
      'street', btrim(v_address ->> 'street'), 'number', btrim(v_address ->> 'number'),
      'district', btrim(v_address ->> 'district'), 'city', btrim(v_address ->> 'city'),
      'complement', btrim(coalesce(v_address ->> 'complement', ''))));

  perform pg_advisory_xact_lock(hashtextextended('wholesale-kit-invoice:' || p_key::text, 0));
  select * into v_row from private.wholesale_kit_invoices where idempotency_key = p_key;
  if found then
    if (v_row.kit_id, v_row.template, v_row.quantity, v_row.unit_price_cents, v_row.payment_method, v_row.created_by,
        v_row.buyer_snapshot ->> 'document')
      is distinct from (p_kit, p_template, p_quantity, p_unit_price_cents, p_payment_method, auth.uid(), v_document) then
      raise exception 'wholesale_idempotency_conflict' using errcode = '23505';
    end if;
    return private.wholesale_kit_invoice_summary(v_row);
  end if;

  -- The kit row is the stock ledger: locking it serializes competing sales.
  select * into v_kit from public.kits k where k.id = p_kit and k.active and k.deleted_at is null for update;
  if not found or v_kit.grade_product_id is null
    or num_nonnulls(v_kit.grade_standard_price_cents, v_kit.grade_lower_restock_price_cents, v_kit.grade_upper_restock_price_cents) <> 3 then
    raise exception 'wholesale_kit_unavailable' using errcode = '23514';
  end if;
  if coalesce(private.representative_kit_grade_stock(v_kit, p_template), 0) < p_quantity then
    raise exception 'kit_grade_out_of_stock' using errcode = '23514';
  end if;
  v_snapshot := private.representative_kit_grade_snapshot(p_kit, p_template);
  if v_snapshot is null then raise exception 'wholesale_kit_unavailable' using errcode = '23514'; end if;

  -- Same owner-approved MG02 no-credit rule (CFOP 5102, CSOSN 102, series 3) the representatives' kits use.
  perform private.ensure_representative_kit_grade_mg02_rules();
  select rule.* into v_rule from private.representative_resale_fiscal_rule_versions rule
    join private.representative_resale_fiscal_rule_approvals evidence on evidence.rule_version_id = rule.id
    left join private.representative_resale_fiscal_rule_revocations revoked on revoked.rule_version_id = rule.id
    where rule.product_fingerprint = v_snapshot ->> 'fiscalFingerprint'
      and rule.origin_state = 'MG' and rule.destination_state = 'MG' and rule.person_type = 'business'
      and rule.icms_status = 'taxpayer' and not rule.final_consumer and rule.purpose = 'resale'
      and rule.valid_from <= statement_timestamp() and statement_timestamp() < rule.valid_until
      and revoked.rule_version_id is null
      and rule.fiscal_parameters ->> 'buyerProfile' = 'MG02'
      and rule.fiscal_parameters -> 'creditEligible' = 'false'::jsonb
      and rule.fiscal_parameters ->> 'issuerDocument' ~ '^[0-9]{14}$'
      and rule.fiscal_parameters #>> '{blingRule,scenario}' = 'resale_in_state_no_credit'
      and rule.fiscal_parameters #>> '{blingRule,series}' = '3'
      and rule.fiscal_parameters #>> '{blingRule,cfop}' = '5102'
      and rule.fiscal_parameters #>> '{blingRule,csosn}' = '102'
    order by rule.created_at, rule.id limit 1;
  if not found then raise exception 'resale_not_homologated' using errcode = '23514'; end if;

  update public.kits k set
    grade_standard_stock = k.grade_standard_stock - case when p_template = 'standard' then p_quantity else 0 end,
    grade_lower_restock_stock = k.grade_lower_restock_stock - case when p_template = 'lower_restock' then p_quantity else 0 end,
    grade_upper_restock_stock = k.grade_upper_restock_stock - case when p_template = 'upper_restock' then p_quantity else 0 end
    where k.id = p_kit and private.representative_kit_grade_stock(k, p_template) >= p_quantity;
  if not found then raise exception 'kit_grade_out_of_stock' using errcode = '23514'; end if;

  insert into private.wholesale_kit_invoices(
    idempotency_key, kit_id, template, quantity, unit_price_cents, total_cents, payment_method,
    buyer_snapshot, grade_snapshot, fiscal_fingerprint, rule_version_id, created_by
  ) values (
    p_key, p_kit, p_template, p_quantity, p_unit_price_cents, p_unit_price_cents::bigint * p_quantity, p_payment_method,
    v_buyer, v_snapshot, v_snapshot ->> 'fiscalFingerprint', v_rule.id, auth.uid()
  ) returning * into v_row;

  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, new_data_sanitized)
    values (auth.uid(), private.current_app_role(), 'fiscal.wholesale_invoice.created', 'wholesale_kit_invoice', v_row.id,
      jsonb_build_object('template', p_template, 'quantity', p_quantity, 'totalInCents', v_row.total_cents,
        'paymentMethod', p_payment_method));
  return private.wholesale_kit_invoice_summary(v_row);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.create_wholesale_kit_invoice_batch(p_key uuid, p_items jsonb, p_payment_method text, p_buyer jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_document text; v_name text; v_registration text; v_address jsonb; v_buyer jsonb;
  v_kit public.kits; v_snapshot jsonb; v_rule private.representative_resale_fiscal_rule_versions;
  v_row private.wholesale_kit_invoices;
  p_kit uuid; p_template text; p_quantity integer; p_unit_price_cents integer;
  v_item record; v_first record; v_first_snapshot jsonb; v_first_rule uuid; v_parameters jsonb;
  v_request jsonb; v_selections jsonb := '[]'::jsonb; v_lines jsonb := '[]'::jsonb; v_total bigint := 0;
  v_names text[] := array[]::text[];
begin
  perform private.require_wholesale_invoice_access();
  if p_key is null or p_payment_method is null or p_payment_method not in ('pix','cash')
    or jsonb_typeof(p_buyer) is distinct from 'object' or jsonb_typeof(p_buyer->'address') is distinct from 'object'
    or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'invalid_wholesale_invoice' using errcode='22023';
  end if;
  if jsonb_array_length(p_items) not between 1 and 20 then
    raise exception 'invalid_wholesale_invoice' using errcode='22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) x
    where jsonb_typeof(x) is distinct from 'object'
      or coalesce(x->>'kitId','') !~ '^[0-9a-fA-F-]{36}$'
      or coalesce(x->>'template','') not in ('standard','lower_restock','upper_restock')
      or coalesce(x->>'quantity','') !~ '^[0-9]{1,2}$'
      or coalesce(x->>'unitPriceInCents','') !~ '^[0-9]{1,9}$') then
    raise exception 'invalid_wholesale_invoice' using errcode='22023';
  end if;
  select jsonb_agg(jsonb_build_object('kitId',x."kitId",'template',x.template,'quantity',x.quantity,
      'unitPriceInCents',x."unitPriceInCents") order by x."kitId")
    into v_request from jsonb_to_recordset(p_items) x("kitId" uuid,template text,quantity integer,"unitPriceInCents" integer);
  if (select count(distinct x->>'kitId') from jsonb_array_elements(v_request) x) <> jsonb_array_length(v_request)
    or exists (select 1 from jsonb_array_elements(v_request) x where (x->>'quantity')::integer not between 1 and 99
      or (x->>'unitPriceInCents')::integer not between 12 and 100000000) then
    raise exception 'invalid_wholesale_invoice' using errcode='22023';
  end if;
  if p_buyer->>'regime' is distinct from 'simples' then
    raise exception 'wholesale_buyer_regime_not_approved' using errcode='23514';
  end if;
  v_document := coalesce(p_buyer ->> 'document', '');
  v_name := btrim(coalesce(p_buyer ->> 'name', ''));
  v_registration := btrim(coalesce(p_buyer ->> 'registration', ''));
  v_address := p_buyer -> 'address';
  if not private.is_valid_cnpj(v_document) then
    raise exception 'wholesale_buyer_cnpj_invalid' using errcode = '22023';
  end if;
  if coalesce(v_address ->> 'state', '') <> 'MG' or coalesce(v_address ->> 'postal_code', '') !~ '^3[0-9]{7}$' then
    raise exception 'wholesale_buyer_outside_mg' using errcode = '23514';
  end if;
  if length(v_name) not between 2 and 180 or (v_registration !~ '^[0-9]{13}$')
    or length(btrim(coalesce(v_address ->> 'street', ''))) not between 1 and 180
    or length(btrim(coalesce(v_address ->> 'number', ''))) not between 1 and 30
    or length(btrim(coalesce(v_address ->> 'district', ''))) not between 1 and 100
    or length(btrim(coalesce(v_address ->> 'city', ''))) not between 1 and 100
    or length(btrim(coalesce(v_address ->> 'complement', ''))) > 100 then
    raise exception 'invalid_wholesale_invoice' using errcode = '22023';
  end if;
  v_buyer := jsonb_build_object('document', v_document, 'name', v_name, 'registration', v_registration, 'regime', 'simples',
    'address', jsonb_build_object('state', 'MG', 'postal_code', v_address ->> 'postal_code',
      'street', btrim(v_address ->> 'street'), 'number', btrim(v_address ->> 'number'),
      'district', btrim(v_address ->> 'district'), 'city', btrim(v_address ->> 'city'),
      'complement', btrim(coalesce(v_address ->> 'complement', ''))));

  perform pg_advisory_xact_lock(hashtextextended('wholesale-kit-invoice:' || p_key::text, 0));
  select * into v_row from private.wholesale_kit_invoices where idempotency_key=p_key;
  if found then
    if (v_row.grade_snapshot->'request',v_row.payment_method,v_row.created_by,v_row.buyer_snapshot)
      is distinct from (v_request,p_payment_method,auth.uid(),v_buyer) then
      raise exception 'wholesale_idempotency_conflict' using errcode='23505';
    end if;
    return private.wholesale_kit_invoice_summary(v_row);
  end if;
  -- Lock in canonical order to prevent deadlocks. Any failed item rolls back every reservation.
  for v_item in select * from jsonb_to_recordset(v_request) x("kitId" uuid,template text,quantity integer,"unitPriceInCents" integer)
      order by x."kitId" loop
    p_kit := v_item."kitId"; p_template := v_item.template; p_quantity := v_item.quantity; p_unit_price_cents := v_item."unitPriceInCents";
  -- The kit row is the stock ledger: locking it serializes competing sales.
  select * into v_kit from public.kits k where k.id = p_kit and k.active and k.deleted_at is null for update;
  if not found or v_kit.grade_product_id is null
    or num_nonnulls(v_kit.grade_standard_price_cents, v_kit.grade_lower_restock_price_cents, v_kit.grade_upper_restock_price_cents) <> 3 then
    raise exception 'wholesale_kit_unavailable' using errcode = '23514';
  end if;
  if coalesce(private.representative_kit_grade_stock(v_kit, p_template), 0) < p_quantity then
    raise exception 'kit_grade_out_of_stock' using errcode = '23514';
  end if;
  v_snapshot := private.representative_kit_grade_snapshot(p_kit, p_template);
  if v_snapshot is null then raise exception 'wholesale_kit_unavailable' using errcode = '23514'; end if;

  -- Same owner-approved MG02 no-credit rule (CFOP 5102, CSOSN 102, series 3) the representatives' kits use.
  perform private.ensure_representative_kit_grade_mg02_rules();
  select rule.* into v_rule from private.representative_resale_fiscal_rule_versions rule
    join private.representative_resale_fiscal_rule_approvals evidence on evidence.rule_version_id = rule.id
    left join private.representative_resale_fiscal_rule_revocations revoked on revoked.rule_version_id = rule.id
    where rule.product_fingerprint = v_snapshot ->> 'fiscalFingerprint'
      and rule.origin_state = 'MG' and rule.destination_state = 'MG' and rule.person_type = 'business'
      and rule.icms_status = 'taxpayer' and not rule.final_consumer and rule.purpose = 'resale'
      and rule.valid_from <= statement_timestamp() and statement_timestamp() < rule.valid_until
      and revoked.rule_version_id is null
      and rule.fiscal_parameters ->> 'buyerProfile' = 'MG02'
      and rule.fiscal_parameters -> 'creditEligible' = 'false'::jsonb
      and rule.fiscal_parameters ->> 'issuerDocument' ~ '^[0-9]{14}$'
      and rule.fiscal_parameters #>> '{blingRule,scenario}' = 'resale_in_state_no_credit'
      and rule.fiscal_parameters #>> '{blingRule,series}' = '3'
      and rule.fiscal_parameters #>> '{blingRule,cfop}' = '5102'
      and rule.fiscal_parameters #>> '{blingRule,csosn}' = '102'
    order by rule.created_at, rule.id limit 1;
  if not found then raise exception 'resale_not_homologated' using errcode = '23514'; end if;

  update public.kits k set
    grade_standard_stock = k.grade_standard_stock - case when p_template = 'standard' then p_quantity else 0 end,
    grade_lower_restock_stock = k.grade_lower_restock_stock - case when p_template = 'lower_restock' then p_quantity else 0 end,
    grade_upper_restock_stock = k.grade_upper_restock_stock - case when p_template = 'upper_restock' then p_quantity else 0 end
    where k.id = p_kit and private.representative_kit_grade_stock(k, p_template) >= p_quantity;
  if not found then raise exception 'kit_grade_out_of_stock' using errcode = '23514'; end if;


    if v_first_rule is null then
      v_first := v_item; v_first_rule := v_rule.id; v_first_snapshot := v_snapshot; v_parameters := v_rule.fiscal_parameters;
    elsif v_rule.fiscal_parameters is distinct from v_parameters then
      raise exception 'resale_not_homologated' using errcode='23514';
    end if;
    v_total := v_total + p_unit_price_cents::bigint * p_quantity;
    v_names := array_append(v_names,v_snapshot->>'kitName');
    v_lines := v_lines || (v_snapshot->'lines');
    v_selections := v_selections || jsonb_build_array(jsonb_build_object('kitId',p_kit,'template',p_template,
      'quantity',p_quantity,'unitPriceInCents',p_unit_price_cents,'gradeLines',v_snapshot->'lines','ruleVersionId',v_rule.id,
      'kitName',v_snapshot->>'kitName'));
  end loop;
  insert into private.wholesale_kit_invoices(idempotency_key,kit_id,template,quantity,unit_price_cents,total_cents,payment_method,
    buyer_snapshot,grade_snapshot,fiscal_fingerprint,rule_version_id,created_by)
  values(p_key,v_first."kitId",v_first.template,v_first.quantity,v_first."unitPriceInCents",v_total,p_payment_method,
    v_buyer,jsonb_build_object('kitName',array_to_string(v_names,' · '),'lines',v_lines,'selections',v_selections,'request',v_request),
    v_first_snapshot->>'fiscalFingerprint',v_first_rule,auth.uid()) returning * into v_row;
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
  values(auth.uid(),private.current_app_role(),'fiscal.wholesale_invoice.created','wholesale_kit_invoice',v_row.id,
    jsonb_build_object('kitCount',jsonb_array_length(v_selections),'totalInCents',v_total,'paymentMethod',p_payment_method));
  return private.wholesale_kit_invoice_summary(v_row);
end;
$function$
;
notify pgrst,'reload schema';

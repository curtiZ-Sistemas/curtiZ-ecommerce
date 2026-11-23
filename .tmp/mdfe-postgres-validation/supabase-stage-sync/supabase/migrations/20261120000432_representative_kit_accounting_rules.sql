-- Fiscal parameters for the MG wholesale channel. Keep existing function grants.
create or replace function private.representative_kit_commercial_configuration(p_actor uuid, p_rule uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1 from private.representative_kit_checkout_approvals a
    join private.representative_resale_fiscal_rule_versions r on r.id = a.rule_version_id
    cross join lateral (select r.fiscal_parameters as config, r.fiscal_parameters -> 'blingRule' as bling) as fiscal
    where a.actor_id = p_actor and a.rule_version_id = p_rule and a.revoked_at is null
      and a.valid_until > statement_timestamp()
      and a.buyer_document is not null and a.buyer_legal_name is not null and a.buyer_state_registration is not null
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

create or replace function public.manage_representative_kit_delivery_route(p_close uuid,p_route jsonb)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  route private.representative_kit_collection_routes;
begin
  perform private.require_permission('representatives.rules.manage');
  if p_close is not null then
    update private.representative_kit_collection_routes set closed_at=clock_timestamp()
      where id=p_close and closed_at is null returning * into route;
    if not found then return false; end if;
  else
    select * into route from jsonb_populate_record(null::private.representative_kit_collection_routes,p_route);
    if route.origin_postal_code is null or route.valid_until is null or route.valid_until <= clock_timestamp()
      or route.delivery_cents is distinct from 0 then return false; end if;
    perform pg_advisory_xact_lock(hashtextextended('kit_route:'||route.origin_postal_code,0));
    if exists (select 1 from private.representative_kit_collection_routes r
      where r.origin_postal_code=route.origin_postal_code and r.closed_at is null and r.valid_until>clock_timestamp()
        and route.destination_from<=r.destination_through and route.destination_through>=r.destination_from)
      then return false; end if;
    insert into private.representative_kit_collection_routes(name,origin_postal_code,destination_from,destination_through,
      delivery_cents,estimated_days,bling_method_ids,point_terminal_id,verified_evidence,valid_until)
    values(route.name,route.origin_postal_code,route.destination_from,route.destination_through,route.delivery_cents,
      route.estimated_days,route.bling_method_ids,route.point_terminal_id,route.verified_evidence,route.valid_until)
    returning id into route.id;
  end if;
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
    values(auth.uid(),private.current_app_role(),
      case when p_close is null then 'representative.kit.route.created' else 'representative.kit.route.closed' end,
      'representative_kit_delivery_route',route.id,jsonb_build_object('origin',route.origin_postal_code));
  return true;
end;
$$;

create or replace function public.manage_representative_kit_collection(p_order uuid,p_action text,p_evidence text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  o private.representative_kit_orders;
  f private.representative_kit_fulfillment;
begin
  if auth.uid() is null or not private.has_permission('orders.update_operational_status') then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  if length(btrim(coalesce(p_evidence,''))) not between 10 and 200 then return null; end if;
  select * into o from private.representative_kit_orders where id=p_order and (collection_route_id is not null or own_delivery_route_id is not null) for update;
  if not found or o.actor_id=auth.uid() then return null; end if;
  select * into f from private.representative_kit_fulfillment where order_id=p_order for update;
  if not found then return null; end if;
  if p_action='cash_received' and o.collection_method='cash' and (
    o.state='paid' or o.state='awaiting_receipt' and f.shipment_status in ('dispatched','delivered') and o.cancellation_requested_at is null
  ) then
    insert into private.representative_kit_collection_payments(order_id,opened_by) values(o.id,auth.uid()) on conflict do nothing;
    if not private.confirm_representative_kit_collection_receipt(o,btrim(p_evidence),auth.uid()) then return null; end if;
  elsif p_action='confirm_delivery' and f.shipment_status in ('dispatched','delivered')
    and o.state in ('awaiting_receipt','paid') and o.cancellation_requested_at is null
    and f.invoice_access_key is not null and f.invoice_cancellation_confirmed_at is null then
    if f.shipment_status='delivered' then return jsonb_build_object('ok',true); end if;
    update private.representative_kit_fulfillment set shipment_status='delivered',shipment_rank=7 where order_id=o.id;
  elsif p_action='dispatch' and o.state in ('awaiting_receipt','paid') and o.cancellation_requested_at is null
    and private.representative_kit_fiscal_ready(o) and (f.shipment_rank<4 or f.shipment_status='delayed' and o.collection_route_id is null) and f.invoice_access_key is not null
    and f.invoice_confirmed_at>clock_timestamp()-interval '30 minutes' then
    update private.representative_kit_fulfillment set shipment_status='dispatched',shipment_rank=4 where order_id=o.id;
  elsif p_action='cancel_before_dispatch' and o.state='awaiting_receipt' and o.cancellation_requested_at is null
    and f.shipment_rank<4 and f.bling_invoice_id is not null then
    update private.representative_kit_orders set cancellation_requested_at=clock_timestamp() where id=o.id;
    update private.representative_kit_fulfillment set shipment_status='delayed',shipment_rank=5,checked_at=null where order_id=o.id;
  elsif p_action='delivery_failed' and o.state='paid' and o.collection_route_id is null
    and f.shipment_status='dispatched' and o.cancellation_requested_at is null then
    update private.representative_kit_fulfillment set shipment_status='delayed',shipment_rank=5 where order_id=o.id;
  elsif p_action='delivery_failed' and o.state='awaiting_receipt' and f.shipment_status='dispatched'
    and not exists (select 1 from private.representative_kit_collection_payments p where p.order_id=o.id
      and (p.point_status is null or p.point_status not in ('failed','expired','canceled') or p.confirmed_at is not null)) then
    -- Circulated goods require a verified fiscal return before stock or finance can change.
    update private.representative_kit_fulfillment set shipment_status='delayed',shipment_rank=5,checked_at=null where order_id=o.id;
  elsif p_action='returned_unpaid' and o.state='awaiting_receipt' and o.cancellation_requested_at is not null
    and f.shipment_status='delayed' and f.invoice_cancellation_confirmed_at is not null
    and not exists (select 1 from private.representative_kit_collection_payments p where p.order_id=o.id
      and (p.point_status is null or p.point_status not in ('failed','expired','canceled') or p.confirmed_at is not null)) then
    perform private.transfer_representative_kit_inventory(o,o.quantity,'release',null,null,null,null);
    update private.representative_kit_orders set state='cancelled',stock_state='released' where id=o.id;
    update private.representative_kit_fulfillment set shipment_status='returned',shipment_rank=8 where order_id=o.id;
  else
    return null;
  end if;
  insert into public.audit_logs(actor_id,actor_role,action,entity_type,entity_id,new_data_sanitized)
    values(auth.uid(),private.current_app_role(),'representative.kit.collection.'||p_action,'representative_kit_order',o.id,
      jsonb_build_object('evidence',btrim(p_evidence)));
  return jsonb_build_object('ok',true);
end;
$$;

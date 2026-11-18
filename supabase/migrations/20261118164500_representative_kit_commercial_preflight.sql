-- Validate the supported fiscal configuration before allowing a Pix write.
-- A matching generic fiscal rule, without its buyer and Bling parameters,
-- cannot open the checkout.
create function private.representative_kit_commercial_configuration(p_actor uuid, p_rule uuid)
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
      and bling ->> 'issuer_state' = 'MG' and bling ->> 'series' = '2' and bling ->> 'document_model' = '55'
      and bling ->> 'cfop' = '5102' and bling ->> 'icms_rate' ~ '^0([.]0+)?$'
      and bling ->> 'pis_cst' = '49' and bling ->> 'cofins_cst' = '49'
      and bling ->> 'ipi_cst' = '99' and bling ->> 'ipi_cenq' = '999'
      and bling ->> 'pis_rate' ~ '^0([.]0+)?$' and bling ->> 'cofins_rate' ~ '^0([.]0+)?$'
      and bling ->> 'ipi_rate' ~ '^0([.]0+)?$'
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
revoke all on function private.representative_kit_commercial_configuration(uuid,uuid) from public, anon, authenticated, service_role;

create function private.guard_representative_kit_commercial_configuration()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (tg_op = 'INSERT' or (old.payment_started_at is null and new.payment_started_at is not null))
    and not private.representative_kit_commercial_configuration(new.actor_id,new.rule_version_id) then
    raise exception 'resale_configuration_required' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_representative_kit_commercial_configuration() from public, anon, authenticated, service_role;
create trigger representative_kit_commercial_configuration
  before insert or update of payment_started_at on private.representative_kit_orders
  for each row execute function private.guard_representative_kit_commercial_configuration();

create function public.representative_kit_purchase_available(p_actor uuid,p_variant uuid,p_origin text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.representative_kit_commercial_configuration(p_actor,
    private.find_representative_kit_checkout_approval(p_actor,p_variant,p_origin));
$$;
revoke all on function public.representative_kit_purchase_available(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.representative_kit_purchase_available(uuid,uuid,text) to service_role;

create function public.list_representative_kit_orders(p_actor uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(orders.summary),'[]'::jsonb) from (
    select private.representative_kit_order_summary(o) || jsonb_build_object('productName',o.product_name,
      'cancellationRequested',o.cancellation_requested_at is not null, 'paymentStarted',o.payment_started_at is not null)
      as summary from private.representative_kit_orders o
    where o.actor_id = p_actor order by o.created_at desc, o.id limit 25
  ) orders;
$$;
revoke all on function public.list_representative_kit_orders(uuid) from public, anon, authenticated;
grant execute on function public.list_representative_kit_orders(uuid) to service_role;

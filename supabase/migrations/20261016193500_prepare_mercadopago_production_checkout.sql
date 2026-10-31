-- Prepare a service-only production path without changing existing test RPCs,
-- orders, credentials, feature flags or provider state. Preserve the current
-- checkout locks, pricing, coupon, identity and shipping validation bodies.
begin;
do $migration$
declare
  item record;
  definition text;
  source_name text;
begin
  for item in select * from (values
    ('public.create_mercadopago_test_order(uuid,text,text,text,text,text,jsonb,jsonb,integer)',
      'public.create_mercadopago_test_order', 'private.create_mercadopago_production_order'),
    ('public.create_professional_checkout_order(uuid,text,text,text,text,text,jsonb,jsonb,text,integer)',
      'public.create_professional_checkout_order', 'private.create_professional_production_order'),
    ('public.confirm_professional_checkout_order(uuid,uuid,text,text,text,text,text,text,jsonb,jsonb,text,integer)',
      'public.confirm_professional_checkout_order', 'public.confirm_professional_production_checkout_order'),
    ('public.confirm_shipping_checkout_order(uuid,uuid,text,text,text,text,text,text,jsonb,jsonb,uuid,text,text,integer)',
      'public.confirm_shipping_checkout_order', 'public.confirm_shipping_production_checkout_order')
  ) as sources(signature, source, target) loop
    definition := pg_catalog.pg_get_functiondef(item.signature::pg_catalog.regprocedure);
    source_name := 'FUNCTION ' || item.source || '(';
    if pg_catalog.strpos(definition, source_name) = 0 then
      raise exception 'production checkout source changed: %', item.source;
    end if;
    definition := pg_catalog.replace(definition, source_name, 'FUNCTION ' || item.target || '(');
    definition := pg_catalog.replace(definition, 'public.create_mercadopago_test_order(', 'private.create_mercadopago_production_order(');
    definition := pg_catalog.replace(definition, 'public.create_professional_checkout_order(', 'private.create_professional_production_order(');
    definition := pg_catalog.replace(definition, 'public.confirm_professional_checkout_order(', 'public.confirm_professional_production_checkout_order(');
    definition := pg_catalog.replace(definition, 'mercadopago.checkout.test', 'mercadopago.checkout.production');
    definition := pg_catalog.replace(definition, '''paymentMode'', ''test''', '''paymentMode'', ''production''');
    if item.source = 'public.confirm_shipping_checkout_order' then
      if pg_catalog.strpos(definition, 'or selected.provider_environment is null') = 0 then
        raise exception 'production shipping validation changed';
      end if;
      definition := pg_catalog.replace(definition, 'or selected.provider_environment is null',
        'or selected.provider_environment is distinct from ''production''');
    end if;
    execute definition;
  end loop;

  definition := pg_catalog.pg_get_functiondef('private.apply_fixed_shipping_to_mercadopago_test_order()'::pg_catalog.regprocedure);
  if pg_catalog.strpos(definition, '->> ''paymentMode'' = ''test''') = 0 then
    raise exception 'fixed shipping validation changed';
  end if;
  execute pg_catalog.replace(definition, '->> ''paymentMode'' = ''test''', '->> ''paymentMode'' in (''test'', ''production'')');

  definition := pg_catalog.pg_get_functiondef('public.claim_mercadopago_card_save(uuid,uuid,uuid,uuid)'::pg_catalog.regprocedure);
  source_name := 'perform 1 from public.orders where id = p_order_id and customer_id = p_user_id and payment_status = ''approved'';';
  if pg_catalog.strpos(definition, source_name) = 0 then raise exception 'card eligibility validation changed'; end if;
  execute pg_catalog.replace(definition, source_name,
    'perform 1 from public.orders sale where sale.id = p_order_id and sale.customer_id = p_user_id and sale.payment_status = ''approved''
      and exists(select 1 from public.payment_provider_customers customer where customer.id = p_customer_id
        and customer.payment_mode = sale.commercial_rules_snapshot->>''paymentMode'');');
end;
$migration$;

revoke all on function private.create_mercadopago_production_order(uuid,text,text,text,text,text,jsonb,jsonb,integer)
  from public, anon, authenticated, service_role;
revoke all on function private.create_professional_production_order(uuid,text,text,text,text,text,jsonb,jsonb,text,integer)
  from public, anon, authenticated, service_role;
revoke all on function public.confirm_professional_production_checkout_order(uuid,uuid,text,text,text,text,text,text,jsonb,jsonb,text,integer)
  from public, anon, authenticated;
grant execute on function public.confirm_professional_production_checkout_order(uuid,uuid,text,text,text,text,text,text,jsonb,jsonb,text,integer)
  to service_role;
revoke all on function public.confirm_shipping_production_checkout_order(uuid,uuid,text,text,text,text,text,text,jsonb,jsonb,uuid,text,text,integer)
  from public, anon, authenticated;
grant execute on function public.confirm_shipping_production_checkout_order(uuid,uuid,text,text,text,text,text,text,jsonb,jsonb,uuid,text,text,integer)
  to service_role;

create function public.check_mercadopago_order_mode(
  p_mode text, p_order_id uuid default null, p_external_reference text default null, p_customer_id uuid default null
) returns boolean language sql stable security definer set search_path = '' as $$
  select p_mode in ('test', 'production')
    and (p_order_id is not null or nullif(p_external_reference, '') is not null)
    and exists(select 1 from public.orders sale
      where (p_order_id is null or sale.id = p_order_id)
        and (p_external_reference is null or sale.public_code = p_external_reference)
        and (p_customer_id is null or sale.customer_id = p_customer_id)
        and sale.commercial_rules_snapshot->>'paymentProvider' = 'mercadopago'
        and sale.commercial_rules_snapshot->>'paymentMode' = p_mode);
$$;
revoke all on function public.check_mercadopago_order_mode(text,uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.check_mercadopago_order_mode(text,uuid,text,uuid) to service_role;
commit;
notify pgrst, 'reload schema';

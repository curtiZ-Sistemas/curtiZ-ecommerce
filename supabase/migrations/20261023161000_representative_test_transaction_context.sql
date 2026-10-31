-- Preserve the applied transaction migration; strengthen composition at its public boundary.
alter function public.create_kit_test_transaction(uuid,uuid,integer,uuid,text,uuid) set schema private;
revoke all on function private.create_kit_test_transaction(uuid,uuid,integer,uuid,text,uuid) from public,anon,authenticated,service_role;

create function public.create_kit_test_transaction(p_actor uuid,p_variant uuid,p_quantity integer,p_quote uuid,p_fingerprint text,p_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; composition jsonb; pairs integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text||p_key::text,0));
  if exists(select 1 from private.kit_test_transactions where actor_id=p_actor and idempotency_key=p_key) then
    return private.create_kit_test_transaction(p_actor,p_variant,p_quantity,p_quote,p_fingerprint,p_key);
  end if;
  select m.pairs_per_sku into pairs from private.bling_catalog_metadata m join public.product_variants v on v.product_id=m.product_id where v.id=p_variant;
  select jsonb_agg(jsonb_build_object('sku',c.sku,'description',c.description,'unit',c.unit,
    'quantityPairs',c.quantity_pairs,'allocationWeight',c.allocation_weight,'ncm',c.ncm,'origin',c.origin,'cest',c.cest) order by c.position)
    into composition from private.bling_kit_fiscal_components c where c.kit_variant_id=p_variant;
  if composition is null or pairs is null or pairs<>(select sum(quantity_pairs) from private.bling_kit_fiscal_components where kit_variant_id=p_variant)
    or exists(select 1 from private.bling_kit_fiscal_components where kit_variant_id=p_variant and source_hash is distinct from private.bling_kit_source_hash(p_variant)) then
    raise exception 'kit_composition_required';
  end if;
  result:=private.create_kit_test_transaction(p_actor,p_variant,p_quantity,p_quote,p_fingerprint,p_key);
  update public.kit_orders set kit_snapshot=kit_snapshot||jsonb_build_object('fiscalComponents',composition,'fiscalValidation','pending')
    where id=(result->>'orderId')::uuid;
  return result;
end;
$$;
revoke all on function public.create_kit_test_transaction(uuid,uuid,integer,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.create_kit_test_transaction(uuid,uuid,integer,uuid,text,uuid) to service_role;

create function public.read_kit_test_transaction(p_actor uuid,p_order uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('orderId',t.order_id,'actorId',t.actor_id,'mode','test','state',t.state,
    'reference','KITTEST-'||t.order_id::text,'variantId',t.variant_id,'quantity',t.quantity,
    'amountInCents',t.unit_price_cents*t.quantity+t.shipping_cents,'currency','BRL',
    'providerPaymentId',t.provider_payment_id,'paymentFingerprint',t.payment_fingerprint,
    'refundedInCents',t.refunded_cents,'remainingInCents',t.unit_price_cents*t.quantity+t.shipping_cents-t.refunded_cents,
    'fiscalValidation','pending','shippingAllowed',false)
  from private.kit_test_transactions t where t.order_id=p_order and t.actor_id=p_actor;
$$;
revoke all on function public.read_kit_test_transaction(uuid,uuid) from public,anon,authenticated;
grant execute on function public.read_kit_test_transaction(uuid,uuid) to service_role;

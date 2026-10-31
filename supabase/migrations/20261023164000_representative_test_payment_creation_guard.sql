create function public.claim_kit_test_creation(p_actor uuid,p_order uuid,p_fingerprint text,p_lock uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; tx private.kit_test_transactions;
begin
  result:=public.claim_kit_test_payment(p_actor,p_order,p_fingerprint,p_lock);
  select * into tx from private.kit_test_transactions where order_id=p_order for update;
  if tx.state<>'reserved' then raise exception 'kit_not_payable'; end if;
  if not exists(select 1 from public.kit_orders where id=p_order and shipping_snapshot->'address' is not null) then
    raise exception 'kit_address_required';
  end if;
  return result||jsonb_build_object('state',tx.state,'refundedInCents',tx.refunded_cents);
end;
$$;
revoke all on function public.claim_kit_test_creation(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.claim_kit_test_creation(uuid,uuid,text,uuid) to service_role;

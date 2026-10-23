alter table private.kit_test_transactions add column expires_at timestamptz;
alter table private.kit_test_transactions add column pix_copy_paste text;
alter table private.kit_test_transactions add column pix_qr_code_base64 text;

create function public.store_kit_test_instructions(p_order uuid,p_provider text,p_expires timestamptz,p_copy text,p_qr text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if length(coalesce(p_copy,''))>10000 or length(coalesce(p_qr,''))>200000 then return false; end if;
  update private.kit_test_transactions set expires_at=coalesce(p_expires,expires_at),
    pix_copy_paste=coalesce(nullif(p_copy,''),pix_copy_paste),pix_qr_code_base64=coalesce(nullif(p_qr,''),pix_qr_code_base64)
    where order_id=p_order and provider_payment_id=p_provider and state='reserved';
  return found;
end;
$$;

create function public.create_kit_test_checkout(p_actor uuid,p_variant uuid,p_quantity integer,p_quote uuid,p_fingerprint text,p_key uuid,p_address uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare address public.addresses; result jsonb; previous_address text;
begin
  select a.* into address from public.addresses a join public.shipping_quotes q
    on q.id=p_quote and q.customer_id=a.user_id and regexp_replace(q.destination_postal_code,'[^0-9]','','g')=regexp_replace(a.postal_code,'[^0-9]','','g')
    where a.id=p_address and a.user_id=p_actor for share of a;
  if not found then raise exception 'kit_address_mismatch'; end if;
  result:=public.create_kit_test_transaction(p_actor,p_variant,p_quantity,p_quote,p_fingerprint,p_key);
  select shipping_snapshot->>'addressId' into previous_address from public.kit_orders where id=(result->>'orderId')::uuid;
  if previous_address is not null and previous_address<>p_address::text then raise exception 'kit_idempotency_conflict'; end if;
  if previous_address is null then
    update public.kit_orders set shipping_snapshot=shipping_snapshot||jsonb_build_object('addressId',p_address,
      'address',jsonb_build_object('recipientName',address.recipient_name,'postalCode',address.postal_code,
        'street',address.street,'number',address.number,'complement',address.complement,'district',address.district,
        'city',address.city,'state',address.state,'country',address.country)) where id=(result->>'orderId')::uuid;
  end if;
  return result;
end;
$$;

create function public.cancel_unstarted_kit_test_transaction(p_actor uuid,p_order uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare tx private.kit_test_transactions;
begin
  select * into tx from private.kit_test_transactions where order_id=p_order and actor_id=p_actor for update;
  if not found then return false; end if;
  if tx.state='cancelled' then return true; end if;
  if tx.state<>'reserved' or tx.payment_started_at is not null or tx.provider_payment_id is not null then return false; end if;
  update public.inventory set available_quantity=available_quantity+tx.quantity,reserved_quantity=reserved_quantity-tx.quantity,
    version=version+1,updated_at=now() where variant_id=tx.variant_id and reserved_quantity>=tx.quantity;
  if not found then raise exception 'kit_stock_conflict'; end if;
  update private.kit_test_transactions set state='cancelled',stock_state='released' where order_id=p_order;
  update public.kit_orders set status='cancelled' where id=p_order;
  insert into private.kit_test_events(order_id,kind,event_key,payload) values(p_order,'cancelled','cancelled:unstarted',
    jsonb_build_object('aggregate','kit_orders','mode','test')) on conflict do nothing;
  return true;
end;
$$;

create function public.read_kit_test_payment_instructions(p_actor uuid,p_order uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('expiresAt',t.expires_at,'pixCopyPaste',t.pix_copy_paste,'pixQrCodeBase64',t.pix_qr_code_base64)
  from private.kit_test_transactions t where t.actor_id=p_actor and t.order_id=p_order and t.state='reserved'
    and (t.expires_at is null or t.expires_at>now());
$$;

create function public.claim_kit_test_reconciliation(p_order uuid,p_lock uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare tx private.kit_test_transactions;
begin
  if p_lock is null then return null; end if;
  select * into tx from private.kit_test_transactions where order_id=p_order for update;
  if not found or tx.locked_until>now() or tx.provider_payment_id is null then return null; end if;
  update private.kit_test_transactions set lock_id=p_lock,locked_until=now()+interval '2 minutes' where order_id=p_order;
  return public.read_kit_test_transaction(tx.actor_id,p_order);
end;
$$;

create function public.read_kit_test_refund(p_actor uuid,p_order uuid,p_key uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('createdAt',r.created_at,'state',r.state,'amountInCents',r.amount_cents,
    'providerRefundId',r.provider_refund_id,'completedRefundIds',coalesce((select jsonb_agg(done.provider_refund_id)
      from private.kit_test_refunds done where done.order_id=p_order and done.state='completed'),'[]'::jsonb))
  from private.kit_test_refunds r join private.kit_test_transactions t on t.order_id=r.order_id
    where t.actor_id=p_actor and r.order_id=p_order and r.idempotency_key=p_key;
$$;

revoke all on function public.store_kit_test_instructions(uuid,text,timestamptz,text,text) from public,anon,authenticated;
revoke all on function public.read_kit_test_payment_instructions(uuid,uuid) from public,anon,authenticated;
revoke all on function public.claim_kit_test_reconciliation(uuid,uuid) from public,anon,authenticated;
revoke all on function public.read_kit_test_refund(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.store_kit_test_instructions(uuid,text,timestamptz,text,text) to service_role;
grant execute on function public.read_kit_test_payment_instructions(uuid,uuid) to service_role;
grant execute on function public.claim_kit_test_reconciliation(uuid,uuid) to service_role;
grant execute on function public.read_kit_test_refund(uuid,uuid,uuid) to service_role;
revoke all on function public.create_kit_test_checkout(uuid,uuid,integer,uuid,text,uuid,uuid) from public,anon,authenticated;
revoke all on function public.cancel_unstarted_kit_test_transaction(uuid,uuid) from public,anon,authenticated;
grant execute on function public.create_kit_test_checkout(uuid,uuid,integer,uuid,text,uuid,uuid) to service_role;
grant execute on function public.cancel_unstarted_kit_test_transaction(uuid,uuid) to service_role;

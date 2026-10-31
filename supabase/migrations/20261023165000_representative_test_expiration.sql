create function public.due_kit_test_transactions()
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  -- An unknown provider write is never treated as proof that no payment exists.
  update private.kit_test_transactions set state='reconciliation_required',lock_id=null,locked_until=null
    where state='reserved' and provider_payment_id is null and payment_started_at<now()-interval '23 hours'
      and (locked_until is null or locked_until<=now());
  return coalesce((select jsonb_agg(jsonb_build_object('orderId',t.order_id,'actorId',t.actor_id,'providerPaymentId',t.provider_payment_id))
    from (select * from private.kit_test_transactions where state='reserved' and (locked_until is null or locked_until<=now())
      and ((provider_payment_id is not null and expires_at<=now())
        or (payment_started_at is null and created_at<now()-interval '30 minutes')) order by created_at limit 4)t),'[]'::jsonb);
end;
$$;
revoke all on function public.due_kit_test_transactions() from public,anon,authenticated;
grant execute on function public.due_kit_test_transactions() to service_role;

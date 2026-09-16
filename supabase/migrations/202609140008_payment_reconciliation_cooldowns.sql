create table private.payment_reconciliation_cooldowns (
  order_id uuid primary key references public.orders(id) on delete cascade,
  next_allowed_at timestamptz not null
);
revoke all on private.payment_reconciliation_cooldowns from public,anon,authenticated;
create function public.claim_payment_reconciliation(p_order_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare next_allowed timestamptz;
begin
  if auth.uid() is null or not private.is_active_user() or not exists (
    select 1 from public.orders where id=p_order_id
      and (customer_id=auth.uid() or private.has_permission('finance.reconcile'))
  ) then raise exception 'Access denied' using errcode='42501'; end if;
  if not public.consume_private_api_rate_limit('payment_reconcile') then return false; end if;
  insert into private.payment_reconciliation_cooldowns as cooldowns(order_id,next_allowed_at)
    values(p_order_id,pg_catalog.clock_timestamp()+interval '60 seconds')
    on conflict(order_id) do update set next_allowed_at=pg_catalog.clock_timestamp()+interval '60 seconds'
    where cooldowns.next_allowed_at<=pg_catalog.clock_timestamp()
    returning cooldowns.next_allowed_at into next_allowed;
  return next_allowed is not null;
end;
$$;
revoke all on function public.claim_payment_reconciliation(uuid) from public,anon;
grant execute on function public.claim_payment_reconciliation(uuid) to authenticated;
notify pgrst, 'reload schema';

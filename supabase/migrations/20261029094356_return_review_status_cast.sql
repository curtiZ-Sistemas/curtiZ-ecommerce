begin;
-- Keep the state-machine result explicitly typed for database lint and runtime.
create or replace function public.review_customer_return(p_return_id uuid,p_action text,p_message text,p_instructions text default '',p_code text default '')
returns public.returns language plpgsql security definer set search_path='' as $$
declare r public.returns%rowtype; delivery timestamptz; target public.return_status;
begin
  perform private.require_permission(case when p_action='refund' then 'returns.refund' when p_action in ('receive','transit') then 'returns.inspect' else 'returns.approve' end);
  if char_length(coalesce(trim(p_message),'')) not between 5 and 2000 or char_length(coalesce(p_instructions,''))>2000
    or char_length(coalesce(p_code,''))>120 then raise exception 'invalid_return_review' using errcode='23514'; end if;
  -- Consistent order-first locking also serializes refund decisions across returns.
  perform 1 from public.orders where id=(select order_id from public.returns where id=p_return_id) for update;
  select * into r from public.returns where id=p_return_id for update;
  if r.id is null then raise exception 'return_not_found' using errcode='P0002'; end if;
  target:=(case p_action when 'review' then 'in_review' when 'photos' then 'waiting_photos' when 'approve' then 'approved'
    when 'reject' then 'rejected' when 'posting' then 'waiting_posting' when 'transit' then 'in_transit'
    when 'receive' then 'received' when 'exchange' then 'exchange_sent' when 'complete' then 'completed'
    when 'refund' then 'refund_requested' else null end)::public.return_status;
  if target is null or not (
    (p_action in ('review','photos','approve','reject') and r.status in ('requested','in_review','waiting_photos')) or
    (p_action='posting' and r.status in ('approved','waiting_posting')) or
    (p_action='transit' and r.status='waiting_posting') or
    (p_action='receive' and r.status in ('approved','waiting_posting','in_transit')) or
    (p_action='exchange' and r.status='inspection' and r.requested_resolution='exchange') or
    (p_action='complete' and r.status='exchange_sent') or
    (p_action='refund' and r.status in ('approved','waiting_posting','in_transit','received','inspection') and r.requested_resolution='refund')
  ) then raise exception 'return_transition_not_allowed' using errcode='23514'; end if;
  select max(delivered_at) into delivery from public.shipments where order_id=r.order_id and status='delivered';
  if p_action in ('reject','photos') and r.request_kind='withdrawal' and
    (delivery is null or private.return_withdrawal_within_period(delivery,r.requested_at)) then
    raise exception 'withdrawal_cannot_be_blocked' using errcode='23514'; end if;
  if p_action='posting' and (char_length(trim(coalesce(p_code,'')))<3 or char_length(trim(coalesce(p_instructions,'')))<10) then
    raise exception 'posting_instructions_required' using errcode='23514'; end if;
  if p_action in ('transit','exchange') and char_length(trim(coalesce(p_code,'')))<3 then raise exception 'tracking_required' using errcode='23514'; end if;
  if p_action='exchange' and exists(select 1 from public.return_items where return_id=r.id and inspection_result is null) then
    raise exception 'inspection_required' using errcode='23514'; end if;
  update public.returns set status=target,customer_message=trim(p_message),reviewed_at=now(),
    approved_by=case when p_action='approve' then auth.uid() else approved_by end,
    return_instructions=case when p_action='posting' then trim(p_instructions) else return_instructions end,
    reverse_logistics_code=case when p_action='posting' then trim(p_code) else reverse_logistics_code end,
    reverse_tracking_code=case when p_action='transit' then trim(p_code) else reverse_tracking_code end,
    exchange_tracking_code=case when p_action='exchange' then trim(p_code) else exchange_tracking_code end,
    resolved_at=case when target in ('rejected','completed') then now() else resolved_at end where id=r.id returning * into r;
  if p_action='refund' then insert into private.return_jobs(return_id,kind) values(r.id,'refund') on conflict do nothing; end if;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,new_data_sanitized)
    values(auth.uid(),'returns.'||p_action,'return',r.id,jsonb_build_object('status',target));
  return r;
end;
$$;
notify pgrst,'reload schema';
commit;

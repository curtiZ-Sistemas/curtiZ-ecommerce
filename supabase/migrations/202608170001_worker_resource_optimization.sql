-- Consolida indicadores operacionais para reduzir subrequests e payload no Worker.

create or replace function public.operational_dashboard_metrics()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission('operations.dashboard.read');

  return jsonb_build_object(
    'newOrders', (
      select count(*) from public.orders where status = 'payment_approved'
    ),
    'overdueOrders', (
      select count(*)
      from public.operational_tasks
      where due_at < now() and status in ('queued', 'in_progress', 'blocked')
    ),
    'waitingSeparation', (
      select count(*)
      from public.orders
      where status in ('payment_approved', 'processing', 'picking')
    ),
    'waitingShipping', (
      select count(*) from public.orders where status = 'ready_to_ship'
    ),
    'pendingKits', (
      select count(*)
      from public.kit_orders
      where status in ('paid', 'separating', 'ready_to_ship')
    ),
    'criticalStock', (
      select count(*)
      from public.inventory
      where available_quantity <= minimum_quantity
    ),
    'exchanges', (
      select count(*)
      from public.returns
      where requested_resolution = 'exchange'
        and status not in ('completed', 'cancelled', 'rejected')
    ),
    'returns', (
      select count(*)
      from public.returns
      where status not in ('completed', 'cancelled', 'rejected')
    ),
    'occurrences', (
      select count(*)
      from public.operational_occurrences
      where status in ('open', 'in_progress')
    ),
    'support', (
      select count(*)
      from public.support_conversations
      where assigned_user_id = auth.uid()
        and status in ('assigned', 'in_progress', 'waiting_customer', 'waiting_internal', 'reopened')
    ),
    'pendingTasks', (
      select count(*)
      from public.operational_tasks
      where status in ('queued', 'in_progress', 'blocked')
    )
  );
end;
$$;

revoke all on function public.operational_dashboard_metrics() from public, anon;
grant execute on function public.operational_dashboard_metrics() to authenticated;

notify pgrst, 'reload schema';

-- Require an active profile in addition to all existing ownership and staff policies.
create policy "inactive customer records revoked" on public.addresses as restrictive for all to authenticated using (private.is_active_user()) with check (private.is_active_user());
create policy "inactive customer records revoked" on public.carts as restrictive for all to authenticated using (private.is_active_user()) with check (private.is_active_user());
create policy "inactive customer records revoked" on public.cart_items as restrictive for all to authenticated using (private.is_active_user()) with check (private.is_active_user());
create policy "inactive customer records revoked" on public.notifications as restrictive for all to authenticated using (private.is_active_user()) with check (private.is_active_user());
create policy "inactive customer records revoked" on public.orders as restrictive for all to authenticated using (private.is_active_user()) with check (private.is_active_user());
create policy "inactive customer records revoked" on public.order_items as restrictive for all to authenticated using (private.is_active_user()) with check (private.is_active_user());
create policy "inactive customer records revoked" on public.payments as restrictive for all to authenticated using (private.is_active_user()) with check (private.is_active_user());
create policy "inactive customer records revoked" on public.returns as restrictive for all to authenticated using (private.is_active_user()) with check (private.is_active_user());

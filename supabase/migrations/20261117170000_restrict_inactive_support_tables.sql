-- Restrictive policies apply alongside all existing customer and staff policies.
create policy "inactive support access revoked" on public.support_conversations as restrictive for all to authenticated using (private.is_active_user()) with check (private.is_active_user());
create policy "inactive support access revoked" on public.support_messages as restrictive for all to authenticated using (private.is_active_user()) with check (private.is_active_user());
create policy "inactive support access revoked" on public.support_participants as restrictive for all to authenticated using (private.is_active_user()) with check (private.is_active_user());
create policy "inactive support access revoked" on public.support_attachments as restrictive for all to authenticated using (private.is_active_user()) with check (private.is_active_user());
create policy "inactive support access revoked" on public.support_status_history as restrictive for all to authenticated using (private.is_active_user()) with check (private.is_active_user());

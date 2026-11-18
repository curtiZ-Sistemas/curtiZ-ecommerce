-- The server service role retains access; direct client queries require an active, open account.
create policy "inactive payment references revoked" on public.payment_provider_customers
as restrictive for all to authenticated
using (private.is_active_user() and not private.customer_account_is_closed())
with check (private.is_active_user() and not private.customer_account_is_closed());
create policy "inactive payment references revoked" on public.payment_provider_card_operations
as restrictive for all to authenticated
using (private.is_active_user() and not private.customer_account_is_closed())
with check (private.is_active_user() and not private.customer_account_is_closed());

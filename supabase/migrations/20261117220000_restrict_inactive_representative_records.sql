-- Ownership is used by the existing policies for sales, network and documents.
create or replace function private.owns_representative(requested_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select private.is_active_user() and not private.customer_account_is_closed() and exists (
    select 1 from public.representatives r where r.id=requested_id and r.user_id=auth.uid()
  );
$$;

-- These tables also have policies that compare user_id directly.
create policy "inactive representative access revoked" on public.representatives
as restrictive for all to authenticated using (private.is_active_user()) with check (private.is_active_user());
create policy "inactive representative access revoked" on public.representative_applications
as restrictive for all to authenticated using (private.is_active_user()) with check (private.is_active_user());
create policy "inactive representative access revoked" on public.representative_application_documents
as restrictive for all to authenticated using (private.is_active_user()) with check (private.is_active_user());

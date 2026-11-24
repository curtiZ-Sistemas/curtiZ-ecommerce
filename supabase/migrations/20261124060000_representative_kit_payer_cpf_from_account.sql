-- The kit payer CPF now prefers the CPF saved in the customer's own account
-- (private.customer_checkout_identity, editable by the user) and falls back to
-- the CPF from the approved representative application. The value stays
-- encrypted; only the application decrypts and validates it.
create or replace function public.read_representative_kit_payer_cpf(p_actor uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select identity.cpf_ciphertext
       from private.customer_checkout_identity identity
      where identity.user_id = p_actor and identity.cpf_ciphertext is not null),
    (select app.cpf_ciphertext
       from public.representatives r
       join public.representative_applications app on app.id = r.application_id and app.user_id = r.user_id
      where r.user_id = p_actor and app.status::text = 'approved' and app.cpf_ciphertext is not null)
  );
$$;

revoke all on function public.read_representative_kit_payer_cpf(uuid) from public, anon, authenticated;
grant execute on function public.read_representative_kit_payer_cpf(uuid) to service_role;

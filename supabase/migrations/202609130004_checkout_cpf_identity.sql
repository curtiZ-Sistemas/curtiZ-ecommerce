begin;

-- Only trusted server code may write ciphertext after validating and encrypting a real CPF.
create or replace function public.save_my_checkout_identity(p_cpf_ciphertext text, p_cpf_last_four text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  perform 1 from public.profiles where id = auth.uid() and status = 'active' for update;
  if not found then raise exception 'customer_not_available' using errcode = '42501'; end if;
  if nullif(trim(p_cpf_ciphertext), '') is null or p_cpf_last_four is null
    or p_cpf_last_four !~ '^[0-9]{4}$' then
    raise exception 'invalid_customer_identity' using errcode = '22023';
  end if;
  insert into private.customer_checkout_identity(user_id, cpf_ciphertext, cpf_last_four)
  values(auth.uid(), p_cpf_ciphertext, p_cpf_last_four)
  on conflict(user_id) do update set cpf_ciphertext = excluded.cpf_ciphertext,
    cpf_last_four = excluded.cpf_last_four, updated_at = now();
  update public.profiles set cpf_last_four = p_cpf_last_four, updated_at = now() where id = auth.uid();
  return true;
end;
$$;
revoke all on function public.save_my_checkout_identity(text, text) from public, anon, authenticated;

-- The customer ID is supplied exclusively by the backend's verified auth.getUser().
create or replace function public.save_customer_checkout_identity(
  p_customer_id uuid, p_cpf_ciphertext text, p_cpf_last_four text
)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_customer_id is null then raise exception 'customer_required' using errcode = '22023'; end if;
  perform pg_catalog.set_config('request.jwt.claims',
    jsonb_build_object('sub', p_customer_id, 'role', 'authenticated')::text, true);
  return public.save_my_checkout_identity(p_cpf_ciphertext, p_cpf_last_four);
end;
$$;
revoke all on function public.save_customer_checkout_identity(uuid, text, text) from public, anon, authenticated;
grant execute on function public.save_customer_checkout_identity(uuid, text, text) to service_role;

create or replace function public.get_customer_checkout_identity(p_customer_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('customerId', identity.user_id,
    'cpfCiphertext', identity.cpf_ciphertext, 'cpfLastFour', identity.cpf_last_four)
  from private.customer_checkout_identity identity
  join public.profiles profile on profile.id = identity.user_id and profile.status = 'active'
  where identity.user_id = p_customer_id;
$$;
revoke all on function public.get_customer_checkout_identity(uuid) from public, anon, authenticated;
grant execute on function public.get_customer_checkout_identity(uuid) to service_role;
revoke all on table private.customer_checkout_identity from public, anon, authenticated;

commit;

begin;

-- Rotacao da chave de cifra dos tokens Melhor Envio (MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY).
-- A aplicacao recifra com a chave ativa um registro lido com chave antiga/formato legado.
-- Compare-and-swap: so grava se os dois ciphertexts ainda forem os lidos, sem disputar uma
-- renovacao OAuth em andamento; qualquer gravacao concorrente (refresh/callback) prevalece.
-- Prazos, status e lock de renovacao nao sao alterados.
create or replace function public.reencrypt_integration_credential(p_provider text,p_environment text,
  p_expected_access_token_ciphertext text,p_expected_refresh_token_ciphertext text,
  p_access_token_ciphertext text,p_refresh_token_ciphertext text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_provider is distinct from 'melhorenvio'
    or coalesce(p_expected_access_token_ciphertext,'') = '' or coalesce(p_expected_refresh_token_ciphertext,'') = ''
    or coalesce(p_access_token_ciphertext,'') !~ '^v2\.[0-9a-f]{16}\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$'
    or coalesce(p_refresh_token_ciphertext,'') !~ '^v2\.[0-9a-f]{16}\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$' then
    raise exception 'invalid_reencryption' using errcode = '22023';
  end if;
  update private.integration_credentials
  set access_token_ciphertext=p_access_token_ciphertext,refresh_token_ciphertext=p_refresh_token_ciphertext,updated_at=now()
  where provider=p_provider and environment=p_environment and status <> 'disconnected'
    and access_token_ciphertext=p_expected_access_token_ciphertext
    and refresh_token_ciphertext=p_expected_refresh_token_ciphertext
    and (refresh_locked_until is null or refresh_locked_until < now());
  return found;
end;
$$;
revoke all on function public.reencrypt_integration_credential(text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.reencrypt_integration_credential(text,text,text,text,text,text) to service_role;

commit;
notify pgrst, 'reload schema';

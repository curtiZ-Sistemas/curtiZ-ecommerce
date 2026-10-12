begin;

-- Rotacao da chave mestra dos tokens OAuth (cifrados pela aplicacao).
-- A aplicacao recifra access e refresh token com a chave ativa e grava os dois juntos somente se o
-- registro ainda contiver exatamente os ciphertexts lidos (compare-and-swap). Assim:
--   * os dois tokens migram de forma atomica (um unico UPDATE);
--   * um refresh OAuth concorrente nunca e sobrescrito por ciphertext antigo;
--   * uma falha deixa o registro anterior intacto e a proxima leitura retoma a migracao.
-- Status, vencimentos e lock de refresh nao sao alterados. Nenhuma chave e armazenada no banco.
create or replace function public.replace_integration_credential_ciphertext(
  p_provider text,
  p_environment text,
  p_expected_access_token_ciphertext text,
  p_expected_refresh_token_ciphertext text,
  p_access_token_ciphertext text,
  p_refresh_token_ciphertext text
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_updated integer;
begin
  if p_provider is distinct from 'melhorenvio' then
    raise exception 'provider does not support credential key rotation' using errcode = '22023';
  end if;
  if coalesce(p_access_token_ciphertext, '') !~ '^v2\.[0-9a-f]{12}\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$'
    or coalesce(p_refresh_token_ciphertext, '') !~ '^v2\.[0-9a-f]{12}\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$' then
    raise exception 'integration credential ciphertext must use the current format' using errcode = '22023';
  end if;
  update private.integration_credentials
     set access_token_ciphertext = p_access_token_ciphertext,
         refresh_token_ciphertext = p_refresh_token_ciphertext,
         updated_at = now()
   where provider = p_provider
     and environment = p_environment
     and status = 'connected'
     and access_token_ciphertext = p_expected_access_token_ciphertext
     and refresh_token_ciphertext = p_expected_refresh_token_ciphertext;
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.replace_integration_credential_ciphertext(text,text,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.replace_integration_credential_ciphertext(text,text,text,text,text,text)
  to service_role;

commit;

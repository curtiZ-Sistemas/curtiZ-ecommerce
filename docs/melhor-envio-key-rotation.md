# Melhor Envio — chave dos tokens OAuth

São duas operações diferentes:

| Operação | O que muda | Quem faz |
| --- | --- | --- |
| **Renovação OAuth** | access/refresh token emitidos pelo Melhor Envio | Automática, sob `claim_integration_refresh` |
| **Rotação da chave mestra** | só a chave AES-256-GCM que cifra os tokens no banco | Manual e coordenada, por secrets do Worker |

Nenhuma chave é gerada automaticamente em deploy ou reinicialização, nem gravada no banco ou no repositório.

## Formato

- `v2.<keyId>.<iv>.<ciphertext>`: formato atual. `keyId` são 12 hex de SHA-256 da chave com separação de
  domínio (não reversível). O campo (`access_token`/`refresh_token`) é dado autenticado (AAD).
- `v1.<iv>.<ciphertext>`: legado, sem identificação de chave. Continua legível.

## Secrets (loja `curtiz-ecommerce` e painel `curtiz-painel`, sempre os dois)

- `MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY`: chave ativa (32 bytes em base64). Toda gravação nova usa esta.
- `MELHOR_ENVIO_TOKEN_ENCRYPTION_PREVIOUS_KEYS`: opcional e temporário. Uma ou mais chaves anteriores,
  separadas por vírgula. Só decifram. Valor malformado desativa o frete (readiness `..._INVALID`).

## Procedimento de rotação

1. Gere a nova chave fora do repositório (`openssl rand -base64 32`).
2. Nos **dois** Workers: `MELHOR_ENVIO_TOKEN_ENCRYPTION_PREVIOUS_KEYS` = chave antiga e
   `MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY` = chave nova. Publique os dois.
3. Na primeira leitura, loja ou painel recifram access e refresh token juntos com a chave nova pela RPC
   `replace_integration_credential_ciphertext` (compare-and-swap). Se outra instância renovou os tokens
   antes, a RPC não grava (os tokens renovados já estão na chave nova). Falhas deixam o registro antigo
   intacto e a próxima leitura retoma.
4. Painel → Técnico → Integrações → Melhor Envio → **Testar OAuth do painel**, e faça uma cotação na loja.
   A linha **Chave dos tokens** precisa mostrar `Chave ativa <id>` e a nota
   "a chave anterior pode ser removida" (`keyRotation.previousKeysRemovable = true`): registro nos dois
   campos com a chave ativa, loja com o mesmo `keyId` e última cotação da loja online.
5. Só então remova `MELHOR_ENVIO_TOKEN_ENCRYPTION_PREVIOUS_KEYS` dos dois Workers.

## Chave anterior perdida

Se nenhuma chave configurada decifra o registro, o diagnóstico mostra `token_decryption_failed` (v1) ou
`token_key_unavailable` (v2). Não há recuperação possível sem a chave. Use **Reconectar** no painel (exibido
quando a conexão existe mas falha): o callback só substitui os tokens depois de o Melhor Envio aceitar a
troca do código. Não use **Desconectar** antes, pois ele apaga os ciphertexts imediatamente.

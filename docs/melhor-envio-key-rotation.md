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
  separadas por vírgula, espaço ou quebra de linha. Só decifram. Valor malformado desativa o frete (readiness `..._INVALID`).

## Procedimento de rotação

1. Gere a nova chave fora do repositório (`openssl rand -base64 32`).
2. Antes de alterar secrets, aplique e valide a migration incremental da RPC em ambiente isolado e depois,
   com autorização, no ambiente de destino. Publique o código compatível com v1/v2 nos **dois** Workers
   pelo GitHub Actions, mantendo a chave ativa antiga.
3. Prepare a leitura nos **dois** Workers: adicione a chave nova à lista temporária
   `MELHOR_ENVIO_TOKEN_ENCRYPTION_PREVIOUS_KEYS`, mantendo a ativa antiga e as chaves ainda necessárias.
   Confirme a configuração de ambos antes de avançar. Embora ainda futura, essa chave só permite leitura
   nesta etapa; nenhuma gravação passa a usá-la.
4. Só então altere `MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY` para a nova e mantenha a antiga na lista de leitura
   dos **dois** Workers. Uma atualização por vez é segura porque ambos já leem as duas chaves. Durante a
   transição podem recifrar para ativas diferentes; não retire nenhuma chave até os dois convergirem.
5. Na primeira leitura, loja ou painel recifram access e refresh token juntos com a chave nova pela RPC
   `replace_integration_credential_ciphertext` (compare-and-swap). Se outra instância renovou os tokens
   antes, a RPC não grava; a próxima leitura observa o registro atualizado. Falhas deixam o registro antigo
   intacto e a próxima leitura retoma.
6. Painel → Técnico → Integrações → Melhor Envio → **Testar OAuth do painel**, e faça uma cotação na loja.
   A linha **Chave dos tokens** precisa mostrar `Chave ativa <id>` e a nota
   "a chave anterior pode ser removida" (`keyRotation.previousKeysRemovable = true`): registro nos dois
   campos com a chave ativa, OAuth online e cotação online da loja no mesmo ambiente, com o mesmo `keyId`,
   nos últimos cinco minutos. Confirme também que a versão ativa de cada Worker recebeu a configuração;
   esse diagnóstico registra a última requisição e não certifica todas as instâncias durante um rollout.
7. Só então remova as chaves antigas de `MELHOR_ENVIO_TOKEN_ENCRYPTION_PREVIOUS_KEYS` dos dois Workers.

## Chave anterior perdida

Se nenhuma chave configurada decifra o registro, o diagnóstico mostra `token_decryption_failed` (v1 ou
v2 corrompido) ou `token_key_unavailable` (v2 cuja chave não está configurada). Não há recuperação possível
sem a chave. Use **Reconectar** no painel (exibido
quando a conexão existe mas falha): o callback só substitui os tokens depois de o Melhor Envio aceitar a
troca do código. Não use **Desconectar** antes, pois ele apaga os ciphertexts imediatamente.

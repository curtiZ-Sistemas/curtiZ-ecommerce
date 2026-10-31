# Diagnóstico do frete e build — 09/10/2026

## Evidências confirmadas

- O evento fornecido do Supabase é `store.shipping_quote / melhor_envio_authentication`, com suporte
  `FRT-1B992A5D`. O código originalmente informado, `FRT-1B924A5D`, é diferente e não apareceu na
  consulta dos logs Cloudflare. Nenhum dado pessoal do evento foi copiado para este documento.
- O evento de autenticação é produzido depois da configuração e da consulta dos produtos, antes de
  persistir `shipping_quotes`. Não há evidência de que o endereço seja a causa. A versão anterior
  agrupava token ausente, falha de descriptografia e HTTP 401/403, sem permitir distinguir a causa.
- Existem bindings Client ID/Secret e chave de criptografia nos dois Workers oficiais. Seus valores
  secretos não são acessíveis pela API de configuração; não foi comprovada sua igualdade nem validade.
- Sandbox, host e callback de runtime apontam para o ambiente correto; as quatro URLs de runtime
  apontam para `curtiz-ecommerce`, `curtiz-painel` e os domínios oficiais.
- `ALLOWED_ORIGINS` de runtime dos dois Workers ainda incluía `curtiz-panel` em lugar de
  `curtiz-painel`. `MELHOR_ENVIO_APP_NAME` não existia no runtime do painel.
- Os logs do Workers Build `735c05cd-2acf-4f75-b394-682314706867` reproduzem os três erros relatados.
  O gatilho de branches não principais do painel não recebia `NEXT_PUBLIC_STORE_TEST_URL`; usava
  `NEXT_PUBLIC_PANEL_URL` com a origem `curtiz-painel`, mas a allowlist continha `curtiz-panel`.
  As variáveis de Build desse gatilho divergiam das de Runtime e do workflow oficial.
- O workflow versionado já contém as quatro URLs oficiais e a allowlist correspondente. Os nomes
  de produção no Wrangler já estão corretos; `curtiz-panel-staging` é um ambiente distinto existente.

## Correções de implementação

- Rejeição OAuth 400/422 passa a ser falha de autenticação da integração, sem pedir ao cliente que
  altere CEP/itens. O diagnóstico registra motivo e HTTP upstream sem mensagens privadas.
- O refresh compara o token realmente rejeitado pelo 401. Um 401 atrasado de outro request reutiliza
  o token novo, sem uma segunda rotação desnecessária.
- RPC de leitura de credenciais com erro não é confundida com OAuth desconectado. Falhas de gravação
  e de lock de refresh são categorizadas; pesos/dimensões e valores continuam vindos do catálogo.
- Ambiente normalizado é usado tanto na escolha do host quanto nas RPCs e na persistência.
- Resposta malformada do provedor e gravação incompleta em `shipping_quotes` falham explicitamente,
  preservando a distinção de serviços declarados indisponíveis pelo provedor.
- O painel separa teste OAuth do painel e último diagnóstico da loja, incluindo falha na consulta.
- Validação de ambiente reaproveita a checagem de configuração do runtime. As exigências de HTTPS,
  allowlist completa, par de URLs, autenticação, MFA e rate limit permanecem.
- Documentação Sandbox foi alinhada ao CI: configurações e secrets Melhor Envio são de Runtime;
  GitHub Actions compila com integrações desativadas e preserva esses bindings com `--keep-vars`.

## Configuração manual pendente na Cloudflare

Em **Variables and Secrets** de `curtiz-ecommerce` e `curtiz-painel`:

| Variável | Ação necessária |
| --- | --- |
| `ALLOWED_ORIGINS` | **Resolvido** (confirmado em 09/10 pela versão ativa dos dois Workers). Valor esperado: `https://curtiz.com.br,https://painel.curtiz.com.br,https://curtiz-ecommerce.sistemas-curtiz.workers.dev,https://curtiz-painel.sistemas-curtiz.workers.dev`. O deploy oficial também espelha esse valor. |
| `MELHOR_ENVIO_APP_NAME` | **Pendente** no `curtiz-painel` (ausente na versão ativa; a loja usa `curti Z`). É o motivo de "Frete no painel: Não configurado". |
| `MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY` | Conferir que a loja utiliza a chave existente com que o painel cifrou os tokens; só alterar se divergente. |
| `MELHOR_ENVIO_CLIENT_ID` | Conferir mesmo aplicativo Sandbox nos dois Workers; só alterar se divergente. |
| `MELHOR_ENVIO_CLIENT_SECRET` | Conferir mesmo aplicativo Sandbox nos dois Workers, como Secret; só alterar se divergente. |

Não há evidência que autorize alterar `MELHOR_ENVIO_ORIGIN_*`. Os valores secretos não foram lidos.
Se o novo evento apontar `refresh_token_expired`/`credentials_missing`, reconectar OAuth no painel;
se apontar `permission_denied`, conferir a permissão `shipping-calculate`. Esses tokens e permissões
não são corrigidos inventando variáveis de ambiente.

As seis configurações públicas de Build/Runtime estão listadas em `docs/deployment.md`. Não voltar
a usar os Build variables antigos para publicação. Os quatro gatilhos de Workers Builds foram
suspensos pela API com `path_excludes=["*","**/*"]`; comandos e variáveis existentes foram
preservados.
O caminho oficial permanece GitHub Actions. A desconexão definitiva pode ser feita em Settings →
Builds → Disconnect. Nenhum Worker legado é migrado ou removido.

## Verificação de 09/10 (somente leitura via Wrangler)

- Loja: `SHIPPING_PROVIDER=melhorenvio`, `MELHOR_ENVIO_ENABLED=true`, sandbox, host e callback corretos;
  documento da origem em `MELHOR_ENVIO_ORIGIN_COMPANY_DOCUMENT`.
- Loja e painel possuem `MELHOR_ENVIO_CLIENT_SECRET` e `MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY` como Secret;
  `MELHOR_ENVIO_CLIENT_ID` é Secret na loja e variável no painel. Os valores não são legíveis.
- `GIT_COMMIT_SHA` da loja ainda é `uncommitted`: o GitHub Actions ainda não publicou o código atual,
  inclusive estes motivos detalhados de autenticação.
- O build da loja falhava no typecheck do Next porque `media/banner/[...path]/route.ts` exportava uma
  função auxiliar; corrigido e protegido por `scripts/route-exports.test.ts`.

## Limitações de validação remota

Sem sessão técnica autenticada ou credencial de serviço do Supabase acessível, não foi executada uma
cotação remota autenticada nem consultado o conteúdo cifrado das credenciais. A consulta somente
leitura ao preflight público do Supabase retornou HTTP 403 pelo conector; isso não comprova ausência
de migration. Testes com dependências simuladas não comprovam RLS, concorrência real do Postgres ou
execução no Worker publicado. Não foram criados pedidos, cobranças, etiquetas ou operações fiscais.

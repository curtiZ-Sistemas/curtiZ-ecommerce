# Cookies, privacidade e consentimento (loja)

## Como funciona

| Camada | Responsabilidade |
| --- | --- |
| `cookie-preferences.tsx` | Aviso compacto, aceitar/recusar/personalizar, reabertura pelo rodapé, sincronização entre abas. |
| `lib/privacy/consent-client.ts` | Escolha no navegador (`curtiz-cookie-consent`); vale só se tiver até 12 meses e for da versão vigente. |
| `POST /api/privacy/cookies` | Valida origem e payload, registra no Supabase e emite o cookie httpOnly assinado `curtiz-cookie-preferences`. |
| `lib/privacy/consent-token.ts` | Assinatura HMAC (com separação de domínio) do cookie: id do consentimento, versão, categorias e data. |
| `record_cookie_consent` (SQL) | Valida categorias, protege registros de outra conta, grava histórico em `private.cookie_consent_events` e, na retirada de analytics, apaga eventos e perfis vinculados. |
| `ingest_intelligence_events(…, p_consent_id)` | Só grava eventos de um consentimento registrado, vigente, da política atual e com analytics. |

Categorias: **essenciais** (sempre ativas: sessão, segurança, carrinho, favoritos, checkout, pagamento),
**preferências** (pesquisas recentes, indicação) e **analytics** (Intelligence Engine e métricas da home).
Nenhuma opcional vem marcada; recusar tem o mesmo destaque que aceitar.

### Versão da política

`cookies-v<versão publicada>-inventory-<n>` ou `cookies-draft-inventory-<n>` sem publicação. Publicar
nova versão da Política de Cookies ou mudar `cookieInventoryVersion` faz o aviso reaparecer, e as
autorizações anteriores deixam de valer no navegador, no cookie assinado e no banco. Se a consulta da
política falhar, o aviso não reaparece por isso (`policyVersionKnown: false`).

### Falhas

- Banco indisponível: recusar funciona (registro local + cookie assinado sem opcionais); aceitar mostra
  erro e nada opcional é ativado.
- Sem rede: recusar vale no dispositivo; aceitar mostra erro.
- Sem chave de assinatura: o cookie é apagado e o servidor não reconhece categorias opcionais
  (falha fechada).
- Retirada durante a sessão: a fila é descartada, o envio em andamento é cancelado, a sessão local e
  remota é apagada e o banco recusa envios atrasados.

## Aplicação em produção (requer autorização)

1. Aplicar `supabase/migrations/202610120001_cookie_consent_hardening.sql` **junto com o deploy da
   loja**. Antes do deploy, a versão antiga da loja chama a RPC antiga, que passa a não coletar nada:
   o analytics fica desligado (falha fechada) até a nova versão entrar.
2. Opcional: secret `COOKIE_CONSENT_HMAC_KEY` (≥ 32 caracteres) no Worker da loja. Sem ela é usada
   `RATE_LIMIT_HMAC_KEY` com separação de domínio. Trocar a chave invalida os cookies assinados: os
   visitantes continuam com a escolha local, mas o servidor só volta a reconhecer opcionais após nova escolha.
3. Após o deploy todos os visitantes veem o aviso uma vez (`inventory-3`, nova assinatura).

## Política de Cookies (documento jurídico)

Em 12/10/2026 o documento `politica-de-cookies` estava em **draft, sem nenhuma versão** e sem
publicação. Nada foi publicado ou alterado. Antes da aprovação, o texto deve cobrir o inventário de
`cookie-inventory.ts` / `cookie_definitions`, incluindo:

- as três categorias, a base legal de cada uma e como alterar a escolha pelo rodapé;
- validade de 12 meses e nova solicitação quando a política mudar;
- terceiros essenciais: SDK do Mercado Pago (somente na etapa de pagamento, prevenção a fraudes) e
  Cloudflare Turnstile (login, cadastro e recuperação de senha, quando ativado);
- armazenamentos locais essenciais: carrinho, favoritos, sessão de acesso, idempotência do checkout,
  tentativa de pagamento, ajuda e portal do representante;
- Intelligence Engine: identificador por sessão, produtos vistos, exclusão na retirada;
- `curtiz-demo-session` existe só no ambiente de demonstração.

Não verificado nesta auditoria: cookies definidos pela Cloudflare na borda (ex.: proteção contra bots)
e os nomes exatos dos cookies do SDK do Mercado Pago; confirmar no navegador em produção antes de
detalhá-los no documento.

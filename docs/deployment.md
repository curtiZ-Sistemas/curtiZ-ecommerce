# Deploy

A produção usa dois aplicativos Next.js e dois Workers Cloudflare independentes:

- loja: `apps/store` → Worker `curtiz-ecommerce`;
- painel: `apps/panel` → Worker `curtiz-panel`.

O Supabase gerenciado continua sendo a fonte de verdade dos dados. Loja e painel precisam de URLs,
variáveis e rotas próprias.

## Caminho oficial de produção

O workflow `.github/workflows/ci.yml` é o único caminho automático de produção. Em cada `push` no
`main`, ele executa qualidade, migrations em um Supabase efêmero no runner Linux e E2E. Apenas após
todas as validações, o OpenNext compila as aplicações alteradas e o Wrangler publica o Worker
correspondente. O controle de concorrência cancela uma execução antiga quando chega um commit mais
novo, evitando deploy fora de ordem.

No Cloudflare, abra **Workers & Pages**, selecione cada Worker, acesse **Settings → Builds** e use
**Disconnect**. Repita em `curtiz-ecommerce` e `curtiz-panel`. Manter a integração Git nativa e o
GitHub Actions ativos ao mesmo tempo cria dois deploys concorrentes para o mesmo commit. As variáveis
e secrets de runtime permanecem no Cloudflare; o workflow usa `--keep-vars` e nunca os copia para o
repositório.

Configure no GitHub, em **Settings → Secrets and variables → Actions**:

- secrets: `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID`;
- variables: `NEXT_PUBLIC_STORE_URL`, `NEXT_PUBLIC_PANEL_URL`,
  `NEXT_PUBLIC_STORE_TEST_URL`, `NEXT_PUBLIC_PANEL_TEST_URL`,
  `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `DEMO_MODE`,
  `CHECKOUT_ENABLED`, `PAYMENT_PROVIDER`, `MERCADO_PAGO_ENABLED`, `SHIPPING_PROVIDER`,
  `MELHOR_ENVIO_ENABLED`, `EMAIL_PROVIDER`, `EMAIL_ENABLED`, `TURNSTILE_ENABLED`,
  `REQUIRE_INTERNAL_MFA`, `AUTH_RATE_LIMIT_ENABLED`, `ALLOWED_ORIGINS` e
  `AUTH_COOKIE_DOMAINS`;
- variables condicionais: `NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY` quando o Mercado Pago estiver
  habilitado, `NEXT_PUBLIC_TURNSTILE_SITE_KEY` quando o Turnstile estiver habilitado e `EMAIL_FROM`
  quando o envio de e-mail estiver habilitado.

O token Cloudflare deve ter somente as permissões necessárias para publicar os dois Workers na
conta correta. Não armazene tokens em variables públicas.

Antes do build, o workflow consulta somente os **nomes** dos secrets já presentes em cada Worker.
Ele exige `SUPABASE_SECRET_KEY`, `PII_ENCRYPTION_KEY`, `AUDIT_HASH_KEY`,
`ACCOUNT_DELETION_HMAC_KEY`, `RATE_LIMIT_HMAC_KEY` e `REFERRAL_ATTRIBUTION_HMAC_KEY`; quando a
integração correspondente está habilitada, exige também `MERCADO_PAGO_ACCESS_TOKEN`,
`MERCADO_PAGO_WEBHOOK_SECRET`, `TURNSTILE_SECRET_KEY` e/ou `RESEND_API_KEY`. Valores secretos não
são copiados para o GitHub nem impressos. Placeholders efêmeros servem exclusivamente para permitir
que o validador de presença rode durante o build; o runtime mantém os secrets reais com
`--keep-vars`.

## Domínios públicos e aliases de teste

A origem canônica da loja é determinada somente por `NEXT_PUBLIC_STORE_URL`. O par de produção e o
par de teste devem ser configurados assim:

```dotenv
NEXT_PUBLIC_STORE_URL=https://curtiz.com.br
NEXT_PUBLIC_PANEL_URL=https://painel.curtiz.com.br
NEXT_PUBLIC_STORE_TEST_URL=https://curtiz-ecommerce.sistemas-curtiz.workers.dev
NEXT_PUBLIC_PANEL_TEST_URL=https://curtiz-panel.sistemas-curtiz.workers.dev
AUTH_COOKIE_DOMAINS=curtiz.com.br,sistemas-curtiz.workers.dev
ALLOWED_ORIGINS=https://curtiz.com.br,https://painel.curtiz.com.br,https://curtiz-ecommerce.sistemas-curtiz.workers.dev,https://curtiz-panel.sistemas-curtiz.workers.dev
```

As quatro variáveis `NEXT_PUBLIC_*_URL` são variáveis de build do GitHub Actions e devem ser
espelhadas com os mesmos valores no runtime dos dois Workers. As duas últimas são aliases, não
origens canônicas. `AUTH_COOKIE_DOMAINS` e `ALLOWED_ORIGINS` são variáveis somente de runtime dos
dois Workers no Cloudflare. A aplicação seleciona o par correspondente ao host da requisição; isso
mantém login, logout, MFA e navegação loja/painel isolados entre produção e teste.

No Cloudflare, associe `curtiz.com.br` ao Worker `curtiz-ecommerce` e
`painel.curtiz.com.br` ao Worker `curtiz-panel` como **Custom Domains**. Não adicione essas rotas ao
Wrangler: assim os domínios podem ser retirados e recolocados no painel sem alteração de código e
os endereços `workers.dev` permanecem habilitados. Para o `www`, crie um registro DNS `A` proxied
`www` apontando para `192.0.2.0` e um Single Redirect com padrão de entrada `https://www.*`, destino
`https://${1}`, status 301 e **Preserve query string** habilitado.

No Supabase Auth, use `https://curtiz.com.br` como **Site URL** e cadastre estas Redirect URLs:

```text
https://curtiz.com.br/auth/callback**
https://curtiz-ecommerce.sistemas-curtiz.workers.dev/auth/callback**
```

O `**` fica restrito ao final da rota real e é necessário porque confirmação e recuperação incluem
o parâmetro seguro `next` na query string. Se os templates de e-mail do Auth tiverem sido
personalizados, os links de confirmação e recuperação devem usar `{{ .RedirectTo }}`.

O ambiente local mantém as URLs adicionais definidas em `supabase/config.toml`.

Para republicar sem criar commit, abra **Actions → CI → Run workflow** e escolha `store`, `panel` ou
`both`. A execução manual passa pelas mesmas validações antes do deploy.

Cada deploy injeta metadados (`GIT_COMMIT_SHA`, `BUILD_ID` e `BUILD_TIMESTAMP`) e espelha as
variáveis **não secretas** validadas do GitHub. O commit ativo pode ser consultado em `/api/version`
na URL de cada aplicação. Secrets de runtime permanecem somente no Cloudflare.

## Validação dos ambientes

- `pnpm validate:development`: aceita URLs locais e mocks.
- `pnpm validate:staging`: exige URLs e Supabase remoto de homologação; aceita mocks explícitos.
- `pnpm validate:production`: exige HTTPS, chaves internas, origens permitidas e `DEMO_MODE=false`.

`NODE_ENV=production` seleciona otimizações do framework; não habilita integrações comerciais.
Integrações desativadas não devem receber tokens fictícios:

```dotenv
CHECKOUT_ENABLED=false
PAYMENT_PROVIDER=disabled
MERCADO_PAGO_ENABLED=false
SHIPPING_PROVIDER=disabled
MELHOR_ENVIO_ENABLED=false
EMAIL_PROVIDER=disabled
EMAIL_ENABLED=false
TURNSTILE_ENABLED=false
REQUIRE_INTERNAL_MFA=false
```

Para habilitar temporariamente o Checkout Bricks apenas em teste, configure na Worker da loja:

```dotenv
CHECKOUT_ENABLED=true
PAYMENT_PROVIDER=mercadopago
MERCADO_PAGO_ENABLED=true
MERCADO_PAGO_ENVIRONMENT=test
MERCADO_PAGO_ACCESS_TOKEN=TEST-...
NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY=TEST-...
SHIPPING_PROVIDER=fixed
```

`MERCADO_PAGO_WEBHOOK_SECRET` é obrigatório quando o Mercado Pago está habilitado; o webhook é
parte da reconciliação idempotente. O backend continua bloqueando credenciais sem o prefixo de teste.
Configure no Mercado Pago a URL canônica `https://<loja>/api/webhooks/mercadopago`. A Edge Function
homônima é apenas um relay de compatibilidade para essa rota e requer `NEXT_PUBLIC_STORE_URL`; ela
não processa nem persiste eventos. `ACCOUNT_DELETION_HMAC_KEY` também deve ser um secret aleatório,
independente das chaves do Supabase, e não deve ser exposto como variável `NEXT_PUBLIC_*`.

Uma futura mudança para produção deve ser explícita e revisada no adapter compartilhado de
`packages/integrations`, com configuração de ambiente de pagamento, credenciais e testes de
assinatura/reconciliação. A interface de pagamento, as transações locais e a idempotência podem ser
reutilizadas; não basta trocar o token. Nesta etapa, os guards `TEST-` permanecem obrigatórios e não
há modo live habilitado.

Enquanto `SHIPPING_PROVIDER=fixed`, o banco adiciona R$ 16,90 a todos os pedidos do Checkout
Bricks. O Melhor Envio permanece opcional e restrito ao Sandbox. Mesmo que
`SHIPPING_PROVIDER=melhorenvio` seja solicitado, a configuração efetiva volta para `fixed` até que
`MELHOR_ENVIO_ENABLED` e `MELHOR_ENVIO_OAUTH_VALIDATED` estejam ativos e Client ID, Client Secret,
URL base, Redirect URI, Access Token e sua validade estejam presentes. A URL base aceita para essa
etapa é somente `https://sandbox.melhorenvio.com.br`.

Variáveis ausentes do Melhor Envio não invalidam o build nem bloqueiam o checkout. Mantenha
`MELHOR_ENVIO_OAUTH_VALIDATED=false` até um fluxo backend confirmar a autorização e a validade do
token. Falhas futuras de cotação devem continuar retornando ao provider `fixed`.

## Comandos equivalentes

Os comandos abaixo são úteis para diagnóstico ou operação manual autorizada. Execute-os na raiz do
monorepo após gerar o artefato OpenNext da aplicação correta:

```powershell
pnpm validate:production
pnpm exec tsx scripts/validate-supabase-readiness.ts
pnpm build:worker
pnpm exec wrangler deploy --config apps/store/wrangler.jsonc --env production --keep-vars

pnpm build:worker:panel
pnpm exec wrangler deploy --config apps/panel/wrangler.jsonc --env production --keep-vars
```

O `wrangler.jsonc` da raiz continua apontando exclusivamente para a loja por compatibilidade. Para o
painel, sempre informe `apps/panel/wrangler.jsonc`; apontar o painel para `apps/store` publica a loja
no Worker errado.

Esses comandos não ativam deploy automaticamente. Para uma publicação manual autorizada, confira
também a presença dos secrets do Worker usando `wrangler secret list --config <config da aplicação>
--env production --format json` e `scripts/cloudflare-secret-validation.ts <arquivo JSON>`.
Não imprima valores nem coloque secrets em argumentos `--var`. Fora do CI, o build usa a
configuração server-side do ambiente seguro do operador; o script de presença não recupera secrets.

## Preflight, smoke e housekeeping

O deploy da loja executa `pnpm build:worker`, que reutiliza `validate:production`. Antes de publicar,
o CI confirma os secrets do Worker e chama a RPC pública
`cart_variant_stock_availability` no Supabase remoto. Portanto, aplique a migration incremental
`202609120006_production_checkout_operations.sql` antes de liberar o commit; se ela estiver ausente,
o deploy para antes de substituir a versão ativa.

Depois da publicação, `pnpm smoke:storefront -- <URL>` valida homepage, catálogo, configuração
pública, API de versão e disponibilidade/Supabase sem criar pedido ou cobrança. A mesma verificação
pode ser executada manualmente contra a URL `workers.dev` ou o domínio canônico.

A loja possui um Cron Trigger Cloudflare a cada cinco minutos. O handler chama somente
`expire_stale_mercadopago_orders` com lote de 50, faz no máximo uma repetição para falha transitória
e registra resultado sem credenciais. A função usa advisory lock não bloqueante, e a expiração por
pedido permanece idempotente. Após o primeiro deploy, confira em **Workers & Pages → Triggers** se
o cron `*/5 * * * *` aparece e acompanhe os eventos `checkout-housekeeping` nos logs.

O código e a configuração do cron estão preparados, mas não significam ativação ou execução remota
verificada. Chaves modernas `sb_secret_`/`sb_publishable_` são enviadas no header `apikey`, não como
JWT Bearer; chaves legadas JWT continuam compatíveis ([documentação Supabase](https://supabase.com/docs/guides/getting-started/api-keys)).

### Proteção de tráfego

Os endpoints preservam validação de origem, sessão nas operações de compra, idempotência e lote
máximo de 50 variantes. A proteção distribuída de tráfego desses endpoints depende da zona
Cloudflare: em **Security → WAF → Rate limiting rules**, configurar POST nos caminhos
`/api/cart/availability`, `/api/checkout` e `/api/checkout/payment`, com contagem por IP e limites
compatíveis com uso normal e compartilhamento de rede. Verificar também a cobertura dos aliases
`workers.dev` antes de considerar a proteção completa. Essa regra externa não foi ativada nem
testada por esta alteração; não há rate limiter em memória fingindo proteção distribuída.

## Migrations

O CI inicia Supabase e Docker somente no runner Linux, aplica todas as migrations, executa
`supabase db lint` e os testes pgTAP. Nada exige Docker, WSL ou k6 no notebook Windows.

Aplicar migrations no Supabase remoto é uma operação separada do deploy dos Workers. Produção exige
aprovação explícita, backup verificado e conferência prévia da lista com `supabase migration list
--linked`. Nunca execute seed de demonstração em produção.

## Migração da fronteira de navegador (2026-09-13)

Antes de publicar esta versão, aplique a migration incremental
`202609130003_private_api_rate_limits.sql` no ambiente de destino. Ela mantém as policies/grants
existentes e acrescenta limites fixos por usuário autenticado para MFA e suporte; sem ela, essas
rotas falham de forma fechada com 503. Os testes pgTAP correspondentes devem passar no Supabase efêmero.

Renomeie `NEXT_PUBLIC_SUPABASE_URL` para `SUPABASE_URL` e
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` para `SUPABASE_PUBLISHABLE_KEY` nas variables do GitHub,
no runtime de **ambos** os Workers e nos ambientes locais seguros. Remova os nomes antigos;
não mantenha duas cópias. Nenhum arquivo real de credenciais é alterado automaticamente.
A chave publishable continua sem privilégio administrativo, mas agora é usada somente pelo servidor.
`SUPABASE_SECRET_KEY` continua como secret exclusivo do servidor.

Suporte usa polling de 15 segundos com ETag específico por identidade, suspenso em abas ocultas/offline.
As consultas e downloads repetem a autorização/RLS em cada chamada, inclusive ao responder 304.
Anexos privados são transmitidos por uma rota autenticada da loja; a interface não recebe URLs assinadas
nem caminhos do Storage. MFA usa rotas próprias com cookies HttpOnly, Secure em produção e SameSite=Lax;
enrollment só devolve QR/secret ao dono da sessão e a UI limpa esses dados ao concluir.

O navegador ainda pode conhecer URLs de imagens/vídeos **públicos** vindos dos DTOs de catálogo e as
origens oficiais de Mercado Pago/Turnstile. Isso não concede acesso a dados privados. O SDK e a chave
pública do Mercado Pago permanecem no navegador; cartão/CVV continuam nos Secure Fields oficiais.
Vídeos de produtos de até 80 MB preservam upload direto assinado, autorizado no servidor e limitado
ao objeto preparado. A CSP do painel permite apenas o caminho de upload assinado de produtos no
projeto configurado; ela não libera Data API nem Realtime. As URLs assinadas temporárias de documentos
e contratos da área de representantes continuam restritas aos dados autorizados desse fluxo existente.

`pnpm check:exposure` verifica imports transitivos do cliente, configuração pública e artefatos
versionados. Os builds Next/OpenNext e comandos de deploy verificam os assets públicos, rejeitando
source maps e exposições proibidas. Mapas internos do Worker não são tratados como assets de navegador.
Esses gates não substituem RLS, autorização nem rotação de credenciais quando necessária.
# Hardening adicional de uploads e webhook

- O binding `IMAGES` deve estar operacional em store e panel. Imagens de clientes são decodificadas/reencodadas como WebP sem metadados; sem o decoder, o upload falha fechado. Testes unitários não substituem validação do binding no Worker.
- Aplique também `202609140004_payment_webhook_leases.sql`: deduplicação inclui reembolsos, com lease de 60 segundos e orçamento compartilhado por pagamento.
- Antes de liberar os Workers, aplique as migrations incrementais `202609140003` a `202609140008` e execute DB lint/pgTAP em banco efêmero. Elas cobrem autoridade de roles, orçamentos privados/públicos, leases de webhook, devoluções, fila de análise e cooldown de reconciliação. Rotas dependentes falham fechadas enquanto suas RPCs não estiverem disponíveis.
- A migration `202609160001_auth_rate_limit_result_contract.sql` deve ser aplicada antes do Worker da loja. O preflight exige a versão 2 do contrato; sem ela, autenticação falha com 503 em vez de transformar indisponibilidade do Supabase em um bloqueio 429 falso.
- Os novos HMACs devem ser independentes, aleatórios e ter pelo menos 32 caracteres. Não reutilize a chave de webhook ou a service role. A configuração versionada do painel agora inclui `IMAGES` em staging/produção; confirme a disponibilidade do serviço e teste upload real em staging.
- O adaptador Mercado Pago permanece restrito a `MERCADO_PAGO_ENVIRONMENT=test` e credenciais `TEST-`. Não habilite produção simplesmente trocando credenciais: o adaptador live e sua homologação ainda não estão implementados.
- A auditoria foi corrigida para Next.js/eslint-config-next `16.3.3` e versões transitivas vulneráveis via overrides restritos. OpenNext `1.20.2` e Wrangler `4.86.0` foram preservados. A instalação aponta peers WASM opcionais do resolver ESLint; lint no host não equivale à validação dessa plataforma opcional.
- No Windows, o build Next passou, mas o empacotamento OpenNext encontrou `EPERM` ao criar symlinks. Confirme os builds completos dos dois Workers no CI Linux antes de publicar; o suporte de versão declarado pelo pacote não comprova execução do Worker.
- Os jobs de segurança fazem parte dos requisitos do deploy. CodeQL/dependency review dependem das funcionalidades disponíveis no plano GitHub; a Action oficial do Gitleaks exige licença para repositórios de organizações. Configure essas permissões/licença externamente quando aplicável, sem silenciar falhas.

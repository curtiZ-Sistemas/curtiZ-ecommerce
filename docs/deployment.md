# Deploy

A produção usa dois aplicativos Next.js e dois Workers Cloudflare independentes:

- loja: `apps/store` → Worker `curtiz-ecommerce`;
- painel: `apps/panel` → Worker `curtiz-painel`.

O Supabase gerenciado continua sendo a fonte de verdade dos dados. Loja e painel precisam de URLs,
variáveis e rotas próprias.

## Caminho oficial de produção

O workflow `.github/workflows/ci.yml` é o único caminho automático de produção. Em cada `push` no
`main`, ele executa qualidade, migrations em um Supabase efêmero no runner Linux e E2E. Apenas após
todas as validações, o OpenNext compila as aplicações alteradas e o Wrangler publica o Worker
correspondente. O controle de concorrência cancela uma execução antiga quando chega um commit mais
novo, evitando deploy fora de ordem.

### Deploy automático único (ação manual no Cloudflare)

O GitHub Actions deve ser o **único** caminho automático. Confira manualmente, no Cloudflare, se os
**Workers Builds** estão desconectados; o repositório não altera essa configuração remota:

1. Abra **Workers & Pages** → `curtiz-ecommerce` → **Settings → Builds**.
2. Se houver um repositório conectado, use **Disconnect**.
3. Repita em `curtiz-painel`.

Um Workers Build conectado publica uma segunda versão a cada push, fora da ordem e **sem** os gates
do workflow (qualidade, banco, E2E, segurança). Em 30/09/2026 isso estava acontecendo: os checks
`Workers Builds: curtiz-ecommerce` e `Workers Builds: curtiz-painel` publicavam com sucesso enquanto o
CI falhava, e o job de deploy do Actions ficava `skipped`. Não inicie builds nem publicações manuais
pelo Cloudflare. Para reconstruir um Worker, use `workflow_dispatch` e selecione `store`, `panel` ou
`both`.

A conexão Git do Cloudflare é uma configuração **remota**: nenhum arquivo deste repositório consegue
ligá-la ou desligá-la, e `scripts/ci-workflow.test.ts` só garante que o próprio repositório tenha um
único workflow de deploy e mantenha este checklist. Sinais de que o Workers Builds voltou a publicar:
um check `Workers Builds: …` no commit, ou `/api/version` mostrando um `commit` diferente do SHA
publicado pelo Actions (deploys do Workers Builds não atualizam `GIT_COMMIT_SHA`/`BUILD_ID`).

### Onde cada configuração fica

| Local | Responsabilidade |
| --- | --- |
| GitHub Actions | build, deploy, metadados (`GIT_COMMIT_SHA`, `BUILD_ID`, `BUILD_TIMESTAMP`), URLs públicas e configuração de plataforma embutida no build |
| Runtime do Cloudflare (Variables and Secrets de cada Worker) | flags e credenciais de integrações (checkout, Mercado Pago, Melhor Envio, e-mail, Turnstile), dados do remetente, `REQUIRE_INTERNAL_MFA` e `AUTH_RATE_LIMIT_ENABLED` |
| Supabase | tokens OAuth do Melhor Envio, gravados cifrados |

Os jobs compilam com checkout e integrações externas desativados de propósito
(`CHECKOUT_ENABLED=false`, `PAYMENT_PROVIDER=disabled`, `MERCADO_PAGO_ENABLED=false`,
`SHIPPING_PROVIDER=disabled` e `MELHOR_ENVIO_ENABLED=false`). O build não recebe Client Secret,
chave de criptografia, documentos nem endereço do remetente. Esses valores servem somente para
compilar e validar e **não** são enviados ao Worker.

A publicação usa `wrangler deploy --keep-vars` e envia por `--var` apenas os metadados e a
configuração de plataforma (`APP_ENV`, `PANEL_DEPLOYMENT_MODE`, `DEMO_MODE`, `ALLOWED_ORIGINS`,
`AUTH_COOKIE_DOMAINS`, URLs `NEXT_PUBLIC_*`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` e, na loja,
as chaves públicas `NEXT_PUBLIC_TURNSTILE_SITE_KEY` e `NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY`).
Valores vazios nunca são enviados, então nenhum binding existente é substituído por string vazia.
Qualquer outra variable ou secret cadastrado no Runtime é preservado. O Worker da loja lê os
bindings em cada requisição por `getCloudflareContext().env` (`getStoreRuntimeEnvironment()`), e
eles prevalecem sobre as flags desativadas do build. O teste `scripts/ci-workflow.test.ts` impede
que o workflow volte a sobrescrever essas configurações.

Configure no GitHub, em **Settings → Secrets and variables → Actions**:

- secrets: `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID`;
- variables: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` e `DEMO_MODE`;
- variables condicionais: `NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY` quando o Mercado Pago estiver
  habilitado e `NEXT_PUBLIC_TURNSTILE_SITE_KEY` quando o Turnstile estiver habilitado. Por serem
  embutidas no bundle do navegador durante o build, essas chaves públicas continuam no GitHub.

Não duplique no GitHub `CHECKOUT_ENABLED`, `PAYMENT_PROVIDER`, `MERCADO_PAGO_*`,
`SHIPPING_PROVIDER`, `MELHOR_ENVIO_*`, `EMAIL_*`, `TURNSTILE_ENABLED`, `REQUIRE_INTERNAL_MFA` nem
`AUTH_RATE_LIMIT_ENABLED`. O workflow ignora essas variables, que podem ser apagadas do GitHub
depois de conferidas no Runtime do Worker. Client Secret, chave de criptografia, CNPJ e outros
dados sensíveis nunca devem ir para GitHub Variables.

O token Cloudflare deve ter somente as permissões necessárias para publicar os dois Workers na
conta correta. Não armazene tokens em variables públicas.

As quatro URLs públicas, `ALLOWED_ORIGINS` e `AUTH_COOKIE_DOMAINS` ficam juntas no `env` versionado
de `.github/workflows/ci.yml`. Os dois jobs herdam os mesmos valores e os publicam na lista de
bindings já existente. GitHub Variables antigas com esses seis nomes não são mais lidas; uma
lista remota desatualizada não pode divergir do alias compilado. Pull requests compilam com essas
URLs públicas reais e com as credenciais efêmeras já previstas, sem publicar.

Antes do build, o workflow consulta somente os **nomes** dos secrets já presentes em cada Worker.
Ele exige `SUPABASE_SECRET_KEY`, `PII_ENCRYPTION_KEY`, `AUDIT_HASH_KEY`,
`ACCOUNT_DELETION_HMAC_KEY`, `RATE_LIMIT_HMAC_KEY` e `REFERRAL_ATTRIBUTION_HMAC_KEY` (o painel exige
somente os que utiliza). As flags das integrações ficam no Runtime, então o CI não as conhece e não
valida credenciais de integrações. Essa checagem acontece no runtime: `getMelhorEnvioReadiness()`, o
`integration_health` (`melhorenvio_store`) e a resposta 503 explícita da cotação de frete apontam
configuração incompleta sem cair em valor fixo. Valores secretos não são copiados para o GitHub nem
impressos. Placeholders efêmeros servem exclusivamente para permitir
que o validador de presença rode durante o build; o runtime mantém os secrets reais com
`--keep-vars`.

## Domínios públicos e aliases de teste

A origem canônica da loja é determinada somente por `NEXT_PUBLIC_STORE_URL`. O par de produção e o
par de teste devem ser configurados assim:

```dotenv
NEXT_PUBLIC_STORE_URL=https://curtiz.com.br
NEXT_PUBLIC_PANEL_URL=https://painel.curtiz.com.br
NEXT_PUBLIC_STORE_TEST_URL=https://curtiz-ecommerce.sistemas-curtiz.workers.dev
NEXT_PUBLIC_PANEL_TEST_URL=https://curtiz-painel.sistemas-curtiz.workers.dev
AUTH_COOKIE_DOMAINS=curtiz.com.br,sistemas-curtiz.workers.dev
ALLOWED_ORIGINS=https://curtiz.com.br,https://painel.curtiz.com.br,https://curtiz-ecommerce.sistemas-curtiz.workers.dev,https://curtiz-painel.sistemas-curtiz.workers.dev
```

As quatro variáveis `NEXT_PUBLIC_*_URL` são variáveis de build versionadas no GitHub Actions e devem ser
espelhadas com os mesmos valores no runtime dos dois Workers. As duas últimas são aliases, não
origens canônicas. `AUTH_COOKIE_DOMAINS` e `ALLOWED_ORIGINS` também são obrigatórias no ambiente de
build para `validate:production`: no caminho oficial, vêm do `env` versionado no workflow e são
espelhadas no runtime dos dois Workers pelo workflow. A aplicação seleciona o par correspondente ao host da requisição; isso
mantém login, logout, MFA e navegação loja/painel isolados entre produção e teste.

### Correção de origens nos builds da loja e do painel

Se `scripts/validate-production.ts` informar `ALLOWED_ORIGINS deve incluir NEXT_PUBLIC_PANEL_TEST_URL`,
o valor de `ALLOWED_ORIGINS` recebido pelo **Build** não contém a origem exata da URL de teste do
painel. `curtiz-panel` e `curtiz-painel` são Workers e origens distintos: adicionar um não autoriza
o outro. O Worker oficial confirmado é `curtiz-painel`, também usado pelo domínio de produção;
o Wrangler de produção e o workflow estão alinhados com esse nome. O Worker legado
`curtiz-panel` não é incluído na allowlist nem é removido automaticamente. O ambiente separado
de homologação conserva o nome existente `curtiz-panel-staging`.

Se o script informar ausência de `AUTH_COOKIE_DOMAINS`,
`NEXT_PUBLIC_STORE_TEST_URL` ou `NEXT_PUBLIC_PANEL_TEST_URL`, o processo de build não recebeu essas
variáveis. A falha acontece antes do OpenNext; não exige reinstalar dependências nem reduzir as
validações. Os valores corretos são os do bloco acima.

No Cloudflare, em **cada** Worker (`curtiz-ecommerce` e `curtiz-painel`), **Settings → Builds →
Build variables and secrets** configura o ambiente de compilação do Workers Builds. Corrija os
seis valores do bloco acima como texto ali, caso o build ainda esteja conectado. **Settings →
Variables and Secrets** configura o runtime: atualize as seis entradas existentes com os mesmos
valores, preservando os demais bindings. A alteração indispensável para a mensagem relatada é
`ALLOWED_ORIGINS`; `NEXT_PUBLIC_PANEL_TEST_URL` deve apontar para `curtiz-painel`, e os outros
quatro valores devem coincidir com o bloco. Não adicione variáveis separadas para cada origem.
Variáveis de runtime não alimentam automaticamente o build, e variáveis de
build não criam bindings de runtime. As URLs de teste são aliases do Worker de produção, não o
ambiente Wrangler `staging`. Confira também que `ALLOWED_ORIGINS` inclui as quatro origens acima.

Referência: [configuração de Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/).

Para conferir o comando do painel sem publicar, parta da raiz do repositório (`/`) e use
`pnpm build:worker:panel`; ele valida produção e executa `build:worker` em `apps/panel` via filtro.
`pnpm build:worker` na raiz compila a **loja**. Executar somente `pnpm build:worker` em `apps/panel`
chama o OpenNext diretamente e omite o preflight de produção da raiz. O dry-run correspondente,
após um build completo, é `pnpm deploy:dry-run:panel`.

Esse diagnóstico não habilita Workers Builds como estratégia de produção. Mantenha o GitHub Actions
como caminho único: as seis configurações públicas já estão no workflow versionado;
desconecte manualmente Workers Builds conforme o checklist
acima e use **Actions → CI → Run workflow**, branch `main`, target `both`, quando for publicar.
Não use **Retry build** no Cloudflare: um build bem-sucedido pode acionar o deploy concorrente.

O plano Free permite **64 variáveis por Worker, somando texto e secrets**. Os valores de Build
não precisam ser copiados integralmente para Runtime: flags usadas apenas para compilar,
`DEPLOY_TARGET`, credenciais efêmeras do CI e credenciais de deploy não são bindings adicionais.
Esta correção altera nomes/valores já usados; a lista de bindings enviados pelo Actions permanece
com 16 nomes na loja e 14 no painel, incluindo metadados. Os demais bindings de Runtime e secrets
são preservados por `--keep-vars` e também contam no limite total. Não é possível confirmar o total
cadastrado sem acesso à configuração da conta; confira-o no painel antes de publicar, sem apagar
credenciais nem configurações funcionais para abrir espaço.

Referência: [limites de variáveis dos Workers](https://developers.cloudflare.com/workers/platform/limits/#environment-variables).

No Cloudflare, associe `curtiz.com.br` ao Worker `curtiz-ecommerce` e
`painel.curtiz.com.br` ao Worker `curtiz-painel` como **Custom Domains**. Não adicione essas rotas ao
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

Cada deploy injeta metadados (`GIT_COMMIT_SHA`, `BUILD_ID` e `BUILD_TIMESTAMP`) e espelha somente
as variáveis de plataforma **não secretas** do workflow e das GitHub Variables; configurações de integrações não são
tocadas. O commit ativo pode ser consultado em `/api/version`
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

`SHIPPING_PROVIDER=fixed` mantém a entrega fixa somente quando essa escolha é explícita.
`SHIPPING_PROVIDER=melhorenvio` nunca volta silenciosamente para o valor fixo: configuração,
OAuth ou cotação indisponíveis bloqueiam o checkout com opção de nova tentativa.

Para homologação, use `MELHOR_ENVIO_ENVIRONMENT=sandbox`, o host oficial derivado do ambiente,
Client ID/Secret, Redirect URI, nome da aplicação, contato técnico e uma chave AES-256 aleatória em
base64 (`MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY`). Access e refresh tokens são gravados cifrados no banco
pelo fluxo OAuth do painel técnico; não os mantenha em variáveis de ambiente. Cadastre o webhook em
`https://<loja>/api/webhooks/melhor-envio` e marque `MELHOR_ENVIO_WEBHOOK_CONFIGURED=true` depois da
configuração. O `X-ME-Signature` é validado com o Client Secret do aplicativo, conforme o contrato
oficial.

**Diagnóstico de `/api/shipping/quote`.** Toda falha devolve ao cliente apenas uma mensagem simples e
um código `FRT-XXXXXXXX` (também no cabeçalho `x-support-code`). No painel técnico, **Frete da loja**
mostra o último resultado gravado pelo Worker da loja em `integration_health`
(`melhorenvio_store`). Em **Logs técnicos**, buscar pelo código encontra o evento
`store.shipping_quote` com `request_id`. Só a linha **Frete da loja** indica se a cotação está pronta:
**OAuth do painel · Melhor Envio** e **Frete no painel** refletem o Worker do painel, que tem variáveis
próprias.

| Código | Significado |
| --- | --- |
| `shipping_provider_disabled` / `shipping_provider_unsupported` | `SHIPPING_PROVIDER` do runtime da loja não é `melhorenvio`/`fixed` |
| `melhor_envio_not_configured` | campos ausentes (lista só os nomes) |
| `melhor_envio_configuration_invalid` | campos presentes com valor inválido (ex.: `MELHOR_ENVIO_BASE_URL_INVALID`, `MELHOR_ENVIO_ENABLED_DISABLED`) |
| `store_runtime_context_unavailable` | contexto do Cloudflare indisponível na requisição |
| `store_supabase_auth_unavailable` / `shipping_rate_limit_unavailable` | Supabase Auth ou RPC `consume_private_api_rate_limit` indisponível |
| `store_service_database_unavailable` | chave de serviço do Supabase ausente no Worker da loja |
| `melhor_envio_authentication` | OAuth/token do Melhor Envio inválido ou ausente |
| `melhor_envio_timeout` / `melhor_envio_rate_limited` / `melhor_envio_provider_unavailable` / `melhor_envio_validation` | resposta do provider |
| `shipping_product_invalid` / `shipping_product_lookup_unavailable` | itens do carrinho inválidos / consulta de produtos falhou |
| `shipping_quote_persistence_unavailable` | cotação obtida, mas a gravação em `shipping_quotes` falhou |

Configure também todos os dados reais `MELHOR_ENVIO_ORIGIN_*` do remetente. Todas as
`MELHOR_ENVIO_*` e as flags `SHIPPING_PROVIDER`/`MELHOR_ENVIO_ENABLED` são cadastradas somente no
Runtime dos Workers (**Settings → Variables and Secrets**), nunca no GitHub. Use **Secret** para
`MELHOR_ENVIO_CLIENT_SECRET`, `MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY` e
`MELHOR_ENVIO_ORIGIN_DOCUMENT`/`MELHOR_ENVIO_ORIGIN_COMPANY_DOCUMENT`; os demais campos podem ser
variables. Exemplo de runtime da loja em homologação: `CHECKOUT_ENABLED=true`,
`SHIPPING_PROVIDER=melhorenvio`, `MELHOR_ENVIO_ENABLED=true` e `MELHOR_ENVIO_ENVIRONMENT=sandbox`.
Em produção, a criação
da remessa permanece em `awaiting_invoice` até existir NF-e autorizada; o sistema não fabrica chave
fiscal. Sandbox permite executar a homologação de etiquetas de teste com os produtos completos.

Não use `wrangler deploy` local nem **Workers Builds** para produção. A checagem dos secrets e a
publicação dos dois Workers pertencem ao workflow; o acionamento manual permitido é somente o
`workflow_dispatch` do próprio workflow. O script de validação consulta nomes de secrets, nunca seus
valores.

## Preflight, smoke e housekeeping

### Empacotamento final dos Workers

O build OpenNext e o empacotamento Wrangler são etapas distintas. O CI executa
`pnpm deploy:dry-run` (loja) e `pnpm deploy:dry-run:panel` (painel) depois dos builds,
inclusive em pull requests. Esses scripts verificam os assets públicos e executam
`wrangler deploy --dry-run --config wrangler.jsonc --env production --keep-vars` dentro
da aplicação correspondente. O dry-run não faz upload nem ativa uma versão.

Os filtros pnpm executam cada script em `apps/store` ou `apps/panel`, preservando os links
`workspace:*` dos nove projetos. A publicação pelo Actions parte da raiz e usa os caminhos
explícitos `apps/store/wrangler.jsonc` e `apps/panel/wrangler.jsonc`. Não publique com uma
configuração gerada ou um entrypoint diferente: a loja usa `custom-worker.ts`, que reutiliza
o HTTP do OpenNext, otimiza imagens e executa os jobs via `scheduled`; o painel usa diretamente
`.open-next/worker.js`, com seus próprios assets, imagens e produtor de fila.

Somente o Wrangler da loja possui um alias `server-only` para `worker-server-only.ts`.
Esse marcador não contém lógica de negócio: o Next.js o resolve internamente e rejeita imports
em Client Components. No segundo empacotamento, o Wrangler alcança novamente os módulos privados
pelos jobs do Worker personalizado, fora do compilador Next.js. O alias corresponde à entrada
vazia `react-server` do marcador e permite empacotar esses módulos no Worker. Nenhum import
funcional é substituído ou externalizado. Os imports `server-only`, as configurações Next.js
e as verificações de exposição de código e assets continuam ativos. Não se aplica alias ao
painel, cujo entrypoint é o Worker gerado pelo OpenNext.

Referências: [Module Aliasing do Wrangler](https://developers.cloudflare.com/workers/wrangler/configuration/#module-aliasing)
e [fronteira server/client do Next.js](https://nextjs.org/docs/app/getting-started/server-and-client-components#preventing-environment-poisoning).

`wrangler deploy` envia e ativa uma versão imediatamente, como já faz o workflow oficial.
`wrangler versions upload` apenas envia uma versão; `wrangler versions deploy` escolhe e ativa
versões previamente enviadas. Não substitua o caminho oficial por uploads do Workers Builds,
especialmente de branches Dependabot. A publicação corrigida deve partir de `main` após os
gates do CI, com Workers Builds desconectados manualmente nos dois Workers. Preserve a versão
anterior para o rollback existente e valide `/api/version`, o smoke sem cobrança e os Cron
Triggers após a publicação.

No Windows, um erro `EPERM ... symlink` durante a cópia dos arquivos pelo OpenNext impede a
geração completa do Worker, mesmo quando `next build` passou. Nesse caso, os dois builds e
dry-runs completos precisam ser confirmados no runner Linux; assets parciais não comprovam
sucesso. Se o painel falhar no Cloudflare, forneça o log desde o comando de build após a
instalação do Node até a primeira mensagem de erro, stack e código de saída, incluindo o
diretório de execução, SHA e versões Node/pnpm/Next/OpenNext/Wrangler. Não inclua valores de secrets.

O deploy da loja executa `pnpm build:worker`, que reutiliza `validate:production`. Antes de publicar,
o CI confirma os secrets do Worker e chama a RPC pública
`cart_variant_stock_availability` no Supabase remoto. Portanto, aplique a migration incremental
`202609120006_production_checkout_operations.sql` antes de liberar o commit; se ela estiver ausente,
o deploy para antes de substituir a versão ativa.

Depois da publicação, `pnpm smoke:storefront -- <URL>` valida homepage, catálogo, configuração
pública, API de versão e disponibilidade/Supabase sem criar pedido ou cobrança. A mesma verificação
pode ser executada manualmente contra a URL `workers.dev` ou o domínio canônico.

A loja possui um Cron Trigger Cloudflare a cada cinco minutos em staging e produção. O handler executa
`expire_stale_mercadopago_orders` em lote de 50 e consome até cinco jobs do Melhor Envio com claim
atômico. A expiração faz no máximo uma repetição para falha transitória; escritas logísticas externas
não são repetidas cegamente e resultados incertos ficam para reconciliação. Após o primeiro deploy,
confira em **Workers & Pages → Triggers** se o cron `*/5 * * * *` aparece e acompanhe os eventos
`checkout-housekeeping` e `melhor_envio_shipping_jobs_completed` nos logs.

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
- Aplique também `202609140009_payment_webhook_leases.sql`: deduplicação inclui reembolsos, com lease de 60 segundos e orçamento compartilhado por pagamento.
- Antes de liberar os Workers, aplique as migrations incrementais `202609140003` a `202609140009` e execute DB lint/pgTAP em banco efêmero. Elas cobrem autoridade de roles, orçamentos privados/públicos, leases de webhook, devoluções, fila de análise e cooldown de reconciliação. Rotas dependentes falham fechadas enquanto suas RPCs não estiverem disponíveis.
- A migration `202609160001_auth_rate_limit_result_contract.sql` deve ser aplicada antes do Worker da loja. O preflight exige a versão 2 do contrato; sem ela, autenticação falha com 503 em vez de transformar indisponibilidade do Supabase em um bloqueio 429 falso.
- Os novos HMACs devem ser independentes, aleatórios e ter pelo menos 32 caracteres. Não reutilize a chave de webhook ou a service role. A configuração versionada do painel agora inclui `IMAGES` em staging/produção; confirme a disponibilidade do serviço e teste upload real em staging.
- O adaptador Mercado Pago permanece restrito a `MERCADO_PAGO_ENVIRONMENT=test` e credenciais `TEST-`. Não habilite produção simplesmente trocando credenciais: o adaptador live e sua homologação ainda não estão implementados.
- A auditoria foi corrigida para Next.js/eslint-config-next `16.3.3` e versões transitivas vulneráveis via overrides restritos. OpenNext `1.20.2` e Wrangler `4.86.0` foram preservados. A instalação aponta peers WASM opcionais do resolver ESLint; lint no host não equivale à validação dessa plataforma opcional.
- No Windows, o build Next passou, mas o empacotamento OpenNext encontrou `EPERM` ao criar symlinks. Confirme os builds completos dos dois Workers no CI Linux antes de publicar; o suporte de versão declarado pelo pacote não comprova execução do Worker.
- Os jobs de segurança fazem parte dos requisitos do deploy. CodeQL/dependency review dependem das funcionalidades disponíveis no plano GitHub; a Action oficial do Gitleaks exige licença para repositórios de organizações. Configure essas permissões/licença externamente quando aplicável, sem silenciar falhas.

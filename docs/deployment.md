# Deploy

A arquitetura de referência usa dois projetos Next.js, dois Workers Cloudflare independentes e um
Supabase gerenciado por ambiente. Loja e painel precisam de nomes e rotas próprias; usar a mesma URL
para os dois impede que o roteamento distinga as aplicações.

## Validação dos ambientes

- `pnpm validate:development`: aceita URLs locais e mocks.
- `pnpm validate:staging`: exige URLs, Supabase remoto de homologação, chaves internas e origens
  permitidas. Aceita `DEMO_MODE=true`, mocks e integrações opcionais desativadas.
- `pnpm validate:production`: exige HTTPS, Supabase remoto, chaves internas, origens permitidas e
  `DEMO_MODE=false`. Mocks continuam proibidos. Pagamento, frete, e-mail, Turnstile e MFA podem ficar
  desativados por flags explícitas; suas credenciais só são exigidas quando o recurso é habilitado.

`NODE_ENV=production` seleciona otimizações do framework; não habilita integrações comerciais.

## Produção inicial com integrações desativadas

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

Não configure tokens fictícios. Com uma integração desativada, o SDK não é inicializado, nenhuma API
externa é chamada e a interface apresenta indisponibilidade comercial, sem erro técnico.

## Cloudflare Workers

Mantenha a raiz do monorepo como **Root directory** e configure as variáveis em **Settings > Build >
Variables and secrets**.

### Loja

- Root directory: `/`
- Branch de produção: `main`
- Build command obrigatório: `pnpm run build:worker`
- Deploy command: `pnpm exec wrangler deploy --keep-vars`
- Dry-run local: `pnpm run deploy:dry-run`

O `wrangler.jsonc` da raiz aponta explicitamente para os artefatos gerados em `apps/store/.open-next`.
Isso evita que a detecção automática do Wrangler tente escolher entre as duas aplicações do
monorepo. O arquivo `apps/store/wrangler.jsonc` continua sendo usado pelos scripts executados dentro
do workspace da loja.

Não deixe o **Build command** vazio no Workers Builds: o deploy usa
`apps/store/.open-next/worker.js`, gerado pelo OpenNext nessa etapa. O `wrangler.jsonc` da raiz é
deliberadamente o alvo de produção da loja; staging continua usando o script específico do
workspace.

### Painel

- Root directory: `/`
- Branch de produção: `main`
- Build command: `pnpm run build:worker:panel`
- Deploy command: `cd apps/panel && pnpm exec wrangler deploy --env production --keep-vars`
- Dry-run local: `pnpm run deploy:dry-run:panel`

Nunca configure o projeto `curtiz-painel` com Root directory `/apps/store`: isso compila e publica
a loja (`curtiz-ecommerce`) em vez da aplicação de painéis.

Os comandos de build executam a validação de produção e depois o OpenNext. Crie Workers separados,
por exemplo `curtiz-ecommerce` e `curtiz-painel`, com URLs diferentes. O domínio da loja deve preencher
`NEXT_PUBLIC_STORE_URL`; o domínio do painel deve preencher `NEXT_PUBLIC_PANEL_URL`.

Migrations somente podem ser aplicadas ao projeto remoto de homologação durante testes. Produção
exige aprovação explícita, backup verificado e pipeline próprio; nunca execute seeds de demonstração.

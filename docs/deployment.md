# Deploy

Referência: dois projetos Next.js, Supabase gerenciado e dois Workers Cloudflare independentes.
Crie ambientes local, staging e produção com projetos Supabase separados. Execute migrations por CI
após dry-run e aprovação.

## Políticas de ambiente

- `pnpm validate:development`: valida somente valores informados e aceita URLs locais e mocks.
- `pnpm validate:staging`: exige URLs, Supabase gerenciado, chaves internas e origens permitidas.
  Aceita `DEMO_MODE=true`, providers mock, MFA interno desativado e ausência de Mercado Pago e
  Turnstile. Se um provider real for selecionado, suas credenciais passam a ser obrigatórias.
- `pnpm validate:production`: exige HTTPS, providers reais, Mercado Pago, e-mail transacional,
  Turnstile, MFA interno e `DEMO_MODE=false`.

O comando `pnpm build` continua sendo estritamente de produção. Staging deve usar
`pnpm build:staging`; isso evita que uma variável demo ative silenciosamente uma política mais
permissiva em um build de produção.

## Cloudflare Workers Builds — staging/demo

Mantenha a raiz do repositório como **Root directory** e crie um Worker para cada aplicação.

### Loja

- Build command: `pnpm build:store:staging`
- Deploy command: `cd apps/store && npx wrangler deploy`

### Painel

- Build command: `pnpm build:panel:staging`
- Deploy command: `cd apps/panel && npx wrangler deploy`

O Wrangler detecta o Next.js e aplica o adaptador OpenNext. Configure todas as variáveis exigidas
por staging em **Settings > Build > Variables and secrets**, pois o Next.js precisa delas durante o
build. Use nomes de Worker e domínios distintos para loja e painel.

Para produção real, troque os comandos de build direcionados por:

- Loja: `pnpm validate:production && turbo build --filter=@curtiz/store`
- Painel: `pnpm validate:production && turbo build --filter=@curtiz/panel`

Os comandos de deploy permanecem os mesmos. A configuração de produção falha quando encontra demo,
providers mock, HTTP, MFA interno desativado ou secrets essenciais ausentes.

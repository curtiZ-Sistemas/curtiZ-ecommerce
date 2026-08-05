# Curtiz Commerce

E-commerce e plataforma operacional da curti Z. O repositório contém uma loja pública, um painel interno por perfis, domínio compartilhado e infraestrutura Supabase versionada.

## Aplicações

- `apps/store` — loja em `http://localhost:3000`.
- `apps/panel` — painel em `http://localhost:3001`.
- `supabase` — PostgreSQL, Auth, Storage, Realtime, Edge Functions, migrations, seed e testes RLS.

## Requisitos

- Node.js 20.9 ou superior.
- pnpm 10.
- Docker Desktop é opcional e necessário somente para executar o Supabase local.
- Supabase CLI é usada somente nos fluxos de banco local.

## Instalação

```bash
pnpm install
copy .env.example .env.local
pnpm dev
```

Sem Docker ou credenciais, configure `DEMO_MODE`, `DEMO_USERS_PASSWORD` e
`DEMO_SESSION_SECRET` nos dois projetos Next.js. A autenticação demo funciona apenas em loopback,
e os mocks são identificados. Nenhum pagamento, e-mail, frete, WhatsApp ou ERP é apresentado como
integração real.

Para trabalhar com Supabase gerenciado, informe as URLs e chaves públicas/privadas nos ambientes
corretos. Para quem optar pelo Supabase local, os comandos continuam disponíveis, mas não fazem
parte da execução padrão:

```bash
pnpm supabase:start
pnpm supabase:reset
pnpm supabase:types
```

## Segurança e dados demo

- RLS é default-deny em todas as tabelas expostas.
- Service role e secrets nunca entram no bundle do navegador.
- O suporte humano entra sempre na fila do Administrador.
- O Operacional só lê chamados transferidos nominalmente.
- Notas internas e anexos privados possuem políticas próprias.
- `DEMO_MODE=true` ou providers mock bloqueiam builds de produção.

As políticas são executadas separadamente:

```bash
pnpm validate:development
pnpm validate:staging
pnpm validate:production
```

`pnpm build` permanece equivalente ao build de produção. Para demonstração hospedada use
`pnpm build:staging`; a versão de staging continua exigindo Supabase gerenciado, chaves internas,
URLs públicas e origens permitidas.

Para criar contas locais:

```bash
DEMO_USERS_PASSWORD="uma-senha-forte-local" pnpm seed:demo
```

O comando falha em produção. Sem a variável, gera e exibe uma senha apenas no terminal.

## Qualidade

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:db
pnpm test:e2e
pnpm build:local
```

No Windows desta estação, o binário Turbo pode encontrar `spawn UNKNOWN`; use `pnpm -r --workspace-concurrency=1 <comando>` como alternativa sequencial.

## Produção

Use dois deployments Next.js independentes, Supabase gerenciado e Cloudflare na borda. Configure todas as variáveis da `.env.example`, MFA interno, Turnstile e providers reais. Nunca exponha o stack Supabase local à internet.

Consulte `docs/deployment.md` para os comandos exatos de staging e produção na Cloudflare e os
demais runbooks e decisões em `docs/`.

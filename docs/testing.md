# Testes

O fluxo padrão deste computador não usa Docker nem Supabase local.

## Sem Docker

- `pnpm test`: domínio, segurança, configuração e integrações.
- `pnpm test:components`: componentes React.
- `pnpm test:db:mock`: cliente Supabase completo em memória, incluindo Auth, consultas, mutações,
  Storage e erros injetados.
- `pnpm test:db:static`: invariantes estáticas de migrations, RLS, `search_path`, idempotência e
  buckets privados.

## Supabase remoto de homologação

Testes reais de migrations, RLS, concorrência, Auth, Storage, RPCs e Edge Functions só podem usar o
projeto remoto de homologação identificado nas variáveis do ambiente de teste. O executor deve
recusar URLs ou referências do projeto de produção. Esses testes não rodam automaticamente no build.

## Indisponível sem Docker

`supabase db reset` e pgTAP local não são executados neste computador. Os arquivos pgTAP permanecem
versionados para CI isolada ou homologação autorizada.

Testes de carga são exclusivos de ambiente local compatível ou homologação. Nunca apontar carga,
seed ou testes destrutivos para produção.

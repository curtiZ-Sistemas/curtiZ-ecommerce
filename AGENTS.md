# Curtiz — regras de desenvolvimento

## Arquitetura

- Monorepo pnpm/Turborepo. Loja em `apps/store`, painel em `apps/panel`.
- Supabase é a fonte de verdade. Toda alteração de banco precisa de migration versionada.
- Operações sensíveis são validadas no servidor e por RLS; esconder controles no frontend não é autorização.
- Integrações usam contratos em `packages/integrations`; mocks são permitidos apenas fora de produção.
- Dinheiro nunca usa `number` fracionário em cálculos de domínio: use centavos inteiros.
- Datas são UTC no armazenamento e `pt-BR`/`America/Sao_Paulo` na interface.

## Segurança

- Nunca registrar senhas, tokens, cookies, CPF completo, cartões ou payloads pessoais.
- Nunca importar service role em módulos que possam entrar no bundle do navegador.
- Funções SQL privilegiadas usam `security definer` e `set search_path`.
- Toda tabela exposta ao Data API usa RLS default-deny.
- Atendimento humano sempre entra na fila do Administrador. Operacional só recebe transferência explícita.
- Notas internas do suporte nunca podem ser retornadas ao cliente.

## Qualidade

- Antes de concluir uma fase: `pnpm lint`, `pnpm typecheck`, `pnpm test` e build relevante.
- Componentes precisam funcionar com teclado, zoom e leitores de tela.
- Não criar botão sem ação, status fictício de integração ou dado demonstrativo apresentado como real.
- Preserve módulos existentes; use migrations incrementais e não altere migrations já aplicadas.

## Comandos

- `pnpm dev`: loja em 3000 e painel em 3001.
- `pnpm supabase:start`: inicia Supabase local (requer Docker).
- `pnpm supabase:reset`: reaplica migrations e seed.
- `pnpm seed:demo`: cria contas demo somente fora de produção.
- `pnpm check`: lint, tipos, testes e build local.

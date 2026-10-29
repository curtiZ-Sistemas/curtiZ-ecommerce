# Correções da revisão fiscal do PR84 — 24/10/2026

Concluído e validado em 25/10/2026, sem publicação.

Base desta correção: `bf41c24ea86def957c8ddf819dac2221dfcb602e` (main com PR84).
Revisão original: `8d3e56ee96e87806f9e6e57b8aee2d1696581409`.

## Achado 1 — P2: devolução parcial pode ignorar o desconto original

- Arquivo/linhas na revisão: `packages/integrations/src/bling-fiscal-preview.ts:137–145`.
- Reprodução: uma linha com dois pares de R$10, desconto de R$10, sem frete/acréscimos,
  total líquido R$10. Devolver um par com `discountInCents: 0` era aceito com total
  R$10, em vez da parcela líquida R$5. Reproduzido localmente em memória na revisão.
- Causa: só eram verificados os limites globais de cada ajuste e do total da nota;
  não havia vínculo dos ajustes com as linhas/quantidades devolvidas.
- Impacto: prévia parcial superavaliada; não é evidência de emissão ou reembolso,
  pois a função continua não transmissível e não movimenta dinheiro/estoque.
- Correção: validar a alocação contra os ajustes por linha da nota original
  verificada. Não reconstruir o rateio a partir de preços atuais. Sem esses dados,
  bloquear a parcial que tenha ajustes. Fracionamento subcentavo exige conferência
  adicional em vez de inventar arredondamento. Devolução total mantém os totais
  originais, sem depender de novo rateio.

## Achado 2 — P2: cenário101 ainda exige taxa fixa antiga

- Arquivos/linhas: migration nova do PR84
  `supabase/migrations/20261024200616_bling_monthly_credit_and_return_policy.sql:2,30–40`
  não substituiu o requisito da migration anterior
  `20261024144559_bling_accountant_resale_policy.sql:10–18`.
- Reprodução: configurar `resale_in_state_credit` com CFOP5102, CSOSN101, impostos
  principais zero e `icms_credit_rate: null`, usando somente o cadastro mensal.
  A constraint `bling_resale_tax_contract` rejeita a linha, mesmo com aprovação
  mensal válida. O teste anterior escondia isso preenchendo a taxa fixa1,25.
- Causa: a leitura passou a usar a aprovação mensal, mas o contrato de escrita
  continuou exigindo o campo sem competência.
- Impacto: impede parametrizar101 apenas com sua fonte mensal e exige dado legado
  redundante. Não permite crédito sem aprovação mensal: o seletor já o bloqueia.
- Correção: migration incremental remove somente a obrigatoriedade da taxa fixa
  no cenário101, preservando as demais condições, dados, grants/RLS, séries e gates.
  Valores legados permanecem históricos; não autorizam crédito.

## Limites de integração e publicação

- Os ajustes por linha devem vir do XML/documento original autorizado e conferido.
  Ainda não existe carregamento desse arquivo para o helper de devolução. O
  endpoint de catálogo não comprova valores da nota original; não é devolução
  operacional concluída. Não conectá-lo usando preço atual ou dados do navegador.
- A verificação de devoluções anteriores/saldo e a reserva transacional são
  requisitos antes de qualquer execução real. Este helper só calcula uma prévia.
- Crédito101 continua sem fluxo operacional de bases por item conferidas, sem
  taxa contábil produtiva inventada e sem integração de transmissão. IE, regime,
  finalidade e data declarados pelo operador não substituem prova cadastral.
- Não liberar entradas reais/devolução parcial ou101 com base nestas prévias.
  Bloqueios fiscais existentes devem permanecer; a correção não exige interromper
  B2C já validado. Nenhuma flag, credencial, série ou número produtivo foi alterado.
- Somente o isolado autorizado pode receber a migration nesta tarefa. Aplicação
  ao original, push, PR, merge e deploy cabem ao agente principal após sua validação.

## Validações

- Regressão de devolução: antes da correção, cinco dos novos testes falharam;
  depois, os dez testes de devolução passaram.
- Regressão SQL no isolado `cfendaazxctjmzpimadn`: `lives_ok` do cenário101 com
  taxa antiga nula falhou com23514/`bling_resale_tax_contract` antes da migration.
- Migration incremental `20261025111315_bling_monthly_credit_legacy_rate_optional.sql`
  aplicada somente ao isolado autorizado. Substitui uma constraint em um único
  ALTER; nenhuma migration histórica foi alterada.
- `bling_monthly_credit_test.sql`:23 verificações aprovadas com `finish(true)` e
  `rollback`, incluindo constraints negativas, RLS/grants, histórico imutável,
  consumo da última revisão e preservação dos cenários sem crédito.
- Hash de todas as linhas de regras fiscais idêntico antes/depois da migration e
  dos testes. Cadastro mensal continua com RLS forçada e sem INSERT de runtime.
- 87 testes aprovados em seis arquivos (devolução, revenda, competência mensal,
  impostos, espelho fiscal e desmembramento de kits), com um worker.
- Lint dos três arquivos TypeScript alterados: aprovado.
- Typecheck completo de `@curtiz/integrations`, estrito e sem incremental: aprovado.
- Testes, lint e typecheck executados sequencialmente, com heap máximo de768MB.
- Advisors consultados no isolado. O INFO de RLS sem policy na tabela mensal é
  compatível com acesso direto negado/grants revogados, comprovados pelos testes.
  Há alertas sobre views/funções não alteradas por este diff; não se declara uma
  auditoria global nem a eliminação desses alertas nesta tarefa.
- Nenhuma execução de emissão, pagamento, etiqueta ou e-mail; nenhuma alteração
  no banco original. Sem build local, push, PR, merge ou deploy.

## Arquivos para coordenação

Branch `fix/fiscal-review-findings-20261024`, worktree
`.cache/worktrees/fiscal-review-fixes-20261024`, alterações locais sem commit.

- `packages/integrations/src/bling-fiscal-preview.ts`: validação dos ajustes
  originais por linha e bloqueio explícito de rateio subcentavo.
- `packages/integrations/src/bling-return-preview.test.ts`: reprodução e casos
  positivos/negativos de desconto, frete, acréscimos, arquivo ausente e centavos.
- `packages/integrations/src/bling-resale-policy.test.ts`: taxa legada nula com
  aprovação mensal válida continua selecionando101; sem mensal continua bloqueado.
- `supabase/migrations/20261025111315_bling_monthly_credit_legacy_rate_optional.sql`:
  remoção da exigência legada preservando o restante do contrato.
- `supabase/tests/bling_monthly_credit_test.sql`: regressão e proteções SQL.
- Este relatório: achados completos, limites e evidências.

Diff completo entregue em `.cache/validation/fiscal-review-findings.patch` dentro
desta worktree. O agente principal deve conferir o main que estiver vigente,
aplicar a migration no original somente na etapa coordenada e executar o CI.

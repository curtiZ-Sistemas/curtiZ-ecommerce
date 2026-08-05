# Plano de implementação curti Z

**Fonte principal:** `AUDITORIA_COMPLETA_CURTIZ.md`  
**Início:** 1 de agosto de 2026  
**Regra de execução:** nenhuma operação com Docker/Supabase local e nenhuma leitura ou mutação no banco de produção. Integrações reais e testes remotos só usarão homologação explicitamente configurada.

## Estados

- `pendente`: ainda não iniciado.
- `em andamento`: código em alteração, sem validação final.
- `corrigido`: implementação concluída, aguardando validação completa.
- `validado`: testes proporcionais ao risco concluídos.
- `bloqueado`: depende de credencial, infraestrutura ou decisão externa.
- `adiado`: evolução P4 ou item conscientemente postergado.

## Dependências críticas

1. Domínios distintos para loja e painel, com domínio de cookie compartilhável e configurado por ambiente.
2. Supabase remoto de homologação para migrations, Auth, AAL2, Storage, concorrência e RLS reais.
3. Segredos separados para staging e produção; nenhum segredo será colocado no repositório.
4. Cloudflare Workers separados (`curtiz-ecommerce` e `curtiz-painel`).
5. Providers comerciais permanecem opcionais por flags; mocks são exclusivos de development/staging.

## Riscos e decisões

- A autenticação entre dois hosts será resolvida com cookie SSR compartilhado por domínio configurável, validação do usuário no painel e default-deny. O deploy deve usar hosts sob o mesmo domínio registrável; caso contrário será necessário um fluxo posterior de token exchange de uso único.
- Dados financeiros, estoque e comissões somente serão mutados por funções transacionais com idempotência; até isso existir, fluxos inseguros ficam indisponíveis.
- Migrations serão incrementais e não modificarão migrations já existentes.
- Sem Supabase de homologação autorizado, migrations e RLS podem ser validadas estaticamente e com mocks, mas permanecem `bloqueado` para validação comportamental real.
- Dados demo serão identificados no payload/interface e não serão tratados como indicadores reais.

## Fase 1 — segurança, autenticação, RLS, staging e deploy

**Status:** em andamento

- [x] AUD-001 — guard server-side do painel com sessão, status, papel e permissão (`validado`).
- [x] AUD-002 — sessão SSR compartilhada entre loja e painel por domínio seguro (`corrigido`; validação remota pendente).
- [x] AUD-003 — RPC transacional idempotente por itens, preço server-side, estoque e auditoria (`corrigido`; PostgreSQL staging pendente).
- [x] AUD-014 — permitir demo remoto somente em hosts de staging autorizados (`validado`).
- [x] AUD-015 — separar ambiente comercial de `NODE_ENV` nos mocks (`validado`).
- [x] AUD-017 — aplicar AAL2 quando MFA interno estiver habilitado (`corrigido`; Auth staging pendente).
- [x] AUD-018 — rate limit e Turnstile server-side controlados por flags (`corrigido`; staging pendente).
- [x] AUD-033 — migration incremental com FORCE RLS nas tabelas novas (`validado` estaticamente).
- [x] AUD-040 — HSTS de produção e CSP de scripts por nonce/`strict-dynamic` (`corrigido`; navegador staging pendente).
- [x] Scripts `validate/build/deploy` separados para staging e produção.
- [x] Testes locais: auth demo, papéis, staging/env, integrações, RLS estática, lint e tipos.

**Migrations previstas:** hardening RLS; RPC de venda idempotente; tabelas/índices de rate limit ou auditoria somente se o mecanismo não puder usar Cloudflare.

## Fase 2 — fluxos principais, dados, ações e arquivos

**Status:** pendente

- [ ] AUD-004 — checkout transacional e providers honestos.
- [ ] AUD-005 — catálogo/carrinho/favoritos na fonte real e merge de visitante.
- [x] AUD-011 — DTO real de representante normalizado (`corrigido`); contract test remoto continua bloqueado.
- [ ] AUD-013 — rota pública de indicação com atribuição segura.
- [ ] AUD-016 — magic bytes e limites implementados; quarentena/reprocessamento e downloads seguros continuam `em andamento`.
- [ ] AUD-020 — factories/adapters de integrações e health.
- [ ] AUD-025 — recuperação de senha e rastreamento funcionais.
- [ ] AUD-026 — conteúdo institucional conectado ao CMS.
- [ ] AUD-029, AUD-030 e AUD-036 — jobs, webhooks e outbox de notificações.
- [ ] AUD-032 — tipos Supabase completos gerados por pipeline seguro.
- [ ] AUD-038 e AUD-039 — catálogo/busca/sitemap reais.

**Migrations previstas:** carrinho visitante, funções de reserva/checkout, outbox, referral attribution, índices FTS e policies correspondentes.

## Fase 3 — áreas completas por perfil

**Status:** pendente

- [ ] AUD-006 e AUD-022 — Cliente.
- [ ] AUD-007 — Operacional.
- [ ] AUD-008 — Administrador.
- [ ] AUD-009 — Gerência.
- [ ] AUD-010 e AUD-037 — Técnico.
- [ ] AUD-021 — Representante.
- [ ] AUD-027, AUD-028 e AUD-047 — substituir controles e dashboards visuais por módulos reais/estados vazios.

Cada módulo terá autorização server-side, validação Zod, loading, erro, sucesso, prevenção de duplicidade, paginação e auditoria conforme risco.

## Fase 4 — representantes, kits, rede, comissões e criativos

**Status:** pendente

- [ ] AUD-012 — ciclo comercial de representante.
- [ ] Kits, composição, pedidos, recebimento e estoque auditável.
- [ ] Níveis, regras, qualificação, metas e histórico configuráveis.
- [ ] Rede de indicação sem ciclos, autoindicação ou troca indevida.
- [ ] Vendas válidas, comissão, estorno, fechamento e pagamentos.
- [ ] AUD-023 e AUD-024 — criativos/campanhas completos.
- [ ] AUD-031 — seleção explícita de contexto para contas multi-role.
- [ ] AUD-035 — persistência demo compatível com Workers ou homologação isolada.

**Migrations previstas:** funções transacionais e índices adicionais, sem duplicar as tabelas existentes de representantes/criativos.

## Fase 5 — UI, UX, mobile, acessibilidade e performance

**Status:** pendente

- [ ] AUD-019 corrigido por contenção; AUD-046 e validação visual da matriz continuam pendentes.
- [ ] AUD-041 — substituir originais pesados por assets otimizados.
- [ ] AUD-042 — dividir portal do representante e reduzir refetch.
- [x] AUD-043 — loading/skeleton acessível do painel (`validado` por lint/typecheck).
- [ ] AUD-048 — feedback para mouse, teclado, router e formulários.
- [ ] AUD-049 — Escape, restauração de foco e testes do chat.
- [ ] Design consistente em 320, 360, 375, 390, 430, tablet, notebook e desktop.

Antes desta fase serão usados `docs/design-direction.md`, `docs/design-system.md`, `docs/ui-ux.md` e `docs/ui-ux-audit.md`, pois os arquivos citados no `AGENTS.md` (`design-guidelines.md` e `mobile-ux.md`) não existem no repositório.

## Fase 6 — testes, documentação e deploy

**Status:** pendente

- [ ] AUD-034 — pgTAP/RLS real em homologação autorizada; bloqueado sem acesso remoto.
- [ ] AUD-044 — estabilizar Playwright e teardown dos servidores.
- [ ] AUD-045 — matriz mobile de todos os perfis.
- [ ] AUD-050 — gates de acessibilidade, Lighthouse e carga segura.
- [ ] Lint, typecheck, unitários, componentes, mocks, DB estático, E2E e builds.
- [ ] Build OpenNext/dry-run no ambiente compatível; registrar limitação Windows quando aplicável.
- [ ] Atualizar auditoria, segurança, testes, deploy, runbooks e variáveis.
- [ ] Commits organizados por fase, sem `.env` nem credenciais.

## P4 — preparação arquitetural

- [ ] AUD-051 — manter contrato WhatsApp, factory `disabled/mock` e outbox preparada; integração real adiada.
- [ ] AUD-052 — preservar contratos ERP/Correios/marketing e estados `not_configured`; adapters reais adiados.

## Critérios de validação por item

Um item só passa a `validado` quando:

1. implementação e autorização server-side estão presentes;
2. teste relevante passou;
3. não há erro de lint/tipo relacionado;
4. fluxo possui loading, sucesso e erro quando aplicável;
5. mobile e acessibilidade foram verificados quando houver interface;
6. migrations/RLS foram exercitadas em homologação quando o item depender de PostgreSQL real.

## Registro de progresso

| Data | Fase | Alteração | Validação | Status |
|---|---|---|---|---|
| 2026-08-01 | Planejamento | Plano criado a partir dos 52 itens da auditoria | revisão do relatório e do código existente | validado |
| 2026-08-01 | Fase 1 | Guard real, cookie SSR compartilhado, MFA, rate limit, Turnstile, RLS forçada e separação staging/produção | testes unitários/estáticos, lint e typecheck dos dois apps | em andamento |
| 2026-08-01 | Fases 2/5 | Upload com detecção de conteúdo e contenção inicial do painel mobile; skeleton do painel | testes de arquivo, lint e typecheck | em andamento |
| 2026-08-01 | Fase 1 | Venda de representante transacional, DTO real e CSP dinâmica por nonce | 63 testes, typecheck global e build development | corrigido; staging real bloqueado |

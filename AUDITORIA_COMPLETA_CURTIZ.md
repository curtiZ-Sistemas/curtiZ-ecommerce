# Auditoria Completa — curtiZ

**Data da revisão:** 8 de agosto de 2026
**Escopo verificado:** monorepo, loja, painéis, Supabase, APIs, integrações, Cloudflare e testes.
**Referência de código:** branch `agent/fix-panel-data-access`, revisão pós-auditoria ainda não implantada. A `main` remota e a produção estavam em `a95dc7b`; as migrations `006`, `009`, `010` e `011`–`015` ainda precisam ser aplicadas e validadas no Supabase de produção.

## 1. Resumo executivo

O projeto deixou de ser um protótipo visual. Loja, conta do cliente, portal do representante e painéis administrativo, operacional, gerencial e técnico possuem rotas, APIs e regras de autorização reais. Há uma base sólida de RLS, funções privilegiadas com `search_path` fixo, CSP com nonce, validação de ambiente, separação entre Workers e uma suíte automatizada relevante.

O sistema, porém, **não está pronto para operação comercial em produção**. O principal bloqueio continua sendo a divergência entre o schema esperado pelo código e o Supabase implantado. A revisão adicionou uma baseline de permissões independente do seed e reload do Data API, mas ela ainda não foi aplicada em produção. Checkout continua sem criar pedido/pagamento real. Recuperação de senha, enumeração de contas, fallback demonstrativo, privacidade pública, consentimento, E2E/CI, foco e convenções de runtime foram corrigidos no código.

### Notas

| Área | Nota | Síntese |
|---|---:|---|
| Segurança | 7,5 | Enumeração, rate limit, privacidade e fronteiras financeiras foram endurecidos; falta validação remota das migrations/RLS. |
| Funcionalidade | 6,0 | Grande cobertura funcional; painéis dependem da aplicação das migrations e checkout real permanece bloqueado. |
| UI | 8,0 | Identidade consistente, componentes responsivos e estados visuais abrangentes. |
| UX | 7,5 | Fluxos claros, consentimento falha com segurança e o E2E cobre navegação crítica; produção ainda remove ações quando o banco falha. |
| Acessibilidade | 7,5 | Foco do chat e feedback por teclado foram corrigidos e entraram no E2E do CI. |
| Performance | 7,0 | Métrica crítica foi agregada no banco e há budget de assets; mídia e snapshots amplos permanecem. |
| Arquitetura | 7,0 | Separação store/panel/packages é adequada; tipos de banco e módulos muito extensos reduzem confiabilidade. |
| Qualidade de código | 7,0 | TypeScript, Zod, lint e testes passam; contratos de banco ainda usam tipos genéricos. |
| Testes | 8,0 | Lint, tipos, builds, suíte automatizada e 35 cenários E2E foram validados; pgTAP real ainda depende de Supabase local/homologação. |
| Prontidão para produção | 5,5 | Schema implantado e checkout/pagamento real ainda impedem lançamento comercial. |

### Principais riscos

1. Divergência de schema/privilégios mantém todos os painéis internos inutilizáveis em produção (AUD-P1-001).
2. Checkout não constitui um fluxo real e a integração Mercado Pago endurecida ainda precisa de validação no sandbox do provedor (AUD-P1-005 e AUD-P1-006).
3. Quarentena de anexos e tipos reais do banco dependem de infraestrutura não disponível nesta execução (AUD-P2-001 e AUD-P2-004).

## 2. Métricas da auditoria

| Severidade | Quantidade |
|---|---:|
| P0 — Crítico | 0 |
| P1 — Alto | 3 |
| P2 — Médio | 4 |
| P3 — Baixo | 3 |
| **Total atual** | **10** |

**Base inicial:** 19 achados. **Resolvidos nesta revisão:** 9. **Restantes:** 10.

## 3. Problemas críticos — P0

Nenhum P0 foi confirmado. Existem bloqueios graves de operação, classificados como P1 porque não foi demonstrado comprometimento amplo, corrupção ou perda de dados.

## 4. Problemas altos — P1

### [AUD-P1-001] Schema e privilégios de produção incompatíveis com os painéis

**Severidade:** P1
**Área:** Supabase, RLS, painéis, deploy
**Confiança:** Alta
**Status:** Correção de código concluída; bloqueado pela aplicação/validação das migrations em produção.

**Problema**

O Supabase de produção não corresponde ao schema consumido pelas APIs. Consulta segura e somente leitura confirmou `42501 permission denied` em dezenas de tabelas usadas pelos painéis e `PGRST205` para as cinco tabelas da Central de Ajuda. A API operacional também encontra, na versão implantada, a relação ambígua `orders → shipments`. O código da branch contém a migration `010` e a desambiguação, mas a `main`, o Worker e o banco de produção ainda não receberam a correção.

**Evidência**

- `supabase/migrations/202608080006_help_center_reform.sql`: define `help_contents`, versões, relações, buscas e feedbacks, ausentes no Data API consultado.
- `supabase/migrations/202608080009_product_management_stability.sql`: a produção acusou política de Storage já existente após execução parcial.
- `supabase/migrations/202608080010_panel_data_access_stability.sql`: restaura privilégios e exige a migration `006`; ainda não aplicada em produção.
- `supabase/migrations/202608080014_panel_permission_baseline.sql`: move as permissões essenciais dos papéis internos do seed para uma migration idempotente de produção.
- `apps/panel/src/app/api/operations/route.ts`: a branch já usa `shipments!shipments_order_id_fkey`; a versão de produção ainda não.
- Comportamento observado: `/api/operations` retorna 503 e os painéis exibem “Não foi possível carregar...”, sem ações dependentes dos dados.

**Impacto**

Administrador, Operacional, Gerencial e Técnico não conseguem consultar nem executar rotinas. O problema bloqueia catálogo, estoque, pedidos, atendimento, relatórios e configurações, embora a interface renderize.

**Como reproduzir/verificar**

Autenticar um usuário interno real e abrir qualquer área que dependa das APIs do painel. Confirmar 503 na rede. No Data API, testar acesso às tabelas da API operacional e presença de `help_contents` sem retornar dados sensíveis.

**Correção recomendada**

Integrar e publicar a branch validada; aplicar, em ordem, `006`, `009`, `010` e `011`–`015`; aguardar o reload do PostgREST; validar cada papel com conta real e depois executar regressão de RLS. Não desabilitar RLS nem substituir os dados por mocks.

**Áreas afetadas**

Todos os painéis internos, produtos, estoque, pedidos, atendimento, jurídico, home builder e indicadores.

## 4.1 Correções P1 concluídas nesta revisão

### [AUD-P1-002] Recuperação de senha é rejeitada pelo rate limit do banco

**Severidade:** P1
**Área:** Autenticação
**Confiança:** Alta
**Status:** Resolvido pela migration `202608080011_auth_rate_limit_recovery.sql`; testes estáticos e de configuração aprovados.

**Problema**

A rota de recuperação usa o escopo `password_reset`, mas a constraint e a função SQL aceitam apenas `login` e `signup`. Em produção, o RPC lança erro; o helper interpreta a falha como bloqueio e a rota responde 429.

**Evidência**

- `apps/store/src/app/api/auth/password/route.ts`: chama `enforceAuthRateLimit` com `password_reset`.
- `apps/store/src/lib/auth-rate-limit.ts`: falha do RPC resulta em acesso negado.
- `supabase/migrations/202608010001_security_hardening.sql`: constraint e validação `p_scope not in ('login', 'signup')`.
- Nenhuma migration posterior adiciona `password_reset`.

**Impacto**

Usuários que esqueceram a senha não conseguem recuperar a conta.

**Como reproduzir/verificar**

Solicitar recuperação para um e-mail válido em ambiente não-demo e observar resposta 429 antes do envio do e-mail.

**Correção recomendada**

Adicionar o escopo em migration incremental, com limite próprio e teste de integração para sucesso, abuso e falha do Supabase.

### [AUD-P1-003] Login permite enumeração de contas e rate limit adicional é opcional

**Severidade:** P1
**Área:** Segurança, autenticação
**Confiança:** Alta para o código; média para a flag implantada
**Status:** Resolvido. Login agora responde de forma uniforme, a consulta de existência foi removida e o rate limit é obrigatório em produção.

**Problema**

O login consulta `profiles.email_snapshot` com chave secreta e responde `404 user_not_found` quando o endereço não existe, enquanto credenciais erradas de uma conta existente retornam `401 invalid_credentials`. Isso cria um oráculo confiável de existência. A proteção de aplicação contra força bruta só funciona quando `AUTH_RATE_LIMIT_ENABLED=true`; a variável não está documentada nem exigida pela validação de produção.

**Evidência**

- `apps/store/src/lib/supabase/account-existence.ts`: busca server-side por e-mail.
- `apps/store/src/app/api/auth/[mode]/route.ts`: diferencia `user_not_found` de `invalid_credentials`.
- Mesma rota: rate limit condicionado a `AUTH_RATE_LIMIT_ENABLED`.
- `.env.example` e validadores de ambiente: a flag não é obrigatória.

**Impacto**

Atacantes podem confirmar contas e direcionar phishing ou tentativas de senha. Quando a flag estiver ausente, a camada própria de rate limit não protege o login.

**Como reproduzir/verificar**

Comparar status/código de login para um e-mail inexistente e um existente com senha errada, sem registrar os endereços usados.

**Correção recomendada**

Uniformizar status, corpo e tempo de resposta; tornar o rate limit obrigatório em produção; manter logs apenas com identificadores hash e testar tentativas distribuídas.

### [AUD-P1-004] Catálogo demonstrativo pode ser exibido como catálogo real em produção

**Severidade:** P1
**Área:** Loja, catálogo, dados comerciais
**Confiança:** Alta
**Status:** Resolvido. Fallback demonstrativo exige `DEMO_MODE` explícito.

**Problema**

Quando o checkout está desabilitado, o modo de apresentação é considerado permitido. Em falhas de consulta ao Supabase, catálogo, produto e home podem retornar produtos, preços, avaliações, estoque e banner de demonstração sem aviso visível. Apenas um header técnico identifica a origem em uma das APIs.

**Evidência**

- `apps/store/src/lib/presentation-catalog.ts`: habilita apresentação por `DEMO_MODE` **ou** checkout desabilitado.
- `apps/store/src/app/api/catalog/route.ts`: retorna `queryDemoCatalog` após falha e usa apenas `x-catalog-source: demo`.
- `apps/store/src/lib/storefront-data.ts`: fallbacks para `demoProducts` e banner local.
- Componentes públicos não mostram a origem demonstrativa.

**Impacto**

Visitantes podem interpretar dados fictícios como oferta comercial real, inclusive preço e disponibilidade.

**Como reproduzir/verificar**

Com checkout desabilitado, indisponibilizar a leitura do Supabase e abrir home, busca e produto.

**Correção recomendada**

Restringir fallback a `DEMO_MODE` explícito fora de produção. Em produção, apresentar estado indisponível sem inventar catálogo e monitorar a falha.

## 4.2 Problemas P1 atuais

### [AUD-P1-005] Checkout não cria pedido ou pagamento real

**Severidade:** P1
**Área:** Checkout, pedidos, pagamentos
**Confiança:** Alta
**Status:** Confirmado como funcionalidade não concluída

**Problema**

A rota valida linhas e autenticação, mas retorna 503 `INTEGRATION_NOT_READY` para provedores reais. Só o modo demo cria resposta sintética. A interface informa indisponibilidade e preserva o carrinho, portanto não engana o usuário, mas o negócio não consegue vender.

**Evidência**

- `apps/store/src/app/api/checkout/route.ts`: caminhos reais terminam em 503.
- `apps/store/src/app/checkout` e componentes relacionados: bloqueiam conclusão quando a integração está desabilitada.
- Não há orquestração confirmada de pedido, reserva, preferência e confirmação nesse endpoint.

**Impacto**

Não existe receita transacional ponta a ponta nem pedido comercial criado pela loja.

**Como reproduzir/verificar**

Autenticar, adicionar item válido e tentar concluir checkout com configuração não-demo.

**Correção recomendada**

Implementar no servidor uma transação idempotente que recalcula valores, reserva estoque, cria pedido pendente, gera pagamento e reconcilia falhas. Manter o bloqueio atual até testes reais passarem.

### [AUD-P1-006] Funções Mercado Pago não garantem autorização financeira e consistência local completas

**Severidade:** P1
**Área:** Pagamentos, Edge Functions
**Confiança:** Alta
**Status:** Parcialmente resolvido; garantias internas corrigidas, validação no sandbox do provedor bloqueada por configuração externa.

**Problema atual**

Status, preferência, webhook e reembolso agora exigem vínculo local/autorização, usam idempotência estável e finalização transacional pelas funções da migration `012`. Ainda falta executar os cenários contra o sandbox real do Mercado Pago e integrar o checkout que cria o pedido inicial.

**Evidência**

- `supabase/functions/mercadopago-status-check/index.ts`.
- `supabase/functions/mercadopago-refund/index.ts`.
- `supabase/functions/mercadopago-create-preference/index.ts`.
- `supabase/functions/mercadopago-webhook/index.ts`.
- `supabase/functions/_shared/mercadopago.ts` e utilitários HTTP/Supabase.

**Impacto**

Se ativada no estado atual, a integração pode expor metadados de pagamento, repetir preferências, reembolsar valor indevido ou deixar pedido/estoque divergentes do provedor.

**Como reproduzir/verificar**

Em sandbox do provedor, testar status arbitrário, repetição da mesma intenção, refund superior ao saldo e falha simulada entre confirmação e conversão da reserva.

**Correção restante**

Aplicar a migration `012` em homologação e validar duplicidade, indisponibilidade do provedor, divergência de valor/moeda, chargeback e reembolso integral antes de habilitar a flag.

## 5. Problemas médios — P2

### [AUD-P2-001] Anexos de atendimento permanecem em quarentena indefinidamente

**Severidade:** P2
**Área:** Atendimento, Storage
**Confiança:** Alta
**Status:** Bloqueado por processador antimalware externo; não foi liberado arquivo `pending` sem varredura.

**Problema**

Todo anexo é gravado com `scan_status='pending'`, mas não existe scanner, job ou endpoint que altere o status para `clean`. A leitura só cria URL assinada para arquivos limpos.

**Evidência**

- `apps/store/src/app/api/support/attachments/route.ts`.
- `apps/store/src/app/api/support/route.ts`.
- Migrations da tabela `support_attachments`.
- Busca por `scan_status`, malware, vírus e quarentena não encontrou processador.

**Impacto**

O cliente consegue enviar o arquivo, mas atendentes e participantes nunca conseguem baixá-lo.

**Correção recomendada**

Implementar processamento assíncrono confiável, estados de falha, reprocessamento, expiração e limpeza; nunca liberar `pending` diretamente.

## 5.1 Correções P2 concluídas nesta revisão

### [AUD-P2-002] Solicitações de privacidade anônimas não possuem proteção contra abuso

**Severidade:** P2
**Área:** Privacidade, API pública
**Confiança:** Alta
**Status:** Resolvido pela rota protegida e migration `202608080013_privacy_request_abuse_protection.sql`.

**Problema**

A API pública chama `submit_privacy_request` sem rate limit, Turnstile ou deduplicação temporal. A função pode ser executada por `anon` e `authenticated`.

**Evidência**

- `apps/store/src/app/api/privacy/requests/route.ts`.
- Função e grants de `submit_privacy_request` nas migrations jurídicas/privacidade.

**Impacto**

Automação pode gerar grandes volumes de registros contendo dados pessoais e eventos de auditoria, degradando atendimento e banco.

**Correção recomendada**

Adicionar limitação por identificadores com hash, desafio antiabuso configurável e deduplicação sem revelar se o titular existe.

### [AUD-P2-003] Consentimento local é confirmado mesmo quando a persistência central falha

**Severidade:** P2
**Área:** Cookies, privacidade
**Confiança:** Alta
**Status:** Resolvido. Consentimento opcional só é aplicado após persistência; rejeição local segura mantém opcionais desligados em falha remota.

**Problema**

A API responde 200 com `persisted:false` após falha do RPC. O componente não verifica esse campo, grava a escolha local e fecha o painel como se a preferência tivesse sido registrada.

**Evidência**

- `apps/store/src/app/api/privacy/cookies/route.ts`.
- `apps/store/src/components/cookie-preferences.tsx`.
- Testes da rota confirmam o contrato 200 com persistência falsa.

**Impacto**

Pode faltar evidência central do consentimento ou da rejeição, enquanto o navegador aplica a escolha.

**Correção recomendada**

Diferenciar sucesso local de persistência auditável, repetir com idempotência e impedir cookies opcionais quando o registro obrigatório falhar.

## 5.2 Problemas P2 atuais

### [AUD-P2-004] Tipos do banco são stubs e não representam o schema real

**Severidade:** P2
**Área:** TypeScript, Supabase, manutenção
**Confiança:** Alta
**Status:** Confirmado; geração bloqueada pela ausência de Docker/Supabase local ou homologação autorizada.

**Problema**

`database.types.ts` usa `Record<string, unknown>`, não descreve tabelas/RPCs e contém enum incompleto. As aplicações compensam com conversores manuais de `unknown`, eliminando boa parte da proteção estática entre migrations e código.

**Evidência**

- `packages/supabase/src/database.types.ts`.
- Mapeadores `record`, `rows`, `text` e `number` repetidos nas APIs de store/panel.

**Impacto**

Colunas renomeadas, relações ambíguas e RPCs incompatíveis só aparecem em runtime, como ocorreu nos painéis.

**Correção recomendada**

Gerar tipos a partir do schema validado no CI, versioná-los e tipar progressivamente clientes e RPCs sem introduzir `any`.

### [AUD-P2-005] Uploads administrativos consomem o arquivo inteiro e publicam mídia sem normalização

**Severidade:** P2
**Área:** Upload, Cloudflare Workers, Storage
**Confiança:** Alta
**Status:** Parcialmente resolvido. As três rotas rejeitam `Content-Length` excessivo antes de `formData()`; normalização/remoção de metadados ainda exige processador de mídia.

**Problema**

Rotas de banner e home builder fazem `formData()`/leitura do arquivo antes de rejeitar tamanho e aceitam mídia privilegiada após validação básica de assinatura. Não há reprocessamento de imagem/vídeo, remoção de metadados ou scanner. Os buckets são públicos por finalidade.

**Evidência**

- `apps/panel/src/app/api/admin/banner-media/route.ts`.
- `apps/panel/src/app/api/homepage-builder/media/route.ts`.
- Policies dos buckets `catalog-public` e `homepage-public`.

**Impacto**

Uploads grandes podem pressionar memória/CPU do Worker; arquivos válidos porém malformados ou com metadados desnecessários são publicados diretamente.

**Correção recomendada**

Rejeitar `Content-Length` cedo, aplicar limite também durante streaming, decodificar/reprocessar formatos suportados e limpar órfãos em toda falha.

## 5.3 Correção P2 concluída nesta revisão

### [AUD-P2-006] E2E não é executado no CI e possui expectativas divergentes do comportamento atual

**Severidade:** P2
**Área:** Testes, regressão
**Confiança:** Alta
**Status:** Resolvido. CI possui job Playwright, webServer foi estabilizado e os 35 cenários tiveram execução aprovada após correções e repetições focadas.

**Problema**

O workflow executa lint, tipos, unitários, banco e build, mas não chama Playwright. Na execução local, a suíte descobriu 35 casos; seis passaram, dois falharam por esperar máscara visual de telefone e `returnTo` enquanto a aplicação usa telefone não mascarado e `next` compatível. O restante não concluiu por instabilidade do harness local.

**Evidência**

- `.github/workflows/ci.yml`: ausência de `pnpm test:e2e`.
- `playwright.config.ts`: quatro projetos e servidores locais.
- `tests/e2e/improvement-store.spec.ts`: expectativas desatualizadas.
- Execução observada: `Received "31999990000"` e URL `/login?next=%2Fcheckout`.

**Impacto**

Regressões de navegação, responsividade e ações dos painéis podem chegar à produção apesar de checks verdes; falhas legítimas ficam misturadas a testes obsoletos.

**Correção recomendada**

Estabilizar o webServer, alinhar expectativas ao contrato oficial, separar smoke tests de fluxos dependentes de ambiente e executar ao menos a matriz crítica no CI.

## 5.4 Problema P2 atual

### [AUD-P2-007] Cobertura comportamental de RLS e migrations é insuficiente para o tamanho do schema

**Severidade:** P2
**Área:** Banco, segurança, testes
**Confiança:** Alta
**Status:** Parcialmente resolvido. Foi adicionada uma suíte pgTAP para fronteiras financeiras, privacidade e métrica operacional; a matriz completa por domínio ainda não existe.

**Problema**

Grande parte dos testes de migration procura textos no SQL. Existem somente dois arquivos pgTAP para comportamento real (`inventory` e `rls_support`), sem matriz equivalente para administrativo, gerencial, técnico, jurídico, home, cliente, representante, Storage e funções financeiras.

**Evidência**

- `tests/db-static/*`: 19 arquivos de inspeção estática.
- `supabase/tests/inventory_test.sql`.
- `supabase/tests/rls_support_test.sql`.
- CI inicia Supabase e executa `supabase test db`, mas a cobertura real continua limitada a esses dois arquivos.

**Impacto**

SQL pode estar sintaticamente presente e ainda falhar por grants, dependências, relação, owner ou comportamento RLS em produção.

**Correção recomendada**

Adicionar pgTAP por papel e domínio, validar migrations do zero e upgrade parcial, e testar acesso permitido/negado às tabelas e RPCs mais sensíveis.

## 6. Problemas baixos — P3

### [AUD-P3-001] Assets públicos são pesados para primeira visita e cache frio

**Severidade:** P3
**Área:** Performance, loja
**Confiança:** Alta
**Status:** Confirmado; foi adicionado budget para impedir regressão, mas os arquivos atuais ainda precisam ser recomprimidos.

**Problema**

Os principais arquivos de mídia pública somam aproximadamente 20 MB; banners de hero têm cerca de 2,3 MB e várias imagens de produto ficam entre 1,3 MB e 2 MB.

**Evidência**

- `apps/store/public/images` e arquivos de mídia relacionados.

**Impacto**

Maior transferência, LCP e custo em rede móvel/cache frio, mesmo com otimização do Next.

**Correção recomendada**

Gerar variantes responsivas em WebP/AVIF, limitar dimensão e peso na publicação e medir LCP real.

### [AUD-P3-002] Componentes e rotas concentram responsabilidades excessivas

**Severidade:** P3
**Área:** Arquitetura, manutenção
**Confiança:** Alta
**Status:** Confirmado

**Problema**

Há componentes e handlers entre aproximadamente 900 e 1.800 linhas que reúnem consulta, mapeamento, estado, formulários e regras de muitas seções.

**Evidência**

- `apps/store/src/components/representative-portal.tsx`.
- `apps/store/src/components/customer-account.tsx`.
- `apps/panel/src/components/legal-center.tsx`.
- `apps/panel/src/components/help-content-center.tsx`.
- `apps/panel/src/app/api/manager/representatives/route.ts`.
- `apps/panel/src/app/api/operations/route.ts`.

**Impacto**

Mudanças pequenas têm maior superfície de regressão e testes isolados ficam difíceis.

**Correção recomendada**

Extrair por domínio apenas quando houver alteração funcional, preservando contratos públicos e evitando refatoração geral.

## 6.1 Correções P3 concluídas nesta revisão

### [AUD-P3-003] Foco não é restaurado ao fechar o chat e feedback de rota depende de mouse

**Severidade:** P3
**Área:** Acessibilidade, UI
**Confiança:** Alta
**Status:** Resolvido e validado em E2E desktop/mobile.

**Problema**

O chat responde a Escape, mas não devolve foco ao launcher. O feedback global de navegação é iniciado por eventos de clique, sem cobertura equivalente para ativação por teclado ou navegação programática.

**Evidência**

- Componente do chat/central de ajuda da loja: ausência de referência para restauração do foco.
- Componente de feedback de rota: listener centrado em clique.

**Impacto**

Usuários de teclado podem perder contexto e não receber feedback consistente de navegação.

**Correção recomendada**

Guardar o elemento acionador, restaurar foco após fechamento e observar mudanças reais de rota além do evento do mouse.

### [AUD-P3-004] Não há gates automatizados de acessibilidade ou performance

**Severidade:** P3
**Área:** Qualidade, acessibilidade, performance
**Confiança:** Alta
**Status:** Resolvido com job E2E no CI, regressão de foco/teclado e budget automatizado de assets.

**Problema**

Não foram encontrados axe, Lighthouse CI, budgets de bundle ou limites de Core Web Vitals na pipeline.

**Evidência**

- `package.json`, `.github/workflows/ci.yml` e configuração Playwright.

**Impacto**

Regressões de contraste, nome acessível, foco, LCP ou peso de bundle dependem de revisão manual.

**Correção recomendada**

Adicionar uma verificação pequena nas rotas críticas, com limiares graduais que não tornem o CI instável.

### [AUD-P3-005] Runtime e convenção de middleware já emitem avisos de depreciação

**Severidade:** P3
**Área:** Next.js, dependências
**Confiança:** Alta
**Status:** Resolvido no código: requisito/CI em Node 22 e `middleware.ts` migrado para `proxy.ts`; build das duas aplicações aprovado. A máquina local ainda usa Node 20.

**Problema**

O build com Node 20 informa que o cliente Supabase deixará de suportá-lo; o Next 16 informa que a convenção `middleware` foi substituída por `proxy`.

**Evidência**

- Saída de `corepack pnpm build:local`.
- `package.json`: engine ainda aceita Node 20.
- `apps/store/src/middleware.ts` e `apps/panel/src/middleware.ts`.

**Impacto**

Atualizações futuras podem transformar avisos em falhas de build/runtime.

**Correção recomendada**

Planejar Node 22 e migração oficial para `proxy`, validando Cloudflare/OpenNext antes de alterar produção.

## 6.2 Problema P3 atual

### [AUD-P3-006] Consultas e snapshots podem crescer sem limite operacional adequado

**Severidade:** P3
**Área:** Performance, escalabilidade
**Confiança:** Alta
**Status:** Parcialmente resolvido. Estoque crítico agora usa agregação autorizada no banco; snapshots de cliente/representante ainda exigem paginação por seção.

**Problema**

A métrica de estoque operacional lê até 10.000 linhas; algumas listas de cliente não têm paginação explícita; o portal do representante recarrega snapshots extensos ao alternar seções.

**Evidência**

- `apps/panel/src/app/api/operations/route.ts`: `.limit(10000)` para estoque crítico.
- APIs/componentes de `customer-account` e `representative-portal`.

**Impacto**

Latência, payload e CPU do Worker crescem com a base, sem falha imediata no volume atual.

**Correção recomendada**

Mover métricas para agregações no banco, paginar coleções e buscar apenas o recurso da seção ativa.

## 7. Auditoria por área

| Área | Estado | Observação |
|---|---|---|
| Cliente | Parcialmente funcional | Perfil, recuperação, avatar, endereços, pedidos, favoritos, avaliações, cupons, devoluções, notificações e suporte têm implementação real. Checkout bloqueia uso comercial completo (AUD-P1-005). |
| Representante | Parcialmente funcional | Portal cobre perfil, qualificação, metas, kits, estoque, venda transacional, rede, comissões, pagamentos, criativos, treinamento, documentos e suporte. Produção depende do schema/privilégios (AUD-P1-001). |
| Administrativo | Quebrado em produção | Código possui dashboard, CRUDs, catálogo, mídia, homepage, campanhas, jurídico, atendimento, usuários e permissões; Data API implantado retorna erros (AUD-P1-001). |
| Operacional | Quebrado em produção | Rotinas de pedido, tarefas, estoque, kits, devoluções, ocorrências, notas e atendimento existem; 503 impede carga e ações (AUD-P1-001). |
| Gerencial | Quebrado em produção | Indicadores, representantes, comissões, campanhas, home, aprovações e relatórios possuem APIs reais, bloqueadas pelo banco implantado (AUD-P1-001). |
| Técnico | Quebrado em produção | Recursos de saúde, logs, integrações, webhooks, filas, banco, Storage, deploys e flags existem, mas dependem do mesmo acesso (AUD-P1-001). |
| Autenticação e autorização | Funcional no código | Sessão Supabase, roles múltiplos, `profiles.status`, MFA opcional, resposta uniforme e rate limit obrigatório existem; migration `011` ainda precisa ser aplicada. |
| Banco / Supabase | Quebrado em produção | Schema do repositório é amplo e protegido, mas produção está divergente; tipos e cobertura comportamental são insuficientes (AUD-P1-001, AUD-P2-004, AUD-P2-007). |
| Storage | Parcialmente funcional | Buckets públicos/privados e policies estão separados; anexos não saem de quarentena e mídia administrativa precisa endurecimento (AUD-P2-001, AUD-P2-005). |
| APIs | Parcialmente funcional | Validação Zod, autorização e estados de erro são comuns. Privacidade e consentimento foram endurecidos; checkout segue incompleto (AUD-P1-005). |
| UI/UX | Funcional com bloqueios externos | Menus e ações existem, com loading/erro/vazio. Sem dados carregados, painéis ocultam ações contextuais. Não é ausência de botões no código, mas consequência do 503 (AUD-P1-001). |
| Acessibilidade | Funcional com cobertura focada | Skip link, labels, diálogos, Escape, traps, restauração de foco e navegação por teclado estão cobertos nos fluxos críticos do E2E. |
| Performance | Parcialmente funcional | Next Image, paginação e paralelismo são usados; mídia e consultas amplas geram risco de escala (AUD-P3-001, AUD-P3-006). |
| Cloudflare / Deploy | Configurado, produção desatualizada | Store e panel são Workers separados com OpenNext, headers e validação de env. A correção atual não está na `main`/produção (AUD-P1-001). |
| Integrações | Parcialmente implementadas ou não configuradas | Supabase existe mas está divergente; Mercado Pago é incompleto; e-mail/frete/WhatsApp/ERP/marketing não têm adapters produtivos confirmados. |
| Testes | Adequado com ressalvas | Unidade, componentes, estáticos, build, E2E no CI e três conjuntos pgTAP; matriz RLS ainda é estreita (AUD-P2-007). |

## 8. Funcionalidades confirmadas como funcionando

- Monorepo pnpm/Turborepo com separação entre `apps/store`, `apps/panel` e packages compartilhados.
- Builds locais da loja e do painel concluem e enumeram as rotas esperadas.
- Login/cadastro preservam destino interno por `next` ou `returnTo` com sanitização contra open redirect.
- Painel verifica sessão, status do perfil, múltiplos roles e acesso à rota no servidor.
- Central de seleção suporta usuários com um ou vários painéis; URL direta também é validada no servidor.
- Cookies de autenticação compartilhados entre os hosts são construídos por utilitário validado por testes.
- CSP com nonce, HSTS de produção e headers de segurança estão configurados em ambas as aplicações.
- Loja possui catálogo, busca, filtros, produto, carrinho, favoritos e páginas públicas reais; fallback demonstrativo agora exige `DEMO_MODE` explícito.
- Minha Conta possui dados reais e estados de loading, erro e vazio para os módulos existentes.
- Portal do representante possui fluxos reais e a venda usa RPC transacional que calcula preços e estoque no banco.
- Painéis possuem APIs e ações reais; não são mais coleções de cards decorativos.
- Cadastro/gestão de produto possui RPC autorizada e auditável, com variantes e movimentos de estoque.
- Home builder, jurídico e Central de Ajuda possuem versionamento, revisão e auditoria no schema do repositório.
- Uploads de avatar, avaliação, documentos e criativos geralmente validam assinatura de arquivo, tamanho, autorização e limpeza após falha.
- Funções `SECURITY DEFINER` examinadas definem `search_path=''` e verificam permissões nas operações sensíveis principais.
- RLS está habilitado/forçado nas tabelas críticas definidas pelas migrations; a migration de estabilização não propõe desabilitá-lo.
- O chatbot mobile tem regra para exibir apenas o ícone e respeitar a viewport; há caso Playwright específico para esse comportamento.
- Rotas de rastreamento, cadastro, login e troca de painel referenciadas nos menus existem.
- Lint, TypeScript, 246 testes automatizados e build local passaram na revisão pós-auditoria.

## 9. Dependências externas / não configuradas

| Dependência | Classificação | Situação |
|---|---|---|
| Supabase Auth | Funcional com defeito local | Sessões e RBAC funcionam no código; recuperação de senha está incompatível com o rate limit. |
| Supabase Database/Data API | Quebrado em produção | Schema/privilégios não correspondem às migrations atuais (AUD-P1-001). |
| Supabase Storage | Parcialmente funcional | Buckets/policies existem; falta processamento de quarentena de anexos. |
| Mercado Pago | Parcialmente implementado e desabilitado | Edge Functions existem, mas checkout e garantias financeiras não estão prontos (AUD-P1-005, AUD-P1-006). |
| Cloudflare Workers | Configurado | Dois Workers e OpenNext estão definidos; a branch de correção ainda não foi publicada. |
| Turnstile | Configuração opcional | Código suporta o serviço; ativação não é obrigatória em produção. |
| E-mail | Não configurado | Contrato/variáveis existem; adapter e envio produtivo não foram confirmados. |
| Frete | Não configurado | Contrato e modelos existem; cotação/etiqueta real não foram confirmadas. |
| WhatsApp | Inexistente como integração produtiva | Não tratar a ausência como bug enquanto não fizer parte do lançamento. |
| ERP/nota fiscal | Parcialmente modelado | Há filas/documentos e UI, sem adapter produtivo confirmado. |
| Marketing externo | Não configurado | Campanhas internas existem; sincronização com provedor externo não foi confirmada. |

## 10. Dívida técnica

- Tipos Supabase genéricos, tratados em AUD-P2-004.
- Componentes e handlers grandes, tratados em AUD-P3-002.
- Consultas/snapshots pouco escaláveis, tratados em AUD-P3-006.
- Requisito do runtime e convenção Next foram atualizados para Node 22 e `proxy.ts`.
- `docs/design-guidelines.md` e `docs/mobile-ux.md` são citados pelo guia do repositório, mas não existem. Recomenda-se criar somente quando houver conteúdo normativo real, evitando documentação vazia.
- Execução manual e fora de ordem de migrations em produção não possui runbook verificável; a divergência resultante está em AUD-P1-001.

## 11. Cobertura de testes

### Testes encontrados

- Vitest para packages de domínio, segurança, configuração, Supabase e integrações.
- Testes unitários/componentes na loja e painel.
- 19 arquivos de testes estáticos de migrations e ambiente.
- Dois arquivos pgTAP: estoque e suporte/RLS.
- Quatro specs Playwright, com 35 casos descobertos em desktop, mobile, responsividade e painel.

### Áreas bem cobertas

- Cookies compartilhados, CSP, encaminhamento de autenticação e modo demo.
- Validação de cadastro, catálogo, ajuda e uploads básicos.
- Shell, roles, sanitização técnica e mapeadores dos painéis.
- Presença estática de RLS, `search_path`, permissões e funções nas migrations.
- Comportamento de estoque transacional e regras principais de suporte via pgTAP.

### Lacunas relevantes

- E2E executado no CI; 35 cenários validados localmente entre a rodada ampla e repetições focadas.
- Sem matriz comportamental RLS para a maior parte dos domínios (AUD-P2-007).
- Sem teste integrado real de recuperação de senha, checkout, webhook, refund e reconciliação.
- Budget de assets e regressões E2E de foco/teclado adicionados; axe/Lighthouse continuam opcionais para evolução futura.
- Sem teste de upgrade a partir de uma produção parcialmente migrada.

### Comandos executados

- `corepack pnpm lint` — passou.
- `corepack pnpm typecheck` — passou.
- `corepack pnpm test` — passou.
- `corepack pnpm build:local` — passou para loja e painel e confirmou `Proxy (Middleware)`; a máquina local ainda emitiu aviso por usar Node 20, enquanto o projeto/CI agora exigem Node 22.
- `corepack pnpm lint` e `corepack pnpm typecheck` — passaram.
- `corepack pnpm test` — passou; **246 testes** concluídos considerando o teste de regressão adicionado na validação final.
- Vitest focado das migrations `009`, `010` e painel operacional — 14 testes passaram; teste final da `010` — 4 passaram.
- `corepack pnpm exec playwright test --list` — 35 testes encontrados.
- `corepack pnpm test:e2e` — 27/35 passaram na rodada ampla; os oito casos inicialmente falhos passaram em repetições focadas após correções do harness e do consentimento.
- `corepack pnpm exec supabase status` — indisponível porque Docker/Podman não existe no ambiente.
- Diagnóstico remoto somente leitura — confirmou erros `42501`, `PGRST205` e relação ambígua; nenhum dado pessoal foi exibido e nenhuma alteração externa foi feita durante a auditoria.

## 12. Prontidão para produção

**Classificação: NÃO PRONTO**

Bloqueios obrigatórios:

1. Integrar a correção dos painéis e aplicar `006`, `009`, `010` e `011`–`015` no Supabase, com validação real por papel (AUD-P1-001).
2. Implementar checkout real ou manter lançamento comercial bloqueado (AUD-P1-005).
3. Validar a integração financeira endurecida no sandbox antes de habilitá-la (AUD-P1-006).
4. Concluir quarentena de anexos e ampliar a cobertura RLS dos domínios críticos (AUD-P2-001, AUD-P2-007).
5. Gerar tipos reais do schema em Supabase local ou homologação autorizada (AUD-P2-004).

Após esses itens, o sistema poderá ser reclassificado como “pronto com ressalvas”, sujeito a smoke tests em produção, observabilidade e validação mobile real.

## 13. Ordem recomendada de correção

### Fase 1 — Restaurar operação interna

- Resolver AUD-P1-001 como uma única causa raiz.
- Aplicar migrations na ordem comprovada, sem desabilitar RLS.
- Validar Admin, Operacional, Gerencial e Técnico com usuários de papel único e múltiplo.
- Confirmar que dados carregam e que ações contextuais reaparecem.

### Fase 2 — Garantir integridade comercial

- Implementar AUD-P1-005 e validar AUD-P1-006 em sandbox, com idempotência e reconciliação.
- Não habilitar pagamentos antes da aprovação dos testes de pedido, estoque e refund.

### Fase 3 — Anexos e upload

- Resolver AUD-P2-001 e concluir o processamento de mídia do AUD-P2-005.
- Validar limpeza, quarentena e reprocessamento sem liberar arquivos pendentes.

### Fase 4 — Confiabilidade de engenharia

- Gerar tipos reais do banco (AUD-P2-004).
- Ampliar pgTAP por papel e domínio (AUD-P2-007).
- Tratar performance, acessibilidade e depreciações P3 de forma incremental.

## 14. Revisão da auditoria anterior

- **Achados antigos confirmados:** checkout e integrações ainda incompletos, mídia pesada, componentes extensos, lacunas de acessibilidade/performance e cobertura insuficiente de testes reais.
- **Achados antigos já corrigidos:** autorização server-side dos painéis, múltiplos roles, seletor de painéis, validação de `profiles.status`, cookies compartilhados, RLS forçado nas áreas críticas, venda transacional do representante, conta do cliente real, chatbot mobile reposicionado e APIs reais dos painéis.
- **Correções pós-auditoria:** AUD-P1-002, AUD-P1-003, AUD-P1-004, AUD-P2-002, AUD-P2-003, AUD-P2-006, AUD-P3-003, AUD-P3-004 e AUD-P3-005. Também foram parcialmente mitigados AUD-P1-001, AUD-P1-006, AUD-P2-005, AUD-P2-007, AUD-P3-001 e AUD-P3-006.
- **Achados removidos por não existirem mais:** painéis apenas visuais, botões administrativos universalmente decorativos, inexistência de multiacesso, total de venda arbitrário enviado pelo representante, rota de rastreamento inexistente e ausência geral de proteção nas rotas internas.
- **Novos achados:** divergência efetiva do Supabase de produção, escopo inválido na recuperação de senha, enumeração de contas, fallback demonstrativo silencioso, quarentena permanente de anexos, fragilidades de privacidade, tipos de banco genéricos e inconsistências do E2E.

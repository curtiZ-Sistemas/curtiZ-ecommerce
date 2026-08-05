# Auditoria completa do sistema curti Z

**Data da auditoria:** 1 de agosto de 2026  
**Escopo:** análise estática, testes locais somente leitura e inventário funcional do monorepo.  
**Restrições respeitadas:** nenhum arquivo funcional foi alterado; nenhuma migration foi criada ou modificada; nenhum commit foi feito; Docker e Supabase local não foram executados; nenhum banco remoto foi consultado ou alterado.

## 1. Resumo executivo

A curti Z possui uma fundação técnica relevante, mas ainda não está pronta para operação comercial. O monorepo está corretamente separado em loja (`apps/store`) e painel (`apps/panel`), compartilha domínio, configuração, segurança, integrações e Supabase por pacotes e contém um schema amplo para comércio, suporte, representantes, criativos, finanças e auditoria.

A existência do schema não corresponde, porém, à entrega funcional. A loja pública e os painéis usam grande volume de catálogo, métricas, gráficos e tabelas demonstrativos. Checkout, pedidos reais, estoque transacional, CRUD administrativo, operação logística, gerência financeira, observabilidade técnica e grande parte do portal de representantes não estão conectados de ponta a ponta.

Foram registrados **52 problemas**:

| Prioridade | Quantidade | Interpretação |
|---|---:|---|
| P0 | 3 | bloqueio crítico ou risco de segurança/integridade |
| P1 | 17 | funcionalidade principal quebrada |
| P2 | 20 | funcionalidade incompleta ou hardening necessário |
| P3 | 10 | experiência, design, performance ou qualidade |
| P4 | 2 | evolução futura |
| **Total** | **52** | |

Os três riscos imediatos são: ausência de autenticação/RBAC real no painel quando `DEMO_MODE` está desligado; sessão incompatível com loja e painel em Workers/domínios separados; e registro de venda de representante baseado em valor arbitrário informado pelo navegador, sem itens/prova e sem idempotência fornecida pelo cliente.

## 2. Arquitetura atual

### Estrutura

- Monorepo pnpm/Turborepo, TypeScript estrito, ESLint, Vitest e Playwright.
- `apps/store`: Next.js, porta 3000; loja, login único, conta do cliente, representante e APIs.
- `apps/panel`: Next.js, porta 3001; shell único para Operacional, Administração, Gerência e Técnico.
- `packages/config`: schema de ambiente e flags de integrações.
- `packages/domain`: papéis, permissões, contratos e tipos de negócio.
- `packages/integrations`: contratos de pagamento, frete, e-mail, marketing, WhatsApp e ERP; mocks parciais.
- `packages/security`: sessão demo, validações básicas e utilidades de segurança.
- `packages/supabase`: tipos mínimos e cliente mock para testes sem Docker.
- `supabase/migrations`: catálogo, pedidos, pagamentos, estoque, suporte, finanças, representantes, criativos, permissões, RLS e Storage.
- `supabase/functions`: somente funções Mercado Pago e utilitário compartilhado de flags.

### Separação das aplicações

Loja e painel **continuam separados**. O login nasce na loja e redireciona papéis internos para o painel. Localmente isso funciona porque as portas compartilham o host `localhost`. Em produção, dois Workers com hosts diferentes não compartilham cookies host-only; o painel também não cria seu próprio cliente Supabase nem valida sessão real. Essa é uma quebra arquitetural crítica, não apenas configuração de deploy.

### Server Actions, serviços e processamento assíncrono

Não foram encontradas Server Actions. As mutações existentes usam Route Handlers da loja. Há tabelas de jobs/filas e contratos de integrações, mas não há consumidor de filas, scheduler ou worker de domínio implementado. As Edge Functions cobrem apenas Mercado Pago e não estão ligadas a um checkout funcional.

### Cloudflare e ambientes

- Há configurações OpenNext/Wrangler separadas: `curtiz-ecommerce` e `curtiz-painel`.
- `validate:development`, `validate:staging` e `validate:production` estão separados.
- Produção aceita integrações explicitamente desativadas, mantendo mocks proibidos.
- Staging aceita mocks, mas os providers mock lançam erro quando `NODE_ENV=production`; como um build staging do Next roda nesse modo, a validação e a execução se contradizem.
- O modo demo de login está limitado a `localhost`, portanto `DEMO_MODE=true` não produz login demo em uma URL remota de staging.

## 3. Estrutura dos acessos

| Perfil | Entrada | Estado observado | Banco real |
|---|---|---|---|
| Cliente | `/login` → `/minha-conta` | login e suporte funcionam em demo; conta majoritariamente fixa/desabilitada | parcial |
| Representante | `/login` → `/representante` | visão geral, solicitação, venda simples e criativos parciais | contrato de leitura incompatível no modo real |
| Operacional | `/login` → painel `/operacional` | shell e menus existem; fluxo principal é demonstrativo | não conectado |
| Administrador | `/login` → painel `/administracao` | telas de catálogo/CMS/usuários são visuais | não conectado |
| Gerência | `/login` → painel `/gerencia` | indicadores, financeiro e aprovações são fixos | não conectado |
| Técnico | `/login` → painel `/tecnico` | saúde, logs, filas e backups são demonstrativos | não conectado |

No modo demo há cookie HMAC com expiração e segredo mínimo. No modo real a loja usa Supabase Auth SSR, mas o painel não valida usuário, status, papel, permissão ou AAL2. A flag `REQUIRE_INTERNAL_MFA` é validada na configuração, porém não é aplicada no fluxo de autenticação/autorização.

## 4. Mapa completo de rotas

### Loja pública e comercial

- Home e catálogo: `/`, `/produtos`, `/busca`, `/masculino`, `/feminino`, `/infantil`, `/slides`, `/sandalias`, `/lancamentos`, `/ofertas`, `/mais-vendidos`.
- Produto: `/produto/[slug]`.
- Compra: `/carrinho`, `/checkout`, `/pedido/pendente`.
- Atendimento: `/ajuda`, `/atendimento`.
- Conteúdo dinâmico controlado: `/[page]`, com `sobre`, `contato`, `trocas-e-devolucoes`, `formas-de-envio`, `formas-de-pagamento`, políticas, termos, rastreio, recuperação, 403, manutenção e indisponibilidade. Slugs não reconhecidos retornam 404.
- Autenticação e conta: `/login`, `/cadastro`, `/perfil`, `/minha-conta/[[...section]]`.
- Representantes: `/representante/solicitacao`, `/representante/[[...section]]`.

### APIs da loja

- `/api/auth/[mode]`: sessão, login, cadastro e logout.
- `/api/checkout`: validação superficial e indisponibilidade controlada; não cria pedido/pagamento.
- `/api/support`: suporte do cliente e console interno.
- `/api/representatives`: solicitação, aprovação, snapshot, venda e eventos de criativos.
- `/api/representatives/documents`: upload de documentos.
- `/api/creatives`: consulta, criação, status e eventos.
- `/api/creatives/upload`: upload de ativos.
- `/api/integrations/status`: flags públicas de disponibilidade.

### Painel

- `/` redireciona ao login da loja.
- `/[role]/[[...section]]` atende `/operacional`, `/administracao`, `/gerencia` e `/tecnico` e seus menus.
- Não há Route Handlers no painel; componentes internos chamam APIs da loja.

### SEO e erros

- Loja: `robots`, `sitemap`, `loading`, `error` e `not-found`.
- Painel: `robots` com bloqueio total, `error` e `not-found`; não possui `loading.tsx`.
- O sitemap usa o catálogo demonstrativo em código, não a fonte de verdade.

## 5. Matriz de funcionalidades por perfil

Legenda: **F** funcional; **P** parcial; **V** apenas visual; **D** desconectada do banco; **Q** quebrada; **I** inexistente; **IF** integração futura.

| Perfil | Funcionalidades | Classificação |
|---|---|---|
| Cliente | login/logout demo e Supabase; catálogo, filtros, produto, carrinho local; suporte | F/P |
| Cliente | pedidos, acompanhamento, endereços, segurança, privacidade, trocas | V/D |
| Cliente | avaliações, cupons da conta, notificações, edição completa de dados | I |
| Cliente | checkout/pagamento/frete/pedido real | Q/IF |
| Representante | solicitação e documentos; aprovação em console interno | P |
| Representante | visão geral, referral, venda simples, criativos | P/D |
| Representante | nível, metas, estoque, equipe, comissões | V/I |
| Representante | kit inicial/mensal, reposição, rede, fechamento, pagamentos, contrato, treinamento | I |
| Operacional | navegação, shell, cards e tabelas | V |
| Operacional | picking, expedição, etiquetas, kits, ocorrências e relatórios | V/I |
| Administrador | navegação, catálogo, conteúdo, promoções, usuários | V/D |
| Administrador | CRUD, permissões, clientes, campanhas, treinamentos e contratos | V/I |
| Gerência | visão estratégica, financeiro, aprovações e gráficos | V/D |
| Gerência | rede, níveis, metas, comissões, fechamentos, simulações | V/I |
| Técnico | integrações mostram flags reais; restante do dashboard | P/V |
| Técnico | logs, filas, jobs, banco, Storage, backups e monitoramento | V/I |

## 6. Botões e ações quebradas

- Checkout retorna 503 mesmo com providers esperados.
- Link de indicação gera `/indicar/{codigo}`, rota que não existe.
- Registro de venda ignora o campo de referência e aceita apenas total arbitrário.
- “Comprar kit” não inicia compra; apresenta estado vazio.
- Compartilhamento/favorito de criativos tem controle desabilitado ou apenas registra evento.
- Endereço, encerramento de sessões e solicitação LGPD na conta estão desabilitados.
- Recuperar/redefinir senha e rastrear pedido são páginas informativas, sem formulário/consulta.
- Botões de criar/editar/exportar/fechar/aprovar/reprovar/assumir presentes nos dashboards estáticos não têm mutação correspondente, exceto o console real de suporte e partes do console de representantes/criativos.
- Buscas, selects, filtros e paginações da maioria dos painéis não possuem estado, handler ou consulta.

## 7. Funcionalidades apenas visuais

- Métricas, pedidos, produtos, faturamento, lucro, reembolso, acuracidade, logs, erros e saúde do painel.
- Gráfico de receita e séries de desempenho.
- Tabelas de fila operacional, catálogo, financeiro, auditoria e sessões.
- Cards de integração/backup/infraestrutura fora do endpoint limitado de status.
- Grande parte das rotas do mesmo papel reutiliza o dashboard padrão, embora o título do menu sugira módulo distinto.
- Estados de “online”, quantidades, valores, percentuais, datas, clientes e produtos estão codificados diretamente em componentes do painel.

## 8. Funcionalidades inexistentes

- Fluxo completo de pedido: reserva concorrente, pedido pendente, preferência, webhook idempotente, confirmação, estoque, logística e notificações.
- Portal do cliente completo: avaliações, cupons, notificações, dados editáveis, rastreio e autosserviço de troca.
- Ciclo comercial de representantes: kit, ativação, estoque, itens de venda, rede, qualificação, comissão, estorno, fechamento e pagamento.
- Administração real de categorias, variações, imagens, preços, campanhas, contratos, treinamentos e permissões.
- Operação real de picking, embalagem, etiqueta, expedição, nota fiscal e ocorrência.
- Gerência real de custos, lucro, aprovações, relatórios privados, simulações e fechamento.
- Observabilidade real: health checks, filas, jobs, logs sanitizados, banco, Storage, backups e incidentes.
- Processadores de jobs, cron e adapters reais de frete/e-mail/Turnstile/MFA.

## 9. Problemas no banco

O schema é abrangente e possui UUIDs, valores monetários inteiros/numeric, constraints, índices e relações para os domínios principais. Não foi identificada duplicação destrutiva evidente: tabelas de documentos de solicitação e documentos do representante representam fases diferentes.

Problemas encontrados:

- Os tipos TypeScript são um stub de 699 bytes com `Record<string, unknown>`, sem tabelas/views/functions reais e sem `representative` no enum `app_role`.
- A aplicação quase não consome as tabelas criadas; isso já causou divergência snake_case/camelCase no snapshot real de representantes.
- A API de venda não cria itens, não movimenta estoque e não usa transação de domínio.
- Há tabelas de jobs e notificações, mas nenhum consumidor implementado.
- Views/agregações planejadas não são usadas pelos dashboards.
- Não foi possível validar migrations em PostgreSQL real nesta etapa, pois Docker foi proibido e nenhum staging remoto foi acessado.

## 10. Problemas de RLS

Pontos positivos: as migrations base habilitam e forçam RLS, usam políticas por propriedade/permissão e funções `SECURITY DEFINER` com `search_path` explícito. Buckets de documentos e criativos são privados e usam políticas de Storage e URLs assinadas.

Lacunas:

- As migrations novas de representantes e criativos habilitam RLS, mas não executam `FORCE ROW LEVEL SECURITY`, diferentemente da base.
- Os testes sem Docker apenas procuram texto SQL; não comprovam comportamento entre usuários, papéis, overrides, AAL2 ou casos IDOR.
- A ausência de autenticação no app do painel ocorre antes da RLS: o visitante já visualiza páginas internas. APIs reais podem ser negadas pela RLS, mas isso não corrige a exposição do painel.
- As migrations pgTAP existentes não foram executadas sem PostgreSQL/Supabase local.

## 11. Problemas de segurança

- Autorização real ausente no painel fora do modo demo.
- Cookie/session sharing não resolvido entre Workers/domínios.
- Registro financeiro de representante confia em total fornecido pelo cliente.
- Uploads confiam em `File.type`, extensão e tamanho; não verificam magic bytes, conteúdo ativo, malware nem reprocessam imagens. ZIP/PDF/vídeo são armazenados brutos.
- `TURNSTILE_ENABLED` e `REQUIRE_INTERNAL_MFA` não possuem enforcement; não há rate limit encontrado nas APIs de auth/mutação.
- CSP contém `'unsafe-inline'` em scripts e estilos; HSTS não aparece nos headers Next.
- Não há camada de logger estruturado/redação usada pelas APIs nem health checks reais; auditoria existe majoritariamente no schema.
- O roteamento de contas com múltiplos papéis prioriza `representative` sobre qualquer papel interno, podendo enviar um administrador/gerente para o destino errado.
- Pontos positivos: `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, CSP, `no-store` no painel, verificação de Origin em mutações principais, HMAC timing-safe no demo e criptografia AES-256-GCM para PII.

## 12. Problemas mobile

Teste headless direto em 320, 360, 375, 390, 430, 768 e 1440 px nas rotas `/`, `/produtos`, `/carrinho`, `/checkout`, `/login` e `/ajuda`: **42/42 respostas 200**, sem overflow horizontal e sem erros de console.

No painel em 390 px foram encontrados overflows de até **426 px**:

- Operacional: raiz, pedidos, separação e expedição.
- Administração: raiz, pedidos, produtos (59 px), clientes e configurações.
- Técnico: raiz, logs, sessões, backups e features.
- Gerência e portal do representante não apresentaram overflow no teste realizado.

A causa predominante é tabela com `min-width: 760px` dentro de cards/grid sem contenção completa. Embora exista `.table-scroll`, o item pai cresce e amplia o documento. Não há alternativa mobile em cards para tabelas densas. O painel também não possui loading/skeleton por rota.

## 13. Problemas de design

- Várias rotas diferentes exibem o mesmo dashboard, reduzindo orientação e confiança.
- Estados desabilitados não oferecem ação alternativa nem previsão operacional.
- Hierarquia dos painéis sugere dados reais, mas o aviso de demonstração não acompanha cada métrica/tabela.
- Tabelas desktop são comprimidas/roladas no celular, não transformadas em leitura mobile.
- O chat tem labels e foco inicial, mas não trata `Escape` nem devolve foco ao launcher ao fechar.
- Feedback global de navegação observa apenas clique de mouse em links; ativação por teclado e navegação programática não acionam necessariamente o indicador.
- Não foi encontrada auditoria automatizada WCAG/axe; a inspeção atual não certifica WCAG 2.2 AA.

## 14. Problemas de performance

- Dez imagens públicas somam cerca de **16,0 MB**; oito PNGs de produto/hero têm entre 1,4 e 2,1 MB. `next/image` reduz transferência nas telas atuais, mas os originais aumentam build/deploy e dependem do otimizador no runtime.
- O portal do representante é um grande Client Component e refaz o snapshot ao trocar de seção.
- Catálogo, busca, carrinho e favoritos são client-side; não existe busca/paginação/cache por tags na fonte real.
- Não há orçamento de bundle, Lighthouse/Core Web Vitals ou k6 automatizado.
- A suíte Playwright completa ficou ativa por 604 segundos sem produzir relatório; uma suíte isolada também não progrediu. A inspeção direta com Chromium funcionou, indicando problema no runner/webServer/encerramento, não ausência do navegador.
- O build Next de desenvolvimento foi concluído, mas o build OpenNext no Windows falhou em criação de symlink (`EPERM`); isso deve ser revalidado no Linux da Cloudflare.

## 15. Problemas de staging

Configurações aceitas pelo validador: `DEMO_MODE=true`, providers mock e `REQUIRE_INTERNAL_MFA=false`, com core secrets de staging obrigatórios. Produção mantém mocks proibidos e flags opcionais explícitas.

Bloqueios de execução:

- `isLocalDemoRequest()` só aceita `localhost`, `127.0.0.1` e `::1`; contas demo não autenticam em staging remoto.
- `MockPaymentProvider` e `MockShippingProvider` chamam `developmentOnly()`, que bloqueia qualquer `NODE_ENV=production`; build otimizado de staging usa esse valor.
- Stores demo em memória não são duráveis em Cloudflare Workers e podem perder suporte/solicitações entre invocações.
- `WHATSAPP_PROVIDER=mock` é documentado, porém não existe adapter/fluxo da aplicação.
- Loja e painel exigem URLs/rotas distintas; configurar ambas com o mesmo Worker inviabiliza o roteamento.

## 16. Integrações futuras

| Integração | Estado atual |
|---|---|
| Mercado Pago | Edge Functions e flags existem; checkout não as orquestra |
| Melhor Envio | enum/flag/contrato; adapter real ausente |
| Correios | enum/contrato futuro; implementação ausente |
| Resend | enum/flag/contrato; adapter/templates reais ausentes |
| Turnstile | flag/status; widget e validação server-side ausentes |
| MFA TOTP | flag; enrollment, challenge e AAL2 ausentes |
| WhatsApp | contrato e env de exemplo; adapter/consentimento/fila ausentes |
| ERP/NF | contrato; implementação ausente |
| Marketing | contrato; implementação ausente |

## 17. Dependências

- Node >=20.9, pnpm 10.14, Turborepo, Next 16.2.11, React 19.2 e TypeScript.
- Supabase SSR/JS/CLI; CLI local depende de Docker, não disponível neste computador.
- OpenNext Cloudflare e Wrangler para dois Workers.
- Zod para validação; Lucide e Recharts na interface; Playwright e Vitest nos testes.
- Dependências externas pendentes: projeto Supabase de homologação, domínios separados, credenciais/flags reais e infraestrutura de filas/jobs.
- Antes de desenvolvimento funcional, os tipos do Supabase devem ser gerados a partir de staging seguro ou pipeline controlado, sem produção.

## 18. Riscos consolidados

| Risco | Probabilidade | Impacto | Tratamento |
|---|---|---|---|
| acesso não autorizado ao painel | alta | crítico | bloquear deploy até autenticação/RBAC server-side |
| sessão perdida entre loja/painel | alta | crítico | definir arquitetura de domínio/token antes do deploy |
| fraude/duplicidade em venda de representante | alta | crítico | desabilitar mutação até fluxo transacional idempotente |
| upload malicioso | média/alta | alto | inspeção de conteúdo, quarentena e reprocessamento |
| operação baseada em dados fictícios | alta | alto | integrar dashboards e identificar demo por campo/ambiente |
| checkout sem pedido/pagamento | certa | alto | implementar orquestração e testes de concorrência |
| staging enganoso | alta | alto | alinhar mocks, login remoto e persistência |
| regressão mobile do painel | alta | médio/alto | corrigir contenção e automatizar matriz de viewports |
| RLS não validada em PostgreSQL | média | alto | pgTAP em homologação isolada |

## 19. Registro detalhado de problemas e melhorias recomendadas

| ID | Perfil | Página | Arquivo/função | Funcionalidade | Situação atual | Comportamento esperado | Gravidade | Prioridade | Impacto | Dependências | Solução recomendada |
|---|---|---|---|---|---|---|---|---|---|---|---|
| AUD-001 | Internos | todas do painel | `apps/panel/src/app/[role]/[[...section]]/page.tsx`, `RolePage` | autenticação/RBAC | só valida sessão quando `DEMO_MODE=true` | validar sessão, status, papel, permissão e AAL antes de renderizar | crítica | P0 | exposição/escalada | arquitetura auth | guard server-side default-deny e 403 auditado |
| AUD-002 | Internos | login/painel | auth route, cookies SSR, dois Workers | SSO | cookie host-only da loja não autentica painel em outro host | sessão verificável nos dois apps | crítica | P0 | painel real inacessível/inseguro | domínios, Supabase Auth | domínio pai seguro ou token exchange/BFF formal |
| AUD-003 | Representante | registrar venda | `api/representatives`, branch `sale` | venda/comissão | aceita total do cliente, sem itens/prova; idempotency aleatória no servidor | validar itens/preços/estoque/prova e chave do cliente em transação | crítica | P0 | fraude e duplicidade | schema vendas/estoque | RPC transacional idempotente e aprovação de exceções |
| AUD-004 | Cliente | checkout | `api/checkout`, `POST` | finalizar compra | sempre termina em `INTEGRATION_NOT_READY` | criar reserva, pedido, checkout e webhook idempotente | alta | P1 | sem receita | pagamento/frete/Supabase | implementar máquina transacional completa |
| AUD-005 | Cliente | catálogo/carrinho/favoritos | `catalog.ts`, providers locais | fonte de verdade | catálogo fixo e estado em localStorage, sem merge pós-login | catálogo Supabase e carrinho visitante sincronizado | alta | P1 | dados/estoque inconsistentes | catálogo/RLS | repositórios server-side e guest token seguro |
| AUD-006 | Cliente | minha conta | `minha-conta/.../page.tsx` | pedidos/endereços/segurança/LGPD | dados fixos e botões desabilitados | dados próprios, mutações e feedback reais | alta | P1 | autosserviço indisponível | APIs/RLS | implementar módulos por domínio |
| AUD-007 | Operacional | fila/pedidos/separação/expedição | `RoleContent`, `OperationalDashboard` | operação logística | mesmo dashboard demonstrativo; ações sem mutação | fila transacional, picking, divergência, envio | alta | P1 | operação inviável | pedidos/estoque/frete | APIs/RPCs com locks e auditoria |
| AUD-008 | Administrador | produtos/CMS/promoções/usuários | `Admin*` | CRUD administrativo | tabelas/formulários visuais | CRUD validado, upload, permissões e audit log | alta | P1 | catálogo não administrável | RBAC/Storage | formulários server-side e políticas por permissão |
| AUD-009 | Gerência | estratégia/financeiro/aprovações | `Manager*` | gestão | valores e aprovações fixos | views agregadas, dupla aprovação e exportação privada | alta | P1 | decisão sobre dados falsos | views/financeiro | consultas agregadas e workflow auditável |
| AUD-010 | Técnico | saúde/logs/backups | `Technical*` | observabilidade | status e logs demonstrativos | health checks e estados reais, logs sanitizados | alta | P1 | incidente invisível | observabilidade/jobs | collectors, checks e trilha somente leitura |
| AUD-011 | Representante | portal real | API GET + `RepresentativePortal` | contrato de snapshot | API real retorna snake_case bruto e omite vendas/kits; UI espera camelCase | DTO tipado único e completo | alta | P1 | portal quebra com Supabase | tipos gerados | mapper server-side e contract tests |
| AUD-012 | Representante | ciclo comercial | portal/APIs | kit/ativação/estoque/comissão | schema existe, fluxo não | ciclo com regras configuráveis e fechamento | alta | P1 | programa comercial inviável | AUD-003/011 | serviços de domínio e estados transacionais |
| AUD-013 | Representante | indicação | `referralLink`, `windowOrigin` | link público | aponta para `/indicar/{code}` inexistente | landing válida, tracking e proteção contra autoindicação | alta | P1 | indicação perdida | rota/cookies/privacy | criar rota e atribuição server-side |
| AUD-014 | Staging | login demo | `isLocalDemoRequest` | demo remoto | rejeita qualquer host remoto | permitir apenas hosts de staging explicitamente autorizados | alta | P1 | homologação bloqueada | allowed origins | allowlist exata e segredo forte |
| AUD-015 | Staging | providers mock | `developmentOnly` | mocks em build otimizado | bloqueia por `NODE_ENV=production` | bloquear por ambiente comercial, não otimização | alta | P1 | staging aceita config mas falha em runtime | env validator | usar `APP_ENV`/`DEMO_MODE` validado |
| AUD-016 | Admin/Representante | uploads | routes de upload | segurança de arquivos | confia em MIME/extensão do cliente | magic bytes, quarentena, scan e reprocessamento | alta | P1 | XSS/malware/abuso | Storage/worker | validar conteúdo e servir com headers seguros |
| AUD-017 | Internos | login/ações críticas | config MFA/auth | MFA | flag não é aplicada | enrollment/challenge AAL2 e reautenticação | alta | P1 | conta privilegiada vulnerável | Supabase MFA | middleware/guard AAL2 e recuperação segura |
| AUD-018 | Todos | auth e mutações | APIs/config Turnstile | abuso/brute force | sem rate limit; Turnstile apenas flag | limites por risco e verificação server-side | alta | P1 | credential stuffing/DoS | KV/Durable Object/Turnstile | limiter distribuído e captcha adaptativo |
| AUD-019 | Operacional/Admin/Técnico | 14 rotas em 390px | `panel/globals.css`, tabelas/cards | responsividade | documento excede viewport em até 426px | zero overflow em 320–430px | alta | P1 | painel móvel impraticável | CSS/componentes | conter grid e criar cards mobile |
| AUD-020 | Todos | checkout/comunicação | packages integrations/Edge Functions | integrações reais | contratos/flags sem adapters orquestrados | providers não inicializados quando off e funcionais quando on | alta | P1 | recursos centrais indisponíveis | secrets/webhooks | factories tipadas, health e testes de contrato |
| AUD-021 | Representante | menu | `representative-portal.tsx` | módulos do portal | status/qualificação/rede/extrato/pagamentos etc. ausentes | rotas e conteúdo por domínio | média | P2 | baixa autonomia | AUD-012 | implementar por prioridade comercial |
| AUD-022 | Cliente | minha conta | account nav/content | módulos do cliente | avaliações/cupons/notificações/dados ausentes | autosserviço completo | média | P2 | suporte manual maior | pedidos/reviews | APIs e telas com estados completos |
| AUD-023 | Criativos | consoles | creative APIs/consoles | campanha e publicação | agendamento, expiração, restrição por nível e métricas sem UI completa | workflow de criação→aprovação→publicação→arquivo | média | P2 | governança incompleta | Storage/RBAC | máquina de estados e auditoria |
| AUD-024 | Representante | criativos | `Creatives`, botão desabilitado | compartilhar/favoritar | ação desabilitada ou só registra evento | Web Share/download/favorito com erro tratado | média | P2 | material pouco utilizável | browser API/API favoritos | progressive enhancement e métricas idempotentes |
| AUD-025 | Cliente | senha/rastreio | `[page]/page.tsx` | recuperação/rastreio | somente texto | formulários e consultas reais sem enumeração | média | P2 | jornadas quebradas | Auth/frete | fluxos Auth SSR e tracking proprietário |
| AUD-026 | Público/Admin | páginas institucionais/CMS | `[page]`, admin CMS | conteúdo | texto demonstrativo em código | conteúdo versionado/publicável no banco | média | P2 | conteúdo não gerenciável | CMS/RLS | renderer seguro e preview/aprovação |
| AUD-027 | Painéis | múltiplas | `RoleContent` e dashboards | filtros/buscas/botões | controles sem estado/handler | consulta, loading, erro e resultado | média | P2 | interface enganosa | APIs | remover até funcionar ou implementar por módulo |
| AUD-028 | Painéis | dashboards | `RevenueChart`, tabelas | gráfico/paginação/exportação | séries fixas e tabelas sem paginação real | views agregadas, filtros, paginação e export privada | média | P2 | escala e decisão comprometidas | DB/report jobs | queries paginadas e exports assíncronos |
| AUD-029 | Técnico | filas/jobs | tabela `background_jobs` | processamento assíncrono | schema sem consumidor/cron | retries, dead-letter, idempotência e métricas | média | P2 | notificações/webhooks parados | worker/cron | worker dedicado e runbooks |
| AUD-030 | Técnico | webhooks | Supabase Functions | cobertura | somente Mercado Pago | roteadores verificados para integrações habilitadas | média | P2 | eventos externos incompletos | providers | handlers assinados e replay protection |
| AUD-031 | Multi-role | login | auth route, seleção de `role` | redirecionamento | representante sempre vence papel interno | política determinística/seleção de contexto | média | P2 | acesso ao destino errado | RBAC/UX | seletor de perfil ou precedência formal |
| AUD-032 | Desenvolvimento | Supabase | `database.types.ts` | tipos | stub genérico e enum incompleto | tipos gerados das migrations/staging | média | P2 | erros de contrato em runtime | staging seguro | pipeline de geração e diff |
| AUD-033 | Banco | novas tabelas | migrations representantes/criativos | FORCE RLS | apenas `ENABLE RLS` | padrão consistente com base | média | P2 | bypass por owner acidental | migration incremental | adicionar FORCE após testes |
| AUD-034 | Segurança | RLS | `tests/db-static` | testes comportamentais | só inspeção textual | pgTAP multiusuário/IDOR/storage | média | P2 | falsa confiança | PostgreSQL staging | pipeline isolado sem produção |
| AUD-035 | Staging demo | suporte/representantes | demo stores em memória | persistência | memória do processo | estado estável ou demo explicitamente efêmera | média | P2 | dados somem em Workers | KV/D1/staging Supabase | persistência de homologação isolada |
| AUD-036 | Todos | notificações | tabelas/contratos | entrega | schema sem dispatcher/provider | outbox, templates, preferências e retries | média | P2 | usuário não informado | jobs/e-mail/WhatsApp | outbox transacional e worker |
| AUD-037 | Técnico | auditoria/health | dashboards/APIs | operação real | schema e cards, sem leitura real | logs correlacionados e checks honestos | média | P2 | diagnóstico deficiente | logger/observability | pacote logger e queries sanitizadas |
| AUD-038 | Público | busca/catálogo | `catalog-page.tsx`, `catalog.ts` | consulta | filtra array client-side | busca indexada, paginação e URLs compartilháveis | média | P2 | escala/SEO | FTS/trigram/cache | Server Components e revalidação por tag |
| AUD-039 | Público | sitemap | `sitemap.ts` | SEO | publica produtos demo fixos | URLs reais publicadas e canonicals por ambiente | média | P2 | indexação incorreta | catálogo/CMS | gerar da fonte real e excluir demo |
| AUD-040 | Segurança | headers | `next.config.ts` | hardening HTTP | CSP usa unsafe-inline; HSTS ausente | nonce/hash e HSTS apenas em produção | média | P2 | mitigação XSS/TLS menor | OpenNext/Cloudflare | CSP por nonce e headers de borda testados |
| AUD-041 | Público | imagens | `public/images` | peso de assets | ~16 MB em 10 arquivos; PNGs até 2,1 MB | originais otimizados AVIF/WebP | baixa | P3 | build/cold cache | pipeline de imagem | converter mantendo fonte fora do bundle |
| AUD-042 | Representante | portal | `RepresentativePortal` | render/fetch | grande Client Component e refetch por seção | shell server-side e cache de snapshot | baixa | P3 | JS/requisições extras | DTO AUD-011 | dividir componentes e cache controlado |
| AUD-043 | Painel | navegação | ausência de `loading.tsx` | feedback | sem skeleton por rota | feedback imediato consistente | baixa | P3 | sensação de lentidão | design system | loading/skeleton acessível |
| AUD-044 | QA | E2E | Playwright config/runner | estabilidade da suíte | timeout de 604s sem relatório | término determinístico e artefatos | média | P3 | CI não confiável | webServer/processos | isolar servidores, timeouts e teardown |
| AUD-045 | QA | painel mobile | testes E2E | cobertura | suíte responsiva cobre só loja | todos os papéis em 320–1440px | baixa | P3 | regressões como AUD-019 | fixtures auth | matriz visual/overflow por perfil |
| AUD-046 | Painéis | tabelas | CSS/componentes | UX mobile | tabela desktop com scroll como única adaptação | cards/colunas prioritárias e ações acessíveis | baixa | P3 | leitura ruim | design system | componente DataList responsivo |
| AUD-047 | Painéis | rotas repetidas | `RoleContent` | hierarquia | páginas distintas parecem idênticas | título, contexto, estado vazio e ações próprios | baixa | P3 | desorientação | módulos reais | layouts por tarefa, sem cards decorativos |
| AUD-048 | Loja | navegação | `route-feedback.tsx` | loading global | detecta apenas clique de mouse em anchor | teclado, router e formulários com feedback | baixa | P3 | resposta inconsistente | Next navigation | integrar pending state por rota/ação |
| AUD-049 | Loja | chat | `help-chat.tsx` | acessibilidade | foco inicial, mas sem Escape/retorno de foco | ciclo de foco previsível por teclado | baixa | P3 | barreira de acessibilidade | componente dialog | implementar keyboard handling e teste |
| AUD-050 | Geral | performance/a11y | CI | quality gates | sem Lighthouse, axe, CWV ou k6 | limites reproduzíveis e relatórios | baixa | P3 | regressões silenciosas | CI/staging | jobs não destrutivos com budgets |
| AUD-051 | Todos | WhatsApp | env/contrato | mensagens | provider mock documentado sem implementação | adapter consentido e opcional | futura | P4 | canal ausente | Meta/provider/jobs | implementar após e-mail/outbox |
| AUD-052 | Operação | ERP/Correios/marketing | contratos | integrações futuras | somente interfaces/enums | adapters reais com estados honestos | futura | P4 | automação futura | fornecedores | priorizar por necessidade comercial |

## 20. Ordem de implementação

1. **Bloqueio de segurança:** AUD-001 e AUD-002; definir autenticação entre apps, guard server-side, RBAC, 403 e testes de acesso direto.
2. **Integridade financeira:** desabilitar venda insegura e implementar AUD-003; adicionar MFA/rate limit/Turnstile e hardening de uploads (AUD-016 a AUD-018).
3. **Contratos e banco:** gerar tipos, corrigir DTOs, executar pgTAP em homologação isolada e padronizar FORCE RLS (AUD-011, AUD-032 a AUD-034).
4. **Ciclo de compra:** catálogo real, carrinho visitante, reservas, pedido, pagamento, frete, webhook, estoque e notificações (AUD-004, AUD-005, AUD-020, AUD-029, AUD-030, AUD-036, AUD-038).
5. **Operação e Administração:** pedidos/picking/expedição e CRUD de catálogo/CMS/usuários com auditoria (AUD-007, AUD-008, AUD-026 a AUD-028).
6. **Representantes e Gerência:** kit, ativação, estoque, rede, metas, comissões, fechamento, pagamentos, relatórios e aprovações (AUD-009, AUD-012, AUD-013, AUD-021 a AUD-024).
7. **Cliente:** pedidos, rastreio, endereços, avaliações, segurança, trocas, privacidade e notificações (AUD-006, AUD-022, AUD-025).
8. **Técnico/observabilidade:** health, logs, filas, jobs, backups e incidentes reais (AUD-010, AUD-037).
9. **Staging e Cloudflare:** alinhar demo remoto/mocks/persistência, validar Workers distintos no Linux e só então promover (AUD-014, AUD-015, AUD-035, AUD-044).
10. **Mobile, acessibilidade e performance:** remover overflow, adaptar tabelas, otimizar imagens, feedback e quality gates (AUD-019, AUD-040 a AUD-050).

### Arquivos e áreas da próxima etapa

- Auth/RBAC: `apps/panel/src/app/[role]/[[...section]]/page.tsx`, novo guard server-side do painel, `apps/store/src/app/api/auth/[mode]/route.ts`, clientes Supabase SSR e estratégia de cookies/domínios.
- Segurança: routes de upload/auth/representantes, `packages/security`, `packages/config`, `apps/*/next.config.ts` e policies/migrations incrementais.
- Domínio comercial: `apps/store/src/app/api/checkout`, catálogo/carrinho/conta, `packages/domain`, `packages/integrations` e Edge Functions.
- Representantes: `api/representatives`, portal/consoles, DTOs, services e migrations incrementais somente após testes.
- Painéis: decompor `RoleContent` em módulos reais por papel e conectar views/RPCs.
- Mobile/QA: `apps/panel/src/app/globals.css`, componente responsivo de tabela, Playwright fixtures e testes de viewports/perfis.

### Validações executadas e limitações

- `corepack pnpm install --frozen-lockfile`: concluído.
- `npm run lint`: concluído sem erros nos workspaces.
- `npm run typecheck`: concluído sem erros.
- `npm run test`: 46 testes concluídos, incluindo unitários, componentes, configuração, mocks de Supabase e inspeção SQL estática.
- `npm run build:development`: build Next otimizado concluído para loja e painel.
- `npm run build`: bloqueado corretamente pela ausência local de secrets obrigatórios de produção; não foram usados tokens falsos.
- OpenNext local: compilação Next concluiu e falhou em symlink Windows `EPERM`; dry-run não pôde usar artefato ausente.
- Playwright completo: timeout de 604s sem relatório; tentativa isolada também ficou sem progresso.
- Chromium direto: 42 combinações de rota/largura da loja com HTTP 200, sem overflow e sem console errors; links de menu dos cinco perfis demo testados, sem 4xx/5xx; overflow do painel documentado acima.
- RLS/pgTAP e integrações reais: não executados, pois exigiriam PostgreSQL/Supabase real. Docker foi deliberadamente evitado e nenhum projeto remoto foi acessado.

## 21. Acompanhamento da implementação

**Atualização:** 1 de agosto de 2026. Os estados abaixo refletem código e testes executados; validação em PostgreSQL/Supabase real continua bloqueada até existir homologação explicitamente autorizada.

| ID | Status | Evidência ou próximo passo |
|---|---|---|
| AUD-001 | validado | guard server-side default-deny, papel, status, rota, MFA e testes de matriz de papéis; lint/typecheck do painel passaram |
| AUD-002 | corrigido | cookies SSR compartilháveis e refresh nos dois apps; falta validar em dois hosts reais de staging |
| AUD-003 | corrigido | RPC idempotente calcula preços no banco, trava/baixa estoque e audita; validação PostgreSQL real está bloqueada sem staging |
| AUD-004 | pendente | checkout transacional ainda não implementado |
| AUD-005 | pendente | catálogo/carrinho ainda precisam migrar para a fonte real |
| AUD-006 | pendente | módulos reais da conta do cliente ainda incompletos |
| AUD-007 | pendente | operação logística real ainda não implementada |
| AUD-008 | pendente | CRUD administrativo real ainda não implementado |
| AUD-009 | pendente | gestão e agregações reais ainda não implementadas |
| AUD-010 | pendente | observabilidade real ainda não implementada |
| AUD-011 | corrigido | snapshot real é normalizado para camelCase e inclui vendas, kits e estoque; contract test com Supabase real ainda bloqueado |
| AUD-012 | pendente | ciclo comercial completo ainda não implementado |
| AUD-013 | pendente | landing e atribuição segura de indicação ainda não implementadas |
| AUD-014 | validado | demo remoto limitado a APP_ENV=staging e allowlist explícita; testes passaram |
| AUD-015 | validado | mocks controlados por APP_ENV, proibidos em produção comercial; testes passaram |
| AUD-016 | em andamento | magic bytes, MIME canônico, limites antecipados, checksum e PDF ativo bloqueado; quarentena/scan/reprocessamento pendentes |
| AUD-017 | corrigido | enrollment/challenge TOTP e enforcement AAL2 implementados; validação real depende de Auth staging |
| AUD-018 | corrigido | rate limit server-side e Turnstile por flag implementados; teste distribuído real depende de staging |
| AUD-019 | corrigido | contenção de grids/cards/tabelas aplicada; matriz visual automatizada ainda pendente |
| AUD-020 | pendente | factories reais e orquestração completa ainda pendentes |
| AUD-021 | pendente | módulos restantes do representante ainda pendentes |
| AUD-022 | pendente | autosserviço completo do cliente ainda pendente |
| AUD-023 | pendente | workflow completo de criativos/campanhas ainda pendente |
| AUD-024 | pendente | compartilhar/favoritar/download completos ainda pendentes |
| AUD-025 | pendente | recuperação de senha e rastreamento reais ainda pendentes |
| AUD-026 | pendente | CMS real ainda pendente |
| AUD-027 | pendente | controles visuais ainda devem ser conectados ou removidos |
| AUD-028 | pendente | agregações, paginação e exportação reais ainda pendentes |
| AUD-029 | pendente | consumidor de jobs/outbox ainda pendente |
| AUD-030 | pendente | cobertura de webhooks ainda pendente |
| AUD-031 | em andamento | precedência interna corrigida; seletor explícito de contexto multi-role ainda pendente |
| AUD-032 | pendente | tipos gerados dependem de schema controlado de staging |
| AUD-033 | validado | migration incremental aplica FORCE RLS; teste SQL estático passou |
| AUD-034 | bloqueado | pgTAP comportamental requer PostgreSQL/Supabase de homologação; Docker é proibido |
| AUD-035 | pendente | persistência demo durável ainda pendente |
| AUD-036 | pendente | dispatcher/outbox de notificações ainda pendente |
| AUD-037 | pendente | logger e health checks reais ainda pendentes |
| AUD-038 | pendente | busca/catalogação server-side ainda pendente |
| AUD-039 | pendente | sitemap real ainda pendente |
| AUD-040 | corrigido | HSTS condicional e CSP dinâmica com nonce/strict-dynamic implementados; validação em navegador de staging pendente |
| AUD-041 | pendente | assets originais ainda precisam ser convertidos |
| AUD-042 | pendente | portal ainda precisa ser dividido e cacheado |
| AUD-043 | validado | loading/skeleton acessível do painel implementado; lint/typecheck passaram |
| AUD-044 | pendente | Playwright ainda precisa de teardown determinístico |
| AUD-045 | pendente | matriz mobile de todos os papéis ainda pendente |
| AUD-046 | pendente | componente de apresentação mobile para tabelas ainda pendente |
| AUD-047 | pendente | rotas internas ainda precisam de módulos próprios conectados |
| AUD-048 | pendente | feedback programático/teclado ainda incompleto |
| AUD-049 | pendente | Escape e retorno de foco do chat ainda pendentes |
| AUD-050 | pendente | quality gates de a11y/performance ainda pendentes |
| AUD-051 | adiado | contrato/flag de WhatsApp preservados; adapter real preparado para fase futura |
| AUD-052 | adiado | contratos futuros preservados com integrações desativáveis |

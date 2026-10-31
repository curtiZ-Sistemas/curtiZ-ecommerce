# Auditoria de pré-produção — 02/10/2026

**Conclusão: não apto para produção com as evidências disponíveis.** As correções locais abaixo foram verificadas, mas faltam testes essenciais de banco, autorização com contas reais isoladas, integrações externas e configuração de implantação. Os dez alertas de dependências da consulta inicial foram resolvidos na atualização posteriormente autorizada; a nova consulta npm retornou zero vulnerabilidades. Isso não permite declarar segurança ou conformidade integral.

## Base, autorização e método

- Base inicial: `51706b8` (`feat: integrate Resend transactional order emails`). A integração Resend já estava nesse commit quando esta auditoria começou.
- Estado inicial preservado: exclusões de `Tarefas_Melhorias/8-0.md` e `Tarefas_Melhorias/9.md`; edição de `docs/deployment.md`; novos `apps/store/AGENTS.md` e `apps/store/CLAUDE.md` gerados pelo Next. O pedido posterior autorizou incluir todas as alterações no commit.
- Inventário global, aprofundamento das fronteiras de autenticação, pagamentos, webhooks, filas, uploads e publicação de documentos; reprodução de defeitos; correções pequenas; testes; revisão do diff. Não houve leitura integral de todos os arquivos ou revisão manual de cada endpoint.
- Windows, 4 GB de RAM, sem Docker. Builds e testes de workspace executados sequencialmente; testes Vitest com um worker quando configurável. A execução inicial de lint concorreu com testes e provocou um timeout de empacotamento; esse teste passou isoladamente, sem aumentar seu timeout.
- Sem deploy, push, envio de mensagens, aplicação de migrations ou alteração de dados comerciais. Nenhum arquivo real de segredos foi aberto. Os testes de interface usam o modo demo existente, com Supabase e integrações desabilitados no processo, e não validam operações comerciais reais.

## Matriz de cobertura efetiva

| Área | Evidência examinada | Limite da conclusão |
| --- | --- | --- |
| Autenticação e autorização | `packages/security/src/demo-auth.ts`, controles de origem/corpo/logs em `security/src/index.ts`, `panel/src/lib/auth.ts`, `admin-api.ts`, seleção de painel, middleware e contratos de permissão | Sessão demo testada; autenticação Supabase, revogação de papéis, MFA e isolamento entre usuários ainda exigem execução real |
| Checkout, pedidos e pagamentos | Rotas de checkout/pagamento; cotação persistida e vinculada ao cliente/carrinho; transporte Mercado Pago; webhook; Edge Functions de preferência e reembolso; trechos das RPCs de reembolso | Testes existentes e inspeção; não houve pagamento, reembolso, corrida de estoque ou execução de Edge Function contra banco/provedor |
| Banco e RLS | Inventário de migrations/tests; implementação vigente de `private.has_permission`, MFA interno; SQL de filas de importação e e-mail; guards de faturamento/entrega e cancelamento | Testes estáticos verificam contratos textuais; não comprovam aplicação de migrations, políticas, concorrência ou transações |
| Bling | Autorização técnica, OAuth/state/callback, empresa da conexão, criptografia e leases do adaptador, assinatura/enfileiramento do webhook | OAuth, refresh concorrente, emissão fiscal e operação com conta real não executados; nenhuma alteração na migration Bling |
| Melhor Envio | Assinaturas/lifecycle e testes existentes de transporte, OAuth, cotações e jobs | Nenhuma etiqueta, remessa ou entrega externa real |
| Resend | Adaptador, jobs, SQL e testes revisados na etapa anterior; estado `suppressed`, idempotência, tentativas e confirmação persistida | Sem envio real; webhooks/receipts e pgTAP ainda precisam de ambiente isolado |
| Importação e arquivos | Worker de imagens completo; limites/origens/reencodificação; trechos de importação XLSX; scanner de anexos; exportações de atividades e financeiro | Transporte e estados do worker testados com respostas controladas; não houve Cloudflare Queue/Images/Storage real nem teste de arquivo comprimido hostil em produção |
| Privacidade e políticas | Canal de solicitações, consentimento no servidor, consulta de documentos publicados e páginas públicas | Falhas de consulta corrigidas; identidade da empresa, bases legais, retenção, respostas aos titulares e textos jurídicos dependem de responsáveis e dados reais |
| Loja, cliente e representante | Inventário de rotas/componentes; suíte existente; testes de carrinho/responsividade em demo | Cobertura parcial; não foi feito E2E real de todos os formulários, pedidos, avaliações, atendimento e comissões |
| Quatro painéis | Guards comuns e divisão de papéis; testes de workspace; build | Não equivale a validar cada tela/CRUD com usuários reais, permissões inadequadas e dados isolados |
| Deploy e cadeia de fornecimento | `package.json`, configurações Worker/OpenNext, CI/security workflows, validação de ambiente e exposição, auditoria npm | Sem acesso à configuração real de Cloudflare/Supabase/GitHub; empacotamento OpenNext local limitado por symlinks no Windows |
| SEO, desempenho e acessibilidade | Inventário e testes existentes, compilação e verificações de viewport selecionadas | Sem medição representativa de Core Web Vitals, teste de carga, leitor de tela ou auditoria WCAG completa |
| Backups e operação | Pendências registradas em `system-readiness.md`, documentação de implantação e requisitos de recuperação | Restauração, retenção dos logs, WAF/alertas e plano de incidentes não comprovados |

## Modelo de ameaças STRIDE

Fronteiras: navegador → loja/painel → Supabase Auth/RPC/RLS/Storage; provedores → webhooks → filas persistidas; cron/Queue → integrações; CI → bundles → Workers. Chaves de serviço pertencem ao servidor e ampliam a necessidade de validação explícita de atores e objetos.

| Categoria | Cenário relevante | Controle observado e validação pendente |
| --- | --- | --- |
| Spoofing | Sessão antiga, conta comprometida ou webhook forjado | `getUser`, perfil ativo, papéis/MFA aplicável, HMAC/timestamp; demo agora rejeitada quando desativada/produção. Falta provar revogação e MFA reais |
| Tampering | Alterar preço, proprietário, cotação, pagamento ou payload de fila | Totais/cotação no servidor, vínculo ao cliente, assinatura, lease e estados persistidos; corrigido ack após perda de lock. Falta concorrência real |
| Repudiation | Ação privilegiada sem rastreabilidade | Eventos/auditoria e códigos sanitizados existentes; faltam conferir persistência, retenção, acesso aos logs e recuperação |
| Information disclosure | BOLA, exportação de PII, segredo no bundle ou redirecionamento de transporte privilegiado | Guards, RLS declarada, limites de origem e verificadores de exposição; transporte Supabase do worker agora rejeita redirects. Falta teste entre contas e configuração implantada |
| Denial of service | Corpo/arquivo excessivo, fila em loop, indisponibilidade externa ou dependência com algoritmo caro | Limites de corpo/arquivo/pixels, timeouts, rate budgets, tentativas limitadas e DLQ declarada. Alertas npm resolvidos na atualização autorizada; faltam carga e execução de rate limit/RPC |
| Elevation of privilege | Demo em produção, papel removido ou RPC privilegiada acessível | Correção central demo; checagem de perfil/papel/permissão e grants restritos nos trechos lidos. Não há prova dinâmica de toda a superfície RLS |

Papéis esperados: cliente/representante restritos aos próprios objetos e vínculos autorizados; administrativo ao catálogo/gestão comercial; operacional a pedidos/expedição/estoque; gerencial a financeiro/aprovações; técnico a integrações/sistema. A presença de botões ou a ocultação na UI não comprova essa matriz. Testar os mesmos objetos pelas APIs e diretamente no banco, incluindo papéis expirados/removidos, perfil inativo e AAL insuficiente.

## Achados confirmados e correções

### A01 — Sessão demo aceita após desativação — médio, corrigido localmente

`verifyDemoSession` verificava assinatura/expiração, mas não o estado do modo demo. Um cookie válido continuava aceito se a chave permanecesse configurada depois de desligar a funcionalidade. Os consumidores incluem os guards de painel. Não foi comprovada escalada para mutações reais do banco.

Correção em `packages/security/src/demo-auth.ts`: exigir `DEMO_MODE=true` e `APP_ENV` diferente de produção na autenticação, criação e verificação de sessões e autorização do host demo. Dois casos reproduziram a falha antes da alteração; os sete testes demo passaram depois, incluindo produção com flag demo ligada.

### A02 — Autenticação/configuração do worker Supabase — médio, corrigido localmente

O worker enviava qualquer chave como `Authorization: Bearer`, incluindo `sb_secret_*`, que não é JWT; também aceitava origem com query/fragmento/credenciais e seguia redirecionamentos em chamadas privilegiadas. A documentação oficial exige enviar as novas chaves no header `apikey`, não tratá-las como JWT.

Correção em `apps/product-import-worker/src/index.ts`: normalizar origem HTTPS sem caminho/query/fragmento/credenciais, preservar Bearer somente para a chave legada e usar `redirect: error` em RPC/download/upload Supabase. Cinco casos falharam antes da correção. Os testes finais cobrem chaves legadas/novas e rejeição de configuração antes de chamar fetch. Não foi demonstrada exfiltração por um servidor Supabase real; o controle de redirects é defesa adicional.

### A03 — Confirmação incorreta de job após perda de lock — médio, corrigido localmente

O consumidor ignorava o resultado de `complete_product_import_image_job` e retornava `completed` mesmo quando a RPC retornava `stale` ou `missing`. Em falha, o resultado `stale` também era confirmado sem retry. A migration existente declara expressamente esses estados.

Correção no mesmo worker: respeitar a confirmação persistida, reagendar `stale`, manter `missing` terminal e tratar resposta desconhecida como falha transitória. Três casos reproduziram a divergência antes da alteração; os 12 testes finais do consumidor passaram. Isso verifica o contrato do consumidor, não uma corrida real de PostgreSQL/Cloudflare.

### A04 — Falha de consulta legal mascarada como ausência — médio, corrigido localmente

`legal-data.ts` retornava uma lista vazia após erro do banco; as páginas afirmavam que documentos estavam em revisão ou ainda não publicados. Uma exceção de transporte também podia derrubar a página.

Correção: devolver estado de indisponibilidade distinto de consulta vazia, propagá-lo para listagem/detalhe/metadados, exibir feedback e link de nova tentativa. Os documentos publicados continuam mapeados. Cinco casos inicialmente falharam; sete testes finais passaram, cobrindo transporte, configuração ausente, erro, lista vazia, slug ausente e documento publicado.

### A05 — Contratos de teste desatualizados — informativo, corrigido

- `scripts/custom-worker.test.ts`: incluir Bling/Resend na execução real do wrapper, aguardar `waitUntil` e verificar que a falha de uma fila não impede as outras. Sete testes aprovados.
- `runtime-environment.opennext.test.ts`: substituir comparação textual obsoleta do nome da variável por teste de isolamento de bindings entre requisições concorrentes. A delegação HTTP real permanece testada no wrapper da raiz. Quatro testes aprovados.
- Navegação da home: o seletor de uma seção fixa não corresponde à composição demo atual. O teste passou a usar o link de produto renderizado no conteúdo principal, preservando verificações de navegação, seleção de tamanho, adição e ausência de sincronização indevida.
- Menu mobile: a contagem arbitrária de oito links não corresponde à navegação configurável atual. O teste agora verifica Produtos/Atendimento/Favoritos e seus destinos, limites da viewport, fechamento por Escape e retorno de foco ao botão.

## Dependências: atualização autorizada e alertas resolvidos

Consulta inicial `pnpm audit --json` em 02/10/2026, antes da atualização: **9 alertas moderados e 1 baixo; nenhum alto/crítico**. Contagem por entradas do registro: Vitest/mocker compartilham um advisory; brace-expansion aparece em três versões. Um alerta não comprova que sua pré-condição está exposta pela aplicação.

| Versão na auditoria inicial | Caminho relevante | Alerta / versão corrigida indicada |
| --- | --- | --- |
| `uuid 8.3.2` | ExcelJS do painel | [GHSA-w5hq-g745-h8pq](https://github.com/uuidjs/uuid/security/advisories/GHSA-w5hq-g745-h8pq); `11.1.1` ou superior |
| `esbuild 0.27.3` | Wrangler | [GHSA-g7r4-m6w7-qqqr](https://github.com/evanw/esbuild/security/advisories/GHSA-g7r4-m6w7-qqqr); `0.28.1` ou superior; dev server Windows |
| `postcss 8.5.18` | Vitest/Vite | [GHSA-fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp); `8.5.23` ou superior |
| `qs 6.15.3` | OpenNext/AWS/Express | [GHSA-x5fp-wj9c-mxmx](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx) e [GHSA-4mjr-xmp4-gh2g](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g); `6.16.0` ou superior |
| `vitest` e `@vitest/mocker 3.2.7` | Ferramentas de testes | [GHSA-82fw-gwwq-j7x9](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9); `4.1.11`; sem backport para 3.x |
| `brace-expansion 1.1.20 / 2.1.6 / 5.0.11` | ESLint/glob/OpenNext | [GHSA-q2hr-2g5m-vwhr](https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-q2hr-2g5m-vwhr); `1.1.21 / 2.1.7 / 5.0.12` |

Atualização autorizada pelo usuário e instalada a partir de `e27a304`: Vitest `4.1.11` fixado nos nove manifestos; overrides PostCSS `8.5.23`, qs `6.16.0`, brace-expansion `1.1.21 / 2.1.7 / 5.0.12`, `exceljs>uuid=11.1.1` e `wrangler>esbuild=0.28.1`. O pnpm gerou o lockfile; a revisão dos pacotes alterados restringiu as mudanças aos alvos e à árvore do novo Vitest. Node `24.19.0`, pnpm `10.14.0`, Next e adaptador OpenNext foram preservados. A instalação usou `--ignore-scripts --child-concurrency=1 --network-concurrency=2`, sem executar scripts de instalação.

O bloqueio anterior da revisão automática foi resolvido pela autorização explícita do usuário para instalar/atualizar as versões propostas. A nova consulta `pnpm audit --json` retornou **zero alertas em todas as severidades** (964 dependências reportadas). Não foram suprimidos advisories nem alterados limiares de CI. A consulta é uma fotografia do registro nessa data, não prova ausência de vulnerabilidades ainda desconhecidas.

O pnpm apresentou avisos de pacotes depreciados e peers incompatíveis no fallback WASM opcional de `unrs-resolver` (`@emnapi/core`/`runtime`). Os pacotes desse aviso não foram alterados no diff do lockfile. Não se introduziu override para versões alpha nem se desativou a checagem; as verificações de compatibilidade estão registradas abaixo.

### Validação da atualização autorizada

Executada em 02/10/2026 com as versões instaladas e um worker. Não foi necessário alterar código da aplicação, contratos de teste ou limites de timeout para compatibilidade com o Vitest 4.

| Verificação | Resultado |
| --- | --- |
| `pnpm audit --json` | Zero vulnerabilidades em todas as severidades; 964 dependências reportadas |
| Testes XLSX de importação e exportação do painel | 19 testes em três arquivos aprovados; exercitam ExcelJS com UUID atualizado |
| `pnpm exec vitest run scripts tests/db-static --maxWorkers=1` | 316 testes em 81 arquivos aprovados |
| `pnpm --workspace-concurrency=1 -r --if-present run test --maxWorkers=1` | 1.148 testes aprovados: worker 12, config 54, domain 36, security 46, supabase 4, integrations 61, panel 239 e store 696. Com a raiz: **1.464 testes**, sem contar novamente os 19 testes XLSX |
| `pnpm typecheck:scripts` e typecheck recursivo sequencial | Aprovados em scripts e nos oito workspaces |
| ESLint em `scripts tests/db-static` e lint recursivo sequencial | Aprovados; o aviso do fallback WASM não impediu o lint local, mas esse fallback não foi exercitado separadamente |
| `pnpm --filter @curtiz/store build` e `pnpm --filter @curtiz/panel build` | Aprovados, incluindo scanner de exposição dos assets públicos; aviso existente de `middleware` permanece |
| `pnpm --filter @curtiz/product-import-worker deploy:dry-run` | Empacotamento Wrangler aprovado com esbuild atualizado, sem upload/deploy. Aviso de múltiplos ambientes sem alvo explícito; somente configuração de topo simulada |

A primeira execução direcionada de dez testes da raiz teve nove aprovações e um timeout de bundling enquanto concorria com os testes XLSX. A execução completa posterior foi sequencial e passou integralmente, sem aumentar o timeout. Builds e demais verificações pesadas também foram sequenciais.

O dry-run acima cobre apenas o consumidor de imagens. O empacotamento OpenNext das aplicações não foi repetido: permanece a limitação EPERM de symlinks no Windows observada anteriormente. Banco/pgTAP, integrações externas e E2E com dados reais não foram executados nesta atualização.

## Validações da auditoria inicial

| Verificação | Resultado |
| --- | --- |
| `pnpm lint` | Aprovado antes das correções; lint direcionado dos arquivos alterados aprovado depois |
| `pnpm typecheck:scripts` e `pnpm --workspace-concurrency=1 -r --if-present typecheck` | Aprovados em scripts e nos oito workspaces; typecheck store repetido após mudança do contrato legal, aprovado |
| `vitest run scripts tests/db-static --maxWorkers=1` | 308 testes aprovados inicialmente; falhas no contrato cron e timeout de bundling. As duas suites foram reexecutadas isoladamente: 10 testes aprovados |
| Testes de workspace sequenciais | Config 54, domain 36, security 46, supabase 4, integrations 61, panel 239 aprovados. Store: 688 aprovados inicialmente, um contrato textual obsoleto; suite correspondente reexecutada e aprovada (4). Sete novos testes legais aprovados. Worker: 12 finais aprovados |
| `pnpm check:exposure` | Aprovado; análise de fronteiras de código/configuração pública, sem prova de configuração remota |
| Builds Next store/panel e scanner de assets públicos | Aprovados; build store repetido após alterações das páginas legais. Aviso existente de migração `middleware` para `proxy` permanece; não é erro de compilação |
| `pnpm validate:production` | Rejeitou o ambiente do processo por ausência das variáveis exigidas. Não lê os `.env.local` das aplicações e não confirma o estado de configuração dos Workers reais |
| Auditoria npm | Executada após liberar a consulta de rede; 10 alertas acima. A tentativa inicial sem rede falhou com EACCES |
| pgTAP / banco local | Não executável: PostgreSQL local inacessível e Docker indisponível. A tentativa anterior de `pnpm test:db` não foi repetida sem mudança de ambiente |
| Build completo OpenNext | Tentativa anterior interrompida por EPERM na criação de symlink no Windows. Builds Next aprovados não comprovam bundle Worker ou deploy |
| Playwright local | Resultados e limites abaixo; somente demo isolada, sem banco/provedores |

Playwright: execução inicial de cinco cenários, três aprovados e dois seletores desatualizados (home/menu). Após corrigir os testes, os dois cenários foram reexecutados e aprovados; nenhum teste foi removido. O teste de rolagem horizontal passou em oito rotas (`/`, `/produtos`, produto demo, `/favoritos`, `/carrinho`, `/checkout`, `/login`, `/ajuda`) e 11 larguras: 320, 360, 375, 390, 412, 430, 768, 1024, 1280, 1440 e 1920 px. Também passaram seleção de itens do carrinho, cabeçalho mobile e navegação home → produto → carrinho. Isso não comprova checkout/persistência reais. Avisos existentes do logo como candidato LCP em desenvolvimento foram observados, sem medição de impacto em produção.

Páginas legais: oito verificações de listagem/detalhe sem Supabase em 320, 390, 768 e 1024 px passaram para mensagem de indisponibilidade, destino/visibilidade do retry e ausência de overflow; o retry da listagem foi acionado e preservou o estado correto. Captura local inspecionada em `.playwright-mcp/audit-politicas-390.png` (artefato ignorado pelo Git). Durante a captura apareceu um aviso React sobre um estilo temporário de caret; em página nova, sem screenshot e com interação real do botão de cookies, houve zero erros de console. Não foi confirmado defeito de hidratação da aplicação. A medição também confirmou que card, rodapé e botão de cookies permaneciam dentro da largura útil.

Painéis: tentativa manual com sessões demo locais e um servidor por vez interrompida por timeout de navegação `networkidle` em `/tecnico`. Não contabilizada como aprovação de E2E dos painéis; a tentativa não comprova defeito da aplicação. Os testes unitários e o build aprovados continuam válidos. Servidores locais iniciados nesta etapa encerrados.

## Pendências que impedem aprovação de produção

1. Executar migrations/pgTAP, RLS, `SECURITY DEFINER`/grants e ataques entre usuários/papéis em banco isolado; testar revogação, MFA, sessão expirada e conta desativada por API e banco.
2. Homologar checkout/estoque com concorrência, cotação expirada, repetição, pagamento divergente/duplicado, cancelamento e reembolso. As rotas Mercado Pago examinadas aceitam credenciais `TEST-*`; não comprovam prontidão para cobrança comercial real.
3. Validar OAuth/webhooks/jobs Bling/Melhor Envio/Resend, lease vencido, timeout após envio, reconciliação e DLQ com os serviços reais em homologação. Testar autenticação `sb_secret_*` e imagens em Queue/Images/Storage reais.
4. Executar build OpenNext/dry-run em ambiente compatível e conferir os nomes/bindings/flags das duas aplicações e do consumidor, CSP/cookies/TLS/domínios, cron, WAF, observabilidade e alertas implantados. Não realizar deploy automaticamente.
5. Comprovar backup/restauração, processamento de anexos pelo scanner real, retenção/recuperação de logs e resposta a incidentes.
6. Conferir com os responsáveis empresa/documentos publicados, atendimento aos titulares, consentimento/retirada e retenção, termos de compra/arrependimento, dados fiscais e emissão NF-e. Ausência de documentação local ou ambiente isolado não autoriza inventar dados comerciais.
7. Completar E2E com dados isolados dos seis perfis, validação assistiva WCAG e métricas de desempenho representativas. A inspeção e os testes selecionados não equivalem a cobertura integral.

Nenhuma suspeita de exploração foi convertida em vulnerabilidade crítica/alta sem reprodução. As pendências de infraestrutura e operação são verificações não executadas, não provas de que o serviço real está mal configurado.

## Referências e alcance

Fontes oficiais consultadas para enquadramento em 02/10/2026: [OWASP Top 10 2025](https://top10.owasp.org/2025/), [ASVS 5.0](https://owasp.org/projects/asvs), [API Security Top 10 2023](https://owasp.org/API-Security/editions/2023/en/0x11-t10/), [WSTG](https://owasp.org/projects/web-security-testing-guide), [NIST CSF 2.0](https://www.nist.gov/cyberframework), [ISO/IEC 27001:2022](https://www.iso.org/standard/27001), [CVSS 4.0](https://www.first.org/cvss/v4.0/), [WCAG 2.2](https://www.w3.org/TR/WCAG22/), [LGPD](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm), [Decreto 7.962/2013](https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2013/decreto/d7962.htm) e [biblioteca PCI SSC](https://www.pcisecuritystandards.org/document_library/).

Essas referências orientam o escopo; não foi executada avaliação requisito a requisito, atribuído vetor CVSS sem dados suficientes, determinado escopo PCI com o adquirente nem conduzida certificação ISO/PCI ou parecer jurídico/contábil. A classificação local é baseada no defeito reproduzido e nas condições observadas.

Referências técnicas: [chaves Supabase](https://supabase.com/docs/guides/getting-started/api-keys), [migração Vitest 4](https://v4.vitest.dev/guide/migration), [exports UUID 11.1.1](https://github.com/uuidjs/uuid/blob/v11.1.1/package.json). Controles e testes complementares do projeto: [ameaças](threat-model.md), [testes de segurança](security-testing.md), [prontidão funcional](system-readiness.md), [implantação](deployment.md).

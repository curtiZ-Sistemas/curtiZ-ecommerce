# curti Z — instruções de trabalho

E-commerce comercial de sandálias e chinelos, principalmente para a Geração Z. Prioridades: segurança; integridade de pedidos, pagamentos e estoque; autenticação e autorização; regras de negócio; funcionalidade; estabilidade; UX, mobile e acessibilidade; performance; UI; manutenção.

## Ambiente

- Windows, notebook com **4 GB de RAM**. Economize memória e processamento.
- Node.js >=24.19.0; pnpm 10.14.0. Use pnpm; não reinstale Node sem necessidade.
- `apps/store`: loja; `apps/panel`: painéis; `packages/*`: código compartilhado.
- Supabase: fonte de verdade. Deploy: Cloudflare Workers + OpenNext.
- Docker não está disponível. Banco local só é requisito quando a validação depender dele; continue verificações independentes e informe limitações.
- Preserve arquitetura, funcionalidades, dados e alterações existentes.

## Leitura focada e reaproveitamento de contexto

**Não leia nem releia o repositório inteiro a cada tarefa.** Use o contexto já disponível e leia somente o código necessário para entender e alterar o fluxo solicitado com segurança.

1. Leia este arquivo, instruções aplicáveis em subdiretórios e a solicitação atual. Leia `TAREFA.md` quando indicado; sua presença não autoriza executar tarefas antigas.
2. Execute `git status --short` e preserve alterações preexistentes.
3. Identifique o escopo (store, panel, packages, Supabase ou deploy). Use `rg --files` e `rg` primeiro nos diretórios diretamente envolvidos, sem enumerar todo o projeto por padrão.
4. Leia as funções, componentes, contratos e dependências imediatas necessários. Abra o arquivo completo somente quando os trechos não bastarem para compreender o comportamento. Amplie a investigação apenas diante de uma dependência real ou dúvida concreta.
5. Reaproveite arquivos e diagnósticos já presentes no contexto. Não releia conteúdo inalterado por rotina; confirme o estado atual dos trechos antes de editar quando houver possibilidade de mudanças desde a última leitura.
6. Após interrupção, continue do progresso registrado. Atualizações de status, esclarecimentos e novas tarefas não exigem reiniciar a investigação global. Se faltar contexto, recupere apenas o necessário.

Exclua dependências e artefatos: `node_modules`, `.git`, `.next`, `.open-next`, `dist`, `build`, `.turbo`, `.cache`, `coverage`, relatórios gerados, source maps, binários, backups, dumps e lockfiles completos. Não abra arquivos de segredos, credenciais ou `.env` reais para cumprir esta regra. Examine apenas nomes de variáveis e exemplos sem valores sensíveis quando necessário.

Pare de investigar quando a causa, a solução e as dependências afetadas estiverem claras. A ausência de leitura de áreas não relacionadas não bloqueia a implementação. Não afirme ter analisado arquivos ou fluxos que não examinou.

## Execução econômica

- Não transforme uma correção localizada em auditoria geral. Investigue profundamente apenas o fluxo afetado e suas dependências reais.
- Para tarefas grandes, faça plano de até cinco passos. Para correções simples, execute diretamente.
- Procure implementação existente; faça a menor mudança completa que resolva a causa.
- Não repita buscas resolvidas, diagnósticos, comandos ou testes sem mudança relevante, falha ou dúvida pendente.
- Use um servidor local por vez. Execute builds e testes pesados sequencialmente, com um worker quando configurável. Não use subagentes salvo solicitação explícita.
- Não instale dependências, atualize versões, mova arquivos ou refatore áreas não relacionadas.
- No navegador, visite telas afetadas e capture somente evidências úteis. Aguarde carregamento; erro de automação não comprova defeito da aplicação.
- Em bloqueios de ambiente, faça diagnóstico focado; não transforme a tarefa em reparo de infraestrutura. Conclua partes independentes e registre o bloqueio.
- Não peça novamente autorização concedida. Esclareça apenas informações necessárias para decidir corretamente.
- Economizar créditos nunca justifica remover validações, ignorar segurança, esconder erros ou omitir testes necessários.

## Segurança e preservação

- Nunca exponha senhas, tokens, cookies, secrets ou dados pessoais desnecessários. Não coloque `service_role` no navegador nem transforme segredos em `NEXT_PUBLIC_*`; esse prefixo significa público.
- Valide no servidor sessões, status, papéis, permissões e MFA aplicável. Proteja acesso direto ao banco quando existente; não confie somente na UI.
- Preserve RLS; não a desative para corrigir erros. Não invente credenciais nem apague dados para simplificar correções.
- Valide/recalcule preços, descontos, estoque, frete e totais no servidor. Preserve transações, idempotência e consistência nos fluxos críticos.
- Mudanças de schema exigem migration incremental nova. Não altere migrations aplicadas, execute seed em produção ou aplique migrations destrutivas em produção automaticamente.
- Preserve autenticação, sessões, usuários, permissões, produtos, carrinho, favoritos, pedidos, pagamentos, avaliações, atendimento, integrações, painéis e variáveis de ambiente.
- Não substitua implementação real por mock para mascarar problemas. Não crie ações falsas nem invente preços, avaliações, promoções, estoque ou informações comerciais.
- Avaliação não autoriza publicação, mensagens ou alteração de dados comerciais. Prefira ambiente isolado para testes que gravam dados.

## Loja e acessibilidade

- Preserve a paleta atual. A experiência é mobile-first, jovem sem ser infantil, profissional e orientada aos produtos.
- Melhore composição, fotografia, tipografia, hierarquia, espaçamento, grid e interação. Evite glassmorphism excessivo, neon, blobs, 3D genérico, sombras/arredondamento exagerados, cards em tudo e aparência de landing page SaaS.
- Mudanças visuais não podem quebrar funcionalidades, deformar imagens ou esconder conteúdo importante.
- Considere 320, 360, 390, 430, 768, 1024 px e desktop. Valide larguras representativas e limites dos breakpoints afetados; amplie quando houver problema.
- Evite overflow horizontal, conteúdo cortado, alvos pequenos, modais fora da viewport, elementos fixos cobrindo ações, tabelas comprimidas e layout shift perceptível.
- Preserve rótulos acessíveis, teclado, foco visível e gerenciamento de foco dos modais. Respeite `prefers-reduced-motion`; prefira CSS/APIs nativas a bibliotecas pesadas.

## Painéis

Priorize clareza, produtividade e segurança. O usuário deve entender onde está, pendências, ações permitidas e seus resultados.

- Administrativo: catálogo, clientes, marketing e gestão comercial, respeitando permissões existentes.
- Operacional: pedidos, estoque, separação, expedição e atendimento.
- Gerencial: indicadores, financeiro, relatórios, aprovações e estratégia.
- Técnico: sistema, logs, segurança, integrações, backups e acessos.

Preserve essa divisão e os agrupamentos existentes; não transforme tudo no mesmo CRUD. Inclua loading, erro, retry, vazio, busca, filtros, feedback e confirmação destrutiva quando aplicáveis. Diferencie ausência de dados de falha na consulta. Uma falha isolada não deve derrubar todo o painel nem ser mascarada. Use linguagem compreensível nos textos comuns.

## Código, Git e deploy

- Preserve TypeScript estrito; evite `any`, duplicação, código morto, `console.log` de depuração e erros de hidratação. Reutilize componentes e separe regras de negócio da UI.
- Não use `!important` como padrão nem silencie lint, TypeScript, warnings ou testes para concluir.
- Antes de alterar deploy, identifique store ou panel e confira seu `package.json`, `wrangler.jsonc`, OpenNext, nomes de variáveis e URLs. Leia `docs/deployment.md` somente nesse escopo.
- Reproduza o erro e corrija a causa. Não altere runtime, adaptador, build e Worker simultaneamente sem evidência.
- Não faça deploy de produção sem solicitação. Não execute commit, push, force push, reescrita de histórico, `git reset --hard` ou descarte de alterações do usuário sem solicitação.

## Validação e conclusão

Valide progressivamente: teste específico, typecheck do workspace afetado, lint relevante, testes relacionados e build quando necessário. Validação global exige justificativa; não repita `pnpm check` ou builds completos por pequenas mudanças.

Autenticação, autorização, RLS, pedidos, estoque, checkout, pagamentos, migrations, segurança e deploy exigem maior validação, incluindo falhas relevantes. Buscar texto em SQL não comprova RLS, concorrência ou execução real. Abrir uma página ou receber HTTP 200 não comprova o fluxo inteiro.

Finalize quando o pedido estiver implementado, regras preservadas, regressões relacionadas verificadas e limitações registradas. Revise o diff final e os arquivos alterados; não reinicie leitura global nessa etapa. Encerre somente processos iniciados por você que não sejam mais necessários. Pare sem adicionar melhorias opcionais.

Resposta final curta: alterações, principais arquivos, validações realmente executadas e pendências reais. Distinga achado confirmado, hipótese e comportamento não testado. Não copie logs completos, repita a solicitação ou prometa consumo de créditos que não consegue medir.

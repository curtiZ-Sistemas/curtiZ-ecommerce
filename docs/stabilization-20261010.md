# Recuperação e estabilização — 10/10/2026

Branch de integração: `fix/stabilization-integration-20261010`. PR: https://github.com/curtiZ-Sistemas/curtiZ-ecommerce/pull/16.

O PR incorpora a base do Work, commit `429458f144db8e92fa2cb2a7f13619416b7b3803` do PR #15, e o mecanismo do Claude Opus 5.5, commit `5b130d6fc77e14a997b8ca592a4f5dd0fd299cdf`. A sessão original no VS Code e suas alterações foram preservadas; integração e validação ocorreram em worktree própria.

## Falhas e correções

| Falha confirmada | Causa | Correção e alcance |
| --- | --- | --- |
| Login podia usar GET antes da hidratação | Formulário SSR tinha método padrão e submit habilitado antes do handler | Login/cadastro usam POST explícito e aguardam hidratação antes de habilitar o envio; teste SSR verifica essa proteção |
| Renovação SSR não disponibilizava o cookie novo à mesma requisição | O cabeçalho Cookie encaminhado permanecia antigo depois de `setAll` | Middleware da loja e painel encaminha o cookie atualizado, preserva persistência, remoção e respostas privadas sem cache; rewrite 404 conserva cookies |
| Consulta pública repetia validação de usuário desnecessariamente | A renovação de sessão era usada também na entrada pública | Sem cookie Supabase, a loja segue diretamente; com cookie, renova sem usar `getSession` como decisão de autorização. Rotas protegidas continuam validando `getUser` |
| Chave de criptografia substituída podia inutilizar tokens existentes | Ciphertext v1 não identifica chave e o leitor conhecia uma chave só | Leitura v1/v2 com chaves anteriores autorizadas, escrita v2 na ativa, AAD por campo e recriptografia atômica por CAS; refresh OAuth e locks preservados |
| Diagnóstico poderia liberar retirada de chave anterior prematuramente | Uma evidência antiga ou de outro ambiente/chave não comprova convergência | Confere ambos os tokens, ambiente, identificador de chave e cotação online recente da loja; protocolo em duas fases documentado em `melhor-envio-key-rotation.md` |
| Configuração inválida do painel podia escolher sandbox silenciosamente | Fallback aceitava qualquer texto de ambiente | Valor inválido falha antes de acessar credenciais ou consumir estado OAuth; desconexão/status também falham com segurança |
| Dependency Review não era suportado pelo repositório | A ação dependia de recurso indisponível | Auditoria pnpm de dependências de produção e desenvolvimento permanece obrigatória. A revisão nativa é opcional somente quando habilitada e suportada; alternativa explicitada no workflow |
| Seed e fixtures SQL falhavam na guarda de publicação | Produto ativo era inserido antes de sua imagem | Fixtures nascem em draft, recebem metadados de imagem e depois são publicadas. Guarda e RLS permanecem ativas; imagens SQL de teste não comprovam objetos reais no Storage |
| Função de exclusão referenciava `pg_catalog.greatest` | GREATEST é construção SQL, não função qualificável dessa forma | Migration incremental `202610100002` conserva locks, dependências, permissões e lógica de exclusão |
| Funções de financeiro e navegação tinham referências ambíguas | Variável PL/pgSQL colidia com nome de coluna | Migrations incrementais `202610100003` e `202610100004` qualificam ou renomeiam somente referências necessárias |
| Lint do banco interrompeu o CI após o seed corrigido | `enqueue_transactional_email.job_id` não é um qualificador válido da variável local | Migration `202610100005` usa `v_job_id`, preservando elegibilidade, idempotência e grants; pgTAP verifica vínculo com o job |
| HTTP 429 na suíte demo | Muitos testes autenticavam a mesma conta, compartilhando orçamento entre projetos e preparação | Sessão assinada obtida pelo endpoint real é reutilizada na preparação por worker; projetos CI isolados e um worker por projeto. Testes de login/logout continuam reais e o rate limit não muda |
| Retry do catálogo falhava no teste | Primeira requisição simulada podia ser abortada pelo Strict Mode, tornando a segunda bem-sucedida antes do retry | Fixture mantém falha até clique explícito e verifica uma consulta bem-sucedida depois dele |
| Histórico privado sumia no teste | Consentimento da fixture não tinha `id` e `policyVersion` válidos | Corrige formato da fixture, mantendo exigência de consentimento |
| Checkout E2E esperava 400 e campos antigos | CI desativa novas compras; UI atual exige endereço salvo e seleção de frete | Verifica 503/CHECKOUT_DISABLED real e carrinho preservado; fixtures explícitas de endereço/frete exercitam somente o contrato da interface. Abandono de pagamento continua cenário isolado, sem compra real |
| Testes procuravam chat e vitrine antigos | Widget já estava desativado no layout; home usa também carrossel flex | Testa acesso real à Central de Ajuda e ausência do launcher, grid/carrossel atual e overflow. Layout e design permanecem iguais |
| Foco saía da galeria aberta | Cleanup do Strict Mode deixava timer de restauração pendente | Nova montagem cancela timer antigo; fechamento real restaura foco ao acionador |
| Atendimento escondia erro da primeira consulta | Renderização dependia de autenticação já resolvida, que permanecia null na falha | Falha inicial visível, retry e distinção de lista vazia; autorização de escrita continua no servidor |
| Builds do PR eram escondidos por falhas de banco/E2E | Condição dos jobs exigia sucesso de todas as dependências também em PR | PR verifica bundle/dry-run após qualidade e segurança; publicação de produção ainda exige banco, E2E e todos os gates |
| Execução nova ficava na fila durante builds antigos | `always()` na condição de build mantinha execução mesmo após cancelamento | `!cancelled()` permite verificar PR após falhas, respeita cancelamento e mantém todos os gates de produção; conforme [documentação do GitHub](https://docs.github.com/en/actions/reference/workflows-and-actions/expressions#always) |

Outras fixtures SQL corrigidas: assinatura atual de finalização de pagamento, UUID do anexo de suporte, datas relativas à janela de devolução e CTE de banner em posição SQL válida. Migrations aplicadas não foram editadas.

A execução PostgreSQL posterior passou pelo seed, lint e testes de rotação/email. Revelou fixtures que assumiam permissões de papéis antigas, acesso financeiro direto e dois cards para uma mesma cor. Casos negativos agora usam negações explícitas; leituras financeiras usam o snapshot autorizado em views temporárias da transação de teste; publicação de produto usa draft/imagem/publicação pela RPC. A tentativa de alteração de versão jurídica verifica zero linhas afetadas pela RLS e a preservação do snapshot.

Essa execução também confirmou que DELETE direto não removia sessões de importação expiradas e invisíveis por SELECT RLS. Migration `202610100006` adiciona limpeza autorizada apenas das sessões do próprio usuário; preview/cancelamento usam a RPC. SELECT permanece restrito. Os oito casos SQL de privilégio, dono, cliente, expiração e preservação de sessão ativa passaram no CI `38083321899`, assim como rotação, email, homepage, conteúdo jurídico e importação. Duas fixtures corrigidas nessa execução ainda abortaram por delimitador SQL inválido e variante sem ID; ambos foram corrigidos para nova execução, preservando a verificação negativa e a atualização real pela RPC.

A mesma execução identificou contratos E2E desatualizados: login da loja para o painel estava no job que inicia apenas a loja (movido à suíte das duas aplicações, em desktop/mobile); recomendação usava imagens demo rejeitadas e não interceptava GET com query (fixtures isoladas de famílias/imagens distintas, interceptação e ativação por scroll); consentimento incompleto cobria o checkout mobile (fixture válida); atendimento mobile procurava link desktop (abre o menu real); confirmação de exclusão procurava o texto antigo do botão; seletor genérico de `main` conflitou com o loading do painel (verifica `#panel-content`). Nenhum teste foi removido ou desativado para ocultar essas falhas.

## Revisão do Claude

O Claude Opus 5.5 desenvolveu o mecanismo de criptografia e revisou autenticação/CI e integração da rotação em execuções de leitura. Suas observações sobre ambiente inválido, restrição do RPC ao Melhor Envio e limites da validação foram incorporadas. A revisão adicional de E2E não terminou: a sessão atingiu o limite de uso. Não há aprovação do Claude para os ajustes E2E posteriores.

## Evidência e limites

Foram executados testes unitários de autenticação/cookies/papéis, criptografia, refresh/CAS, configurações, diagnósticos de frete e workflow, typechecks dos workspaces afetados e lint dos arquivos alterados. A suíte estática SQL passou com 74 arquivos/253 testes antes da última migration; é inspeção estática, não prova de execução de RLS ou concorrência PostgreSQL.

No CI do snapshot integrado, qualidade, CodeQL, histórico de secrets e auditoria de dependências passaram. O seed passou; o lint revelou a referência de email acima, corrigida no snapshot seguinte. Resultados definitivos do último commit devem ser consultados no PR, sem tratar execuções de commits anteriores como aprovação atual.

Após a proteção de hidratação, os três E2E locais de retorno ao atendimento, sessão/persistência/logout e favoritos entre páginas passaram (Chromium, desktop, um worker, ambiente demo). Também passaram separadamente galeria/foco, retry do catálogo, histórico consentido, recuperação 404 genérica, carrossel mobile, abandono de pagamento e checkout desativado. Algumas tentativas anteriores falharam ou foram interrompidas; não são contabilizadas como aprovação da suíte completa. O lote estático/rotas/formulário mais recente passou com 76 arquivos/263 testes, seguido de 11 testes de formulário e importação; os conjuntos se sobrepõem e não devem ser somados como testes únicos.

Após esses ajustes, também passaram localmente recomendações em 320–1440 px, atendimento mobile e abandono de pagamento mobile com carrinho preservado. O teste de abandono usa resposta isolada de checkout e chave pública fictícia; o SDK sinalizou falha de inicialização dessa chave. O resultado verifica navegação/preservação do carrinho, sem validar criação de pagamento. Lint E2E, typecheck E2E e cinco verificações estáticas de migrations passaram; PostgreSQL e a suíte completa dependem da nova execução CI.

Os builds/dry-run Linux da loja e do painel nos snapshots intermediários `354673a6...` e `6b3a8ee0...` passaram. Isso não aprova o bundle do commit final nem a produção.

Audit local `--audit-level high` terminou com sucesso sob a configuração já existente. Há um aviso moderado de `fflate` e uma exceção preexistente para `GHSA-vfj7-8cjw-p6xm`; não foram acrescentadas exceções nem alteradas dependências. Sucesso dessa auditoria não significa ausência de vulnerabilidades.

Docker indisponível neste notebook: PostgreSQL/pgTAP depende do CI isolado. Testes CAS em TypeScript e casos SQL sequenciais de leitor obsoleto não comprovam concorrência real de duas conexões PostgreSQL.

Build local da loja parou na restrição de Turbopack para junction fora da raiz da worktree. Build Next/webpack do painel concluiu, mas empacotamento OpenNext parou com EPERM de symlink no Windows. Configuração de runtime/adaptador não foi alterada para contornar o ambiente; builds Linux do CI são a validação de bundle.

## Produção

Inspeção remota somente de leitura confirmou builds publicados dos Workers oficiais `curtiz-ecommerce` e `curtiz-painel` vinculados ao commit do Work `429458f...`, Cron da loja `*/5 * * * *`, URLs oficiais/aliases e exclusão dos gatilhos alternativos de Workers Builds. Metadados de runtime de commit ainda não são confiáveis: loja tinha identificador de build anterior e painel não informava SHA. Próxima publicação autorizada via GitHub Actions deverá atualizar os metadados.

Supabase estava saudável. Metadados mostraram credencial Melhor Envio sandbox conectada, em formato v1, sem registro de produção nem erro registrado. Não foram lidos tokens/chaves nem executada tentativa remota de descriptografia. A troca recente de chave é uma hipótese coerente para falha de leitura; conexão marcada como ativa não comprova cotação funcional.

Não houve alteração de dados comerciais remotos, seed remoto, compra, pagamento, mensagem externa, deploy, merge em main ou rotação real de secrets. Contagens agregadas de produtos/pedidos/pagamentos/estoque/perfis foram inspecionadas; não constituem comparação de conteúdo de todas as linhas.

Para concluir recuperação operacional: confirmar CI do commit final, disponibilizar a migration CAS e o mesmo conjunto de chaves autorizadas aos dois Workers por implantação aprovada, manter a chave antiga se disponível ou reconectar OAuth com segurança se perdida, confirmar cotação recente e login real/MFA com contas de teste autorizadas dos quatro papéis. Não retirar chave anterior antes dos critérios documentados. O PR está preparado para revisão; a produção ainda não está validada de ponta a ponta.

## Publicação rastreável

Git nativo perdeu autenticação nesta sessão. A publicação usa o conector GitHub autenticado, verificando SHA de cada blob e igualdade exata da árvore com o commit local, seguida de atualização fast-forward com SHA esperado. Commits remotos podem ter SHA diferente por autoria/data da API, com fontes locais registradas na mensagem. Nenhum force push ou reescrita da branch local foi realizado.

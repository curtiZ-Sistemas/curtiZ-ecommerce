# Curtiz — regras de desenvolvimento

## Objetivo

A Curtiz é um e-commerce multimarcas que deve funcionar como um produto comercial real: seguro, rápido, acessível, responsivo, confiável e visualmente próprio.

A loja pública tem prioridade mobile. O painel administrativo deve manter clareza operacional, segurança e consistência com o design system do projeto.

# Eficiência de contexto, tempo e créditos

O agente deve trabalhar de forma econômica, sem reduzir a qualidade, a segurança ou a confiabilidade da implementação.

## Princípio geral

Usar somente o contexto, os arquivos, os comandos e as validações necessários para concluir corretamente a tarefa atual.

Economizar créditos nunca justifica:

* ignorar segurança;
* deixar erros;
* evitar testes necessários;
* entregar implementação incompleta;
* quebrar regras de negócio;
* pular validações críticas;
* reduzir a qualidade da experiência mobile;
* afirmar que algo foi validado sem ter sido.

## Leitura seletiva do repositório

Antes de ler arquivos:

1. Identificar o escopo exato da tarefa.
2. Localizar arquivos por nome, importação, rota, componente ou busca textual.
3. Ler primeiro os arquivos diretamente relacionados.
4. Expandir a análise somente quando surgirem dependências relevantes.
5. Evitar ler o repositório inteiro para tarefas localizadas.
6. Evitar abrir arquivos gerados, dependências ou artefatos de build.

Não ler recursivamente, salvo necessidade técnica:

* `node_modules/`;
* `.next/`;
* `dist/`;
* `build/`;
* `.git/`;
* `.turbo/`;
* `.cache/`;
* `coverage/`;
* arquivos de lock completos;
* arquivos minificados;
* mapas de source;
* logs extensos;
* imagens binárias;
* artefatos gerados;
* backups;
* dumps;
* arquivos temporários.

Arquivos de lock podem ser inspecionados somente quando a tarefa envolver dependências, versões, vulnerabilidades ou instalação.

## Contexto progressivo

Usar investigação progressiva:

1. Ler a tarefa.
2. Consultar `AGENTS.md`.
3. Localizar os arquivos diretamente envolvidos.
4. Ler somente as seções necessárias.
5. Verificar importações e dependências imediatas.
6. Expandir o contexto apenas quando necessário.
7. Parar de investigar quando houver informação suficiente para implementar com segurança.

Não continuar explorando o projeto apenas para produzir uma análise mais longa.

## Reutilização do contexto já obtido

Durante a mesma tarefa:

* não reler arquivos que não foram alterados;
* não repetir buscas que já responderam à dúvida;
* não reconstruir o mesmo diagnóstico;
* não repetir explicações já registradas;
* não executar novamente comandos idênticos sem uma alteração relevante;
* reutilizar os resultados válidos obtidos anteriormente.

Reler um arquivo somente quando:

* ele tiver sido alterado;
* houver dúvida sobre seu conteúdo atual;
* outra alteração puder ter afetado seu comportamento;
* a validação exigir confirmação.

## Planejamento proporcional

Para tarefas pequenas, produzir apenas um plano curto.

Não criar:

* auditoria completa;
* documento de arquitetura;
* relatório extenso;
* lista de todas as páginas;
* análise de todo o sistema;

quando a tarefa estiver limitada a um componente, correção ou fluxo específico.

Para tarefas grandes, dividir em fases, mas não repetir o plano inteiro antes de cada fase.

## Alterações focadas

Preferir:

* modificar apenas os arquivos necessários;
* fazer alterações localizadas;
* reutilizar componentes existentes;
* preservar interfaces públicas;
* evitar refatorações não solicitadas;
* evitar reorganizações sem impacto direto;
* evitar formatação global;
* evitar mudanças em arquivos não relacionados.

Não reformular partes estáveis do projeto apenas porque foram encontradas durante outra tarefa.

Problemas fora do escopo devem ser registrados de forma curta, sem serem corrigidos automaticamente, exceto quando representarem risco crítico de segurança, perda de dados ou impedimento direto à tarefa.

## Uso eficiente de comandos

Antes de executar um comando:

1. Confirmar que ele ajuda a validar ou concluir a tarefa.
2. Preferir comandos específicos antes dos comandos globais.
3. Evitar comandos repetidos sem mudanças relevantes.
4. Agrupar verificações compatíveis quando possível.
5. Não manter servidores ou processos rodando sem necessidade.

Exemplos de validação progressiva:

1. teste específico do componente;
2. typecheck do escopo, quando suportado;
3. lint dos arquivos alterados, quando suportado;
4. testes relacionados;
5. validação global antes da conclusão de mudanças relevantes.

Não executar o build completo após cada pequena edição.

Executar o build completo:

* ao final de uma tarefa relevante;
* após alteração de configuração;
* após alteração de dependência;
* após mudança de rota, renderização ou deploy;
* quando necessário para reproduzir um erro.

## Testes proporcionais ao risco

Para alterações pequenas e isoladas:

* testar o fluxo afetado;
* executar lint relacionado;
* executar typecheck adequado;
* verificar regressões próximas.

Para alterações em áreas críticas, executar validação ampliada.

Áreas críticas incluem:

* autenticação;
* autorização;
* pagamentos;
* pedidos;
* banco de dados;
* Supabase;
* RLS;
* webhooks;
* variáveis de ambiente;
* checkout;
* deploy;
* segurança;
* migrações;
* dados pessoais.

Não reduzir testes em áreas críticas para economizar créditos.

## Saída concisa

Durante a execução, evitar respostas excessivamente longas.

Informar somente:

* o que foi identificado;
* o que será alterado;
* o resultado da implementação;
* validações executadas;
* erros ou pendências reais.

Não repetir:

* a solicitação do usuário;
* todo o conteúdo deste arquivo;
* descrições extensas de arquivos;
* código completo que já está no repositório;
* logs completos quando apenas algumas linhas são relevantes;
* listas de arquivos não alterados.

Resumir logs e erros, preservando as linhas necessárias para diagnóstico.

## Documentação sob demanda

Criar ou atualizar documentação somente quando:

* a tarefa solicitar;
* houver mudança arquitetural;
* houver nova integração;
* houver alteração de segurança;
* houver mudança de deploy;
* houver nova regra de negócio;
* a informação for necessária para manutenção futura.

Não criar vários documentos Markdown para uma correção pequena.

Quando já existir documento adequado, atualizá-lo em vez de criar outro.

## Dependências

Não pesquisar, comparar ou instalar várias bibliotecas quando:

* o projeto já possui solução adequada;
* uma implementação simples resolve;
* a tarefa não exige nova dependência.

Ao avaliar dependências, limitar a análise às opções realmente viáveis.

## Navegação externa

Não usar pesquisa externa para decisões que possam ser resolvidas pelo próprio repositório.

Usar documentação externa quando:

* a API ou biblioteca puder ter mudado;
* houver erro específico de versão;
* for necessária confirmação oficial;
* a implementação envolver segurança;
* não houver informação suficiente no projeto.

Priorizar documentação oficial e evitar consultar várias fontes que repetem a mesma informação.

## Critério de parada

Parar a investigação quando:

* a causa estiver identificada;
* os arquivos envolvidos estiverem conhecidos;
* a solução puder ser aplicada com segurança;
* os critérios de validação estiverem definidos.

Parar a implementação quando:

* a tarefa estiver concluída;
* os testes necessários tiverem sido executados;
* não houver regressões relacionadas;
* as pendências reais estiverem registradas.

Não continuar fazendo melhorias opcionais sem solicitação.

## Relatório final econômico

O relatório final deve conter apenas:

1. resumo das alterações;
2. arquivos principais modificados;
3. validações executadas;
4. resultado dos testes;
5. pendências reais.

Não gerar relatório detalhado por arquivo, componente ou linha, salvo quando solicitado.


## Arquitetura

* Monorepo gerenciado com pnpm e Turborepo.
* Loja pública em `apps/store`.
* Painel administrativo em `apps/panel`.
* Código compartilhado deve permanecer nos pacotes adequados, evitando duplicação entre loja e painel.
* Supabase é a fonte de verdade.
* Toda alteração de banco exige migration incremental e versionada.
* Nunca alterar migrations que já tenham sido aplicadas.
* Operações sensíveis devem ser validadas no servidor e protegidas por RLS.
* Ocultar controles no frontend não representa autorização.
* Integrações usam contratos em `packages/integrations`.
* Mocks são permitidos somente fora de produção e quando controlados por configuração.
* Valores monetários de domínio devem usar centavos inteiros.
* Nunca usar `number` fracionário para cálculos financeiros.
* Datas devem ser armazenadas em UTC.
* Datas devem ser apresentadas em `pt-BR`, considerando `America/Sao_Paulo`.

## Ordem de prioridade

Ao tomar decisões, respeite:

1. Segurança e proteção de dados.
2. Integridade de pedidos, pagamentos e estoque.
3. Preservação das regras de negócio.
4. Funcionamento das integrações.
5. Experiência mobile da loja.
6. Acessibilidade.
7. Performance.
8. Qualidade visual.
9. Manutenibilidade.
10. Documentação.

Uma melhoria visual nunca deve quebrar autenticação, autorização, banco, carrinho, pedidos, checkout, avaliações, painel ou deploy.

## Antes de alterar código

Antes de editar:

1. Leia a solicitação atual e determine seu escopo.
2. Verifique `git status`.
3. Identifique se a tarefa pertence à loja, ao painel, a um pacote compartilhado ou à infraestrutura.
4. Localize os arquivos diretamente relacionados.
5. Procure componentes, hooks, serviços e utilitários existentes antes de criar novos.
6. Identifique regras de negócio, contratos e integrações afetadas.
7. Preserve alterações não relacionadas feitas pelo usuário.
8. Para tarefas grandes, apresente um plano curto antes da implementação.

Não faça uma leitura completa do monorepo quando a tarefa for localizada.

## Eficiência de contexto e créditos

Use apenas os arquivos, comandos e documentos necessários para a tarefa atual.

Não examine recursivamente, salvo necessidade técnica:

* `node_modules/`;
* `.next/`;
* `dist/`;
* `build/`;
* `.turbo/`;
* `.git/`;
* `coverage/`;
* caches;
* arquivos minificados;
* source maps;
* logs extensos;
* artefatos gerados.

Durante a mesma tarefa:

* não repita buscas já resolvidas;
* não releia arquivos inalterados sem motivo;
* não repita diagnósticos;
* não execute comandos idênticos sem alteração relevante;
* não faça refatorações fora do escopo;
* não crie documentação para mudanças triviais;
* não produza relatórios extensos sem necessidade.

Investigue de forma progressiva:

1. arquivo diretamente afetado;
2. importações e dependências imediatas;
3. componentes compartilhados envolvidos;
4. expansão do contexto apenas quando necessária.

Economia de contexto nunca justifica ignorar segurança, integridade de dados, testes necessários, acessibilidade ou qualidade.

## Documentação específica

Leia somente os documentos relacionados à tarefa atual:

* Design e aparência: `docs/design-guidelines.md`
* Experiência mobile: `docs/mobile-ux.md`
* Segurança e Supabase: `docs/security.md`
* Cloudflare, build e deploy: `docs/deployment.md`
* Testes e validações: `docs/testing.md`

Não carregue todos esses documentos automaticamente em tarefas pequenas.

## Segurança

* Nunca registrar senhas, tokens, cookies, chaves, CPF completo, cartões ou payloads pessoais.
* Nunca importar service role em módulos que possam entrar no bundle do navegador.
* Toda variável com prefixo `NEXT_PUBLIC_` deve ser considerada pública.
* Nunca transformar uma variável secreta em `NEXT_PUBLIC_*`.
* Nunca colocar credenciais reais em `.env.example`, documentação, código, testes ou commits.
* Funções SQL privilegiadas devem usar `security definer` e definir explicitamente `search_path`.
* Toda tabela exposta ao Data API deve usar RLS default-deny.
* Não desativar RLS para corrigir falhas de acesso.
* Permissões administrativas devem ser verificadas no servidor.
* Não confiar em papéis, preços, descontos, status ou IDs enviados pelo cliente.
* Preços, descontos, frete e totais devem ser recalculados no servidor.
* Notas internas do suporte nunca podem ser retornadas ao cliente.
* Atendimento humano sempre entra na fila do Administrador.
* O Operacional só recebe atendimento por transferência explícita.

Para alterações de autenticação, Supabase, RLS, pagamentos, dados pessoais, uploads ou APIs, leia `docs/security.md`.

## Preservação do sistema

Preserve:

* autenticação;
* sessões;
* usuários;
* permissões;
* políticas RLS;
* banco de dados;
* carrinho;
* favoritos;
* estoque;
* pedidos;
* checkout;
* pagamentos;
* avaliações;
* atendimento;
* painel;
* webhooks;
* integrações;
* variáveis de ambiente;
* modo de demonstração.

Não:

* remover funcionalidades sem solicitação;
* substituir integração real por mock;
* criar botão sem ação;
* criar filtro falso;
* mostrar status fictício de integração;
* apresentar dado demonstrativo como real;
* inventar preços, avaliações, selos, garantias ou condições comerciais;
* apagar dados para simplificar uma implementação.

## Design e experiência

A interface deve ser:

* orientada aos produtos;
* comercial;
* clara;
* confiável;
* consistente;
* acessível;
* responsiva;
* reconhecível como Curtiz.

Não criar design típico de inteligência artificial.

Evite:

* gradientes neon;
* glassmorphism;
* manchas desfocadas;
* excesso de cards;
* sombras fortes;
* arredondamento exagerado;
* objetos 3D genéricos;
* slogans abstratos;
* grandes espaços decorativos;
* animações desnecessárias;
* aparência de landing page de SaaS;
* componentes visualmente desconectados.

Não invente identidade, conteúdo institucional ou informações comerciais.

Para qualquer alteração visual, leia `docs/design-guidelines.md`.

Para alterações que afetem celular ou tablet, leia também `docs/mobile-ux.md`.

## Mobile-first

A loja pública deve ser projetada primeiro para celular.

Não trate o mobile apenas como redução do desktop.

Não permitir:

* rolagem horizontal;
* botões pequenos;
* elementos cortados;
* campos escondidos pelo teclado;
* modais maiores que a viewport;
* chat cobrindo ações;
* navegação fixa cobrindo conteúdo;
* imagens deformadas;
* tabelas desktop comprimidas;
* layout shift perceptível.

A experiência mobile deve facilitar:

* busca;
* categorias;
* conta;
* favoritos;
* carrinho;
* produto;
* checkout;
* pedidos;
* atendimento.

## Qualidade de código

* Respeite a arquitetura existente.
* Preserve TypeScript estrito.
* Evite `any`.
* Reutilize componentes e pacotes existentes.
* Evite duplicação entre `apps/store` e `apps/panel`.
* Separe lógica de negócio da camada visual.
* Faça alterações pequenas e focadas.
* Não mova arquivos sem necessidade.
* Não instale dependências antes de verificar soluções existentes.
* Não misture gerenciadores de pacotes.
* Não alterar o lockfile sem necessidade relacionada.
* Não usar `!important` como solução padrão.
* Não deixar `console.log`, código morto ou comentários obsoletos.
* Não silenciar erros, testes ou regras de lint para concluir.
* Não introduzir warnings de React ou erros de hidratação.

## Dependências

Antes de adicionar uma dependência:

1. Verifique se já existe solução no monorepo.
2. Avalie tamanho e impacto no bundle.
3. Avalie manutenção e compatibilidade.
4. Confirme que código simples não resolve.
5. Instale no workspace correto.
6. Atualize apenas o lockfile utilizado pelo projeto.

Não atualize dependências não relacionadas à tarefa.

## Banco e migrations

* Toda alteração de schema deve possuir migration nova.
* Não modificar migration já aplicada.
* Não apagar tabelas, colunas ou dados sem solicitação explícita.
* Revisar chaves estrangeiras, funções, triggers e RLS.
* Evitar mudanças destrutivas.
* Testar migrations localmente quando o ambiente estiver disponível.
* Seeds de demonstração não podem ser executados em produção.

## Arquivos públicos e internos

Não copiar para `public/`:

* `AGENTS.md`;
* arquivos internos de `docs/`;
* `.env*`;
* logs;
* backups;
* dumps;
* relatórios;
* credenciais;
* scripts internos.

Todo arquivo em `public/` deve ser considerado acessível por qualquer visitante.

## Deploy

Antes de alterar build ou deploy:

1. Identifique a aplicação afetada.
2. Leia os scripts reais do workspace.
3. Identifique o adaptador e a configuração do Cloudflare.
4. Verifique variáveis de ambiente.
5. Reproduza o erro com o comando equivalente.
6. Corrija a causa, não apenas o sintoma.

Não alterar simultaneamente runtime, adaptador, comando de build e diretório de saída sem necessidade.

Para tarefas de Cloudflare, build ou produção, leia `docs/deployment.md`.

## Comandos

Comandos gerais do monorepo:

```bash
pnpm dev
pnpm supabase:start
pnpm supabase:reset
pnpm seed:demo
pnpm check
```

Comportamento esperado:

* `pnpm dev`: inicia a loja em `3000` e o painel em `3001`.
* `pnpm supabase:start`: inicia o Supabase local e requer Docker.
* `pnpm supabase:reset`: reaplica migrations e seed no ambiente local.
* `pnpm seed:demo`: cria contas de demonstração somente fora de produção.
* `pnpm check`: executa lint, tipos, testes e build local.

Não execute `pnpm supabase:reset` em ambiente com dados que precisem ser preservados.

Não execute `pnpm seed:demo` em produção.

## Validação proporcional

Durante o desenvolvimento:

* prefira lint, testes ou build do workspace afetado quando disponíveis;
* execute testes relacionados antes da validação global;
* não rode `pnpm check` após cada pequena edição;
* não repita validações sem alteração relevante.

Antes de concluir uma fase relevante:

```bash
pnpm check
```

Áreas críticas exigem validação ampliada:

* autenticação;
* autorização;
* RLS;
* pagamentos;
* pedidos;
* estoque;
* checkout;
* webhooks;
* migrations;
* dados pessoais;
* deploy.

Nunca afirme que um comando foi executado quando não foi.

Para critérios detalhados, leia `docs/testing.md`.

## Critério de conclusão

Uma tarefa só está concluída quando:

* funciona;
* preserva regras e integrações;
* não expõe segredos;
* trata loading, erro e estado vazio quando aplicável;
* está responsiva;
* funciona no mobile;
* está acessível;
* não introduz regressões relacionadas;
* não apresenta erros de console relacionados;
* não apresenta warnings de React relacionados;
* não apresenta erros de hidratação;
* as validações necessárias foram executadas;
* limitações e pendências reais foram registradas.

## Relatório final

Informe somente:

1. alterações realizadas;
2. arquivos principais modificados;
3. validações executadas;
4. resultados;
5. pendências reais.

Não repita a solicitação inteira.

Não reproduza logs completos quando apenas algumas linhas forem relevantes.

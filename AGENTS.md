Objetivo

A curti Z é um e-commerce de sandálias e chinelos voltado principalmente à Geração Z.

O sistema deve ser tratado como um produto comercial real: seguro, rápido, confiável, responsivo, acessível, profissional e visualmente marcante.

apps/store: loja pública e experiência do cliente.

apps/panel: painéis internos.

packages/*: código compartilhado.

Supabase: fonte de verdade dos dados.

Deploy: Cloudflare Workers + OpenNext.

Gerenciador de pacotes: pnpm.

Ambiente local principal: Windows.

Node.js disponível: v24.19.0.

pnpm esperado pelo projeto: 10.14.0.

Docker NÃO está disponível e não deve ser exigido automaticamente.

Preserve a arquitetura existente salvo quando a tarefa exigir mudança.

Regra principal

Trabalhe de forma focada, incremental e econômica.

Use somente os arquivos, comandos e contexto necessários para a tarefa atual.

Não transforme uma correção localizada em auditoria completa.

Economizar contexto nunca justifica:

ignorar segurança;

deixar bugs no fluxo alterado;

quebrar regras de negócio;

remover validações;

evitar testes necessários;

mascarar erros;

afirmar que algo foi validado sem ter sido.

Antes de alterar código

Entenda exatamente a tarefa.

Execute git status.

Determine se o escopo é store, panel, packages, Supabase ou deploy.

Localize primeiro os arquivos diretamente envolvidos.

Procure implementação existente antes de criar outra.

Leia apenas dependências imediatas necessárias.

Preserve alterações não relacionadas.

Implemente.

Valide proporcionalmente ao risco.

Pare quando a tarefa estiver concluída.

Para tarefas grandes, faça apenas um plano curto.

Economia de contexto e créditos

Não leia o repositório inteiro sem necessidade.

Evite abrir:

node_modules/.next/dist/build/.git/.turbo/.cache/coverage/

Também evite logs extensos, arquivos gerados, source maps, backups, dumps, binários e lockfiles completos sem necessidade.

Durante a mesma tarefa:

não releia arquivos inalterados;

não repita buscas já resolvidas;

não refaça o mesmo diagnóstico;

não repita comandos sem mudança relevante;

não produza relatórios extensos;

não faça refatorações fora do escopo.

Expanda a investigação somente quando surgir uma dependência real.

Pare de investigar quando a causa e a solução já estiverem suficientemente claras.

Prioridades

Em caso de conflito:

Segurança.

Integridade de pedidos, pagamentos e estoque.

Autenticação e autorização.

Regras de negócio.

Funcionalidade.

Estabilidade de produção.

UX.

Mobile.

Acessibilidade.

Performance.

UI.

Manutenibilidade.

Uma melhoria visual nunca pode quebrar funcionalidades existentes.

Segurança e Supabase

Nunca:

exponha senhas, tokens, cookies ou secrets;

coloque service_role no navegador;

transforme secret em NEXT_PUBLIC_*;

desative RLS para corrigir erro;

confie somente no frontend para autorização;

invente valores de variáveis secretas;

execute seed em produção;

apague dados para simplificar uma correção.

Toda variável NEXT_PUBLIC_* deve ser considerada pública.

Operações sensíveis devem ser validadas no servidor.

Preços, descontos, estoque, frete e totais devem ser validados ou recalculados no servidor.

Toda mudança de schema deve usar migration incremental nova.

Não altere migrations já aplicadas.

Não execute migrations destrutivas em produção automaticamente.

Preservação do sistema

Preserve:

autenticação;

sessões;

usuários;

roles e permissões;

RLS;

banco;

produtos;

estoque;

carrinho;

favoritos;

pedidos;

checkout;

pagamentos;

avaliações;

atendimento;

integrações;

painéis;

variáveis de ambiente.

Não substitua implementação real por mock para esconder um problema.

Não crie botão, filtro, status ou integração falsa.

Não invente preços, avaliações, promoções, estoque ou informações comerciais.

Loja — apps/store

A loja é mobile-first e direcionada principalmente à Geração Z.

A experiência deve ser:

moderna;

visual;

jovem sem ser infantil;

orientada aos produtos;

comercial;

organizada;

dinâmica;

profissional.

Preserve a paleta atual da curti Z salvo solicitação explícita.

Melhore principalmente através de:

composição;

fotografia;

tipografia;

hierarquia;

espaçamento;

grid;

interação;

animações;

UX.

Evite aparência genérica de IA:

glassmorphism excessivo;

gradientes neon;

blobs;

objetos 3D genéricos;

sombras exageradas;

cards em tudo;

arredondamento exagerado;

grandes espaços vazios;

aparência de landing page SaaS.

Use animações com propósito e respeite prefers-reduced-motion.

Não instale biblioteca pesada para animações simples se CSS ou APIs nativas resolverem.

Mobile

Não trate mobile apenas como desktop reduzido.

Considere pelo menos:

320px, 360px, 390px, 430px, 768px, 1024px e desktop.

Não permitir:

overflow horizontal;

conteúdo cortado;

botões pequenos;

imagens deformadas;

modais maiores que a viewport;

elementos fixos cobrindo conteúdo;

tabelas desktop comprimidas;

layout shift perceptível.

Painéis — apps/panel

Os painéis são ferramentas de trabalho.

Devem priorizar clareza, produtividade, organização e segurança.

O usuário deve entender:

onde está;

o que está pendente;

o que pode fazer;

qual é a ação principal;

qual foi o resultado da ação.

Responsabilidades:

Administrativo: produtos, clientes, marketing, usuários e gestão comercial.

Operacional: pedidos, estoque, separação, envio e atendimento.

Gerencial: indicadores, financeiro, relatórios, aprovações e estratégia.

Técnico: sistema, logs, segurança, integrações, backups e acessos.

Não transforme todos os painéis no mesmo CRUD.

Quando aplicável, telas devem possuir:

loading;

erro;

retry;

estado vazio;

busca;

filtros;

feedback de sucesso/erro;

confirmação de ações destrutivas.

Não deixe botões ou links sem funcionamento real.

Uma falha isolada de API não deve derrubar desnecessariamente todo o painel.

Não esconda falhas estruturais.

Código

Preserve TypeScript estrito.

Evite any.

Reutilize componentes existentes.

Evite duplicação.

Separe regras de negócio da UI.

Não mova arquivos sem necessidade.

Não use !important como solução padrão.

Não deixe console.log, código morto ou warnings relacionados.

Não silencie lint, TypeScript ou testes para concluir.

Não introduza erros de hidratação.

Antes de instalar dependência, confirme que o projeto não possui solução adequada.

Não atualize dependências sem relação com a tarefa.

Use pnpm.

Ambiente local, Node e Docker

O ambiente local possui:

Node.js v24.19.0
pnpm 10.14.0
Windows

O projeto exige Node >=24.19.0, portanto não tente trocar ou reinstalar o Node sem necessidade.

Docker NÃO está disponível.

Não bloqueie tarefas de:

UI;

UX;

Next.js;

store;

panel;

lint;

typecheck;

build;

testes estáticos;

Cloudflare;

análise de código;

somente porque Docker não está instalado.

Docker/Supabase local só devem ser exigidos quando a tarefa realmente depender de execução local do banco.

Se não for possível validar comportamento real de banco sem Docker, continue o que puder ser validado e informe claramente a limitação.

Nunca afirme que migration ou banco real foram validados quando isso não ocorreu.

Cloudflare e deploy

Store e Panel são aplicações diferentes.

Nunca confunda:

apps/store

com:

apps/panel

Antes de alterar deploy:

identifique a aplicação;

confira o package.json;

confira wrangler.jsonc;

confira OpenNext;

confira variáveis;

confira URLs da loja e painel;

reproduza o erro;

corrija a causa.

Não altere simultaneamente runtime, adaptador, build command, root directory e Worker sem necessidade comprovada.

Leia docs/deployment.md apenas para tarefas relacionadas a deploy.

Não faça deploy de produção automaticamente sem solicitação.

Testes

Use validação progressiva:

teste específico;

typecheck do workspace;

lint relevante;

testes relacionados;

build da aplicação quando necessário;

validação global somente quando justificável.

Não execute build completo após cada pequena alteração.

Não rode pnpm check repetidamente sem necessidade.

Áreas críticas exigem validação maior:

autenticação;

autorização;

Supabase/RLS;

pedidos;

estoque;

checkout;

pagamentos;

migrations;

segurança;

deploy.

Nunca diga que executou um teste ou comando que não executou.

Git

Preserve alterações existentes do usuário.

Não execute sem solicitação:

git reset --hard;

force push;

reescrita de histórico;

exclusão de alterações;

commit;

push.

Critério de conclusão

A tarefa termina quando:

o pedido foi implementado;

o fluxo afetado funciona;

segurança e regras foram preservadas;

regressões relacionadas foram verificadas;

estados de loading/erro/vazio foram tratados quando aplicável;

responsividade foi considerada;

validações necessárias foram executadas;

pendências reais foram registradas.

Não continue fazendo melhorias opcionais sem solicitação.

Resposta final

Seja curto.

Informe somente:

Alterações

O que foi feito.

Arquivos

Principais arquivos modificados.

Validação

Testes/comandos realmente executados.

Pendências

Somente problemas ou ações manuais reais.

Não repita a solicitação e não copie logs completos.

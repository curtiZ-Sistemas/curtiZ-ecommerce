# Melhorias focadas da curti Z

Implemente as correções e melhorias abaixo. Esta tarefa já está autorizada.
Respeite o AGENTS.md e preserve alterações existentes do usuário.

## Limites e economia

Notebook Windows com 4 GB de RAM. Use pnpm.
Trabalhe sequencialmente, sem subagentes e sem servidores ou builds paralelos.

Não faça nova auditoria geral. Os achados abaixo orientam a investigação:
confirme apenas o necessário no código atual antes de corrigir.

- Execute git status inicialmente.
- Faça um plano de até cinco passos.
- Localize primeiro os arquivos diretamente envolvidos.
- Não leia o repositório inteiro, lockfiles completos ou arquivos gerados.
- Não releia arquivos inalterados nem repita buscas resolvidas.
- Não instale dependências se recursos existentes resolverem.
- Não faça refatorações, atualizações ou melhorias fora do escopo.
- Não use pesquisa externa salvo dúvida técnica indispensável.
- Use testes específicos e um único worker.
- Não rode validação global ou build completo por padrão.
- Não abra dezenas de páginas nem gere capturas repetidas.
- Dê atualizações curtas apenas quando houver progresso relevante.

Não peça confirmação para correções locais reversíveis dentro deste escopo.
Se surgir um bloqueio externo, conclua as partes independentes.

## Fora do escopo

Os produtos ainda serão cadastrados.
Mercado Pago, Melhor Envio, Resend e Bling serão integrados posteriormente.

Portanto:
- Não implemente nem configure essas integrações.
- Não trate ausência delas como defeito desta tarefa.
- Não altere fotos, imagens, descrições ou dados dos produtos.
- Não investigue a divergência entre foto e cor do catálogo atual.
- Não gere imagens nem substitua o banner por imagem inventada.
- Não altere o texto “Total” do carrinho/checkout.
- Não invente avaliações, descontos, estoque ou condições comerciais.
- Não faça deploy, commit, push ou alterações no banco de produção.
- Não use contas reais para criar pedidos ou modificar cadastros.

## 1. Corrigir o formulário de produtos

Na versão publicada, em viewport 390 × 844:
- O drawer começa em y=58.
- Sua altura é 844 px.
- O botão “Criar rascunho” fica entre y=840 e y=882,
  quase inteiramente fora da tela.

Corrija a relação entre cabeçalho, altura disponível e rolagem.
O título, fechamento e ação de salvar devem permanecer acessíveis.
Preserve navegação entre seções, foco, Escape e confirmação de descarte.

Verifique também o comportamento desktop.
Arquivos iniciais prováveis:
- apps/panel/src/components/panel-drawer.tsx
- apps/panel/src/components/product-management.tsx
- apps/panel/src/app/globals.css

## 2. Segurança e confiabilidade já identificadas

### MFA
A análise anterior encontrou exigência de MFA nas páginas do painel,
mas não em authorizeAdminRequest nem nas funções SQL de permissão examinadas.

Confirme a lacuna no código atual.
Quando a exigência de MFA interno estiver habilitada, uma sessão sem
segundo fator não deve executar operações internas protegidas por ela.

Proteja os caminhos relevantes de API e acesso direto ao banco.
Preserve os papéis, permissões e fluxos de clientes/representantes.
Não suponha que uma variável do Next.js esteja disponível no PostgreSQL.
Se houver mudança de banco, use migration incremental nova e documente
a configuração necessária, sem aplicá-la em produção.

Teste sessão sem MFA, com MFA e comportamento da configuração existente.

### Histórico administrativo
Na listagem de usuários, a consulta de histórico não tinha limite explícito
e historyResult.error era ignorado.

Busque eficientemente a última alteração relevante de cada usuário,
sem truncamento global que produza resultados incorretos.
Diferencie histórico indisponível de ausência de histórico.

## 3. Melhorar a composição da loja

Preserve a paleta vinho/coral, a identidade e os componentes existentes.

- Encurte a composição do banner mobile: ela ocupava aproximadamente
  625 px numa tela de 844 px.
- Preserve legibilidade e conteúdo da imagem existente.
  Não use recorte que esconda texto, calçados ou chamada.
  Se a arte impedir uma redução adequada, registre essa dependência
  e melhore o espaço ao redor, sem deformar a imagem.
- Reduza o bloco introdutório do catálogo, principalmente no celular,
  aproximando filtros e produtos do topo.
- Melhore a legibilidade do logotipo no cabeçalho usando recursos existentes.
- Quando não houver avaliações, não apresente nota zero como avaliação.
  Oculte a nota ou mostre “Sem avaliações”, consistentemente.
- Preserve menu mobile, filtros, busca, favoritos e carrinho.
- Não adicione animações ou novas seções desnecessárias.

Não crie guia de medidas com números inventados.
Não altere as seleções comerciais da home automaticamente.

## 4. Tornar os painéis mais claros

Os menus publicados JÁ possuem agrupamentos.
Preserve essa organização e a divisão entre os quatro painéis.

### Administrativo
- Reduza espaços excessivos na listagem de produtos sem prejudicar
  leitura, ações ou detalhes de variações.
- Nas atividades recentes, apresente descrições compreensíveis
  no lugar de códigos como auth.login.
  Preserve o identificador técnico quando necessário e um fallback
  para eventos desconhecidos.

### Gerencial e financeiro
- Melhore a hierarquia dos indicadores existentes, sem remover informações.
- Gráficos sem movimentação devem exibir estado vazio claro,
  evitando eixos com “0k” repetido.
- Diferencie ausência de dados, carregamento e erro.
- Preserve filtros e cálculos financeiros.

### Construtor da home
A loja exibia uma home completa, mas o editor mostrava
“Nenhuma seção encontrada”.

Verifique apenas o fluxo que explica essa diferença.
Se houver conteúdo padrão/fallback, explique isso na interface.
Se houver erro de carregamento, mostre erro e tentativa novamente.
Não crie seções, publique conteúdo ou substitua a home automaticamente.

Troque jargões como “snapshots atômicos” por linguagem simples.
Traduza os status visíveis para português sem modificar valores internos.

### Técnico
Preserve a distinção entre “conectado”, “configurado” e “não configurado”.
Não trate integrações futuras como incidentes.
Quando metadados de versão/build não existirem, informe a ausência
sem inventar valores nem alterar o deploy.

## 5. Busca: investigação limitada

A busca pública mostrou “Busca indisponível” uma vez e funcionou depois.
Isso NÃO comprova falha permanente.

Examine somente o tratamento de requisições, cancelamento e erro
do autocomplete. Corrija se encontrar uma causa concreta.
Preserve acesso aos resultados completos e recuperação de falhas.
Não faça testes de carga nem uma investigação ampla sem evidência.

## Validação e conclusão

- Faça testes proporcionais aos riscos de cada alteração.
- Segurança exige testes de comportamento, não apenas busca de texto.
- Valide visualmente somente as telas alteradas.
- Para responsividade, concentre-se em 320, 390, 768 e 1440 px.
- Use no máximo um servidor local por vez.
- Se o ambiente local falhar antes de renderizar, faça um diagnóstico
  curto; não transforme esta tarefa em reparo de infraestrutura.
- Nunca afirme que banco real ou produção foram validados sem execução.
- Pare quando o escopo estiver concluído.

Resposta final curta:
1. Alterações realizadas.
2. Principais arquivos.
3. Validações realmente executadas.
4. Pendências reais e limitações.

Não repita este prompt nem produza relatório extenso.
Quero que você faça uma REFATORAÇÃO COMPLETA DE UX/UI, RESPONSIVIDADE, ORGANIZAÇÃO E ARQUITETURA DAS FUNCIONALIDADES dos painéis internos da curti Z.

IMPORTANTE:
Leia TODO o projeto antes de alterar qualquer coisa.

Não faça apenas alterações superficiais de CSS.
Analise:
- estrutura das páginas;
- navegação;
- menus;
- componentes;
- formulários;
- modais/drawers;
- tabelas;
- permissões;
- APIs;
- banco;
- componentes compartilhados;
- mobile;
- desktop;
- estados de loading;
- empty states;
- ações;
- funcionalidades duplicadas;
- páginas desnecessárias.

OBJETIVO PRINCIPAL

Transformar os painéis da curti Z em uma ferramenta administrativa moderna, simples, profissional, rápida e extremamente fácil de usar, principalmente pelo celular.

Hoje existem páginas demais para tarefas que pertencem ao mesmo contexto.

Não quero continuar com a lógica:

"uma página para cada microfuncionalidade".

Quero trabalhar com a lógica:

"uma área principal concentra tudo que é necessário para executar aquela tarefa".

EXEMPLO PRINCIPAL:

Produto deve ser administrado principalmente em PRODUTOS.

Não deveria ser necessário entrar em:
Produtos
→ Variações
→ Mídias
→ Estoque
→ outra tela
→ outra tela

apenas para administrar um único produto.

O mesmo raciocínio deve ser aplicado ao restante dos painéis.

==================================================
ESCOPO
==================================================

FAZER A REFATORAÇÃO EM:

- Painel Administrativo
- Painel Operacional
- Painel Gerencial
- Painel Técnico
- seletor de painéis
- páginas e componentes compartilhados desses ambientes

NÃO redesenhar:

- painel do cliente
- painel do representante

Esses dois devem continuar com o layout atual.

Porém, funcionalidades administrativas relacionadas a representantes podem ser corrigidas.

IMPORTANTE:
No gerenciamento de kits de representantes existe valor sendo trabalhado/exibido em CENTAVOS.

Isso não faz sentido para o usuário administrativo.

A interface deve trabalhar com:

R$ 20,00
R$ 49,90
R$ 129,99

e NÃO:

2000
4990
12999

Internamente o backend pode continuar armazenando em centavos se isso fizer parte da arquitetura atual, mas a interface administrativa deve SEMPRE converter:

centavos → reais na leitura
reais → centavos antes de salvar

Nunca exigir que uma pessoa digite centavos manualmente.

==================================================
1. DESIGN SYSTEM DOS PAINÉIS
==================================================

Primeiro analise os componentes atuais e crie/padronize um design system interno.

Todos os painéis devem parecer parte do MESMO SISTEMA.

Não quero:

- botão preto perdido no layout;
- componentes com estilos completamente diferentes;
- formulários parecendo HTML cru;
- campos espremidos;
- títulos gigantes;
- bordas excessivas;
- cards desnecessários;
- sombras exageradas;
- gradientes desnecessários;
- interfaces com aparência de template de IA;
- excesso de informação;
- textos explicando coisas óbvias;
- componentes brilhantes;
- animações exageradas.

Quero uma interface limpa e profissional.

Usar:

- branco;
- cinzas claros;
- cor principal já definida no projeto da curti Z;
- vermelho/bordô institucional para ações principais;
- vermelho somente onde fizer sentido;
- verde para sucesso/status positivo;
- amarelo/laranja somente para alertas;
- vermelho para erros/perigo.

Eliminar PRETO como cor principal dos botões.

Botões como o "Editar" preto mostrado atualmente devem utilizar o sistema visual da curti Z.

Criar/padronizar variantes de botão:

Primary
Secondary
Ghost
Danger
Icon

Todos com:
- altura consistente;
- padding consistente;
- estados hover;
- focus-visible;
- disabled;
- loading;
- acessibilidade.

==================================================
2. RESPONSIVIDADE É OBRIGATÓRIA
==================================================

TODAS essas páginas precisam funcionar perfeitamente em:

320px
360px
375px
390px
412px
430px
tablet
notebook
desktop grande

Não quero simplesmente diminuir componentes.

REORGANIZE A INTERFACE PARA MOBILE.

No celular:

- nada pode ultrapassar horizontalmente a tela;
- absolutamente nenhum scroll horizontal involuntário;
- formulários devem virar coluna;
- tabelas grandes devem virar cards/listas quando necessário;
- ações devem permanecer acessíveis;
- filtros devem reorganizar;
- botões devem ter área de toque confortável;
- títulos devem diminuir;
- espaçamentos devem diminuir;
- drawers devem ocupar praticamente a tela;
- modais devem virar bottom sheet/fullscreen quando fizer mais sentido;
- nenhum conteúdo deve ficar escondido atrás do header;
- nenhuma ação deve ficar fora da viewport;
- nenhum botão deve cortar texto;
- nenhuma coluna deve desaparecer sem alternativa.

Não resolva responsividade usando apenas:

overflow-x: auto

Use isso somente quando realmente fizer sentido.

A maioria das tabelas administrativas deve ter uma representação mobile própria.

==================================================
3. SELETOR DE PAINÉIS
==================================================

A página atual de escolha de painel está extremamente exagerada.

REMOVER:

- coluna enorme vermelha;
- "Central de trabalho";
- "Escolha o painel que deseja acessar";
- explicações longas;
- descrições de cada painel;
- "Acesso protegido por função";
- textos redundantes;
- elementos decorativos desnecessários.

Quero uma tela extremamente simples.

ESTRUTURA:

TOPO
[logo curti Z]

CENTRO
"Escolha um painel"

Botões/cards:

Painel Administrativo
Painel Operacional
Painel Gerencial
Painel Técnico

Mostrar SOMENTE painéis que a conta realmente possui permissão para acessar.

Não mostrar painel sem permissão.

No final:

[Voltar]
[Sair da conta]

Se o usuário estiver vindo de outro painel, "Voltar" retorna corretamente.

Se não houver histórico utilizável, voltar para a rota segura correspondente.

Layout:

desktop:
cards compactos centralizados.

mobile:
um botão/card abaixo do outro.

Nada além disso.

Pode ter apenas um ícone pequeno identificando cada painel.

==================================================
4. HEADER DOS PAINÉIS
==================================================

Padronizar completamente o header.

Desktop e mobile precisam ter comportamento consistente.

Mobile:

[menu] [nome da área]              [pesquisa] [notificação] [avatar] [sair]

Mas adapte conforme espaço disponível.

Não deixar o header esmagado.

Se necessário:
- ocultar textos secundários;
- usar apenas ícones;
- colocar ações menos importantes no menu.

Header sticky sem tremer durante scroll.

Corrigir qualquer layout shift.

==================================================
5. SIDEBAR / MENU
==================================================

Reorganize a sidebar.

O menu atual possui páginas demais e separações que fazem tarefas relacionadas parecerem sistemas diferentes.

Quero MENOS opções principais.

Agrupe funcionalidades relacionadas.

Use:

seção
→ página principal
→ funcionalidades internas

em vez de:

seção
→ 8 páginas pequenas.

Exemplo:

CATÁLOGO

Produtos
Categorias
Coleções

Não precisa obrigatoriamente existir:

Produtos
Categorias
Modelos
Coleções
Variações
Mídias
Estoque

como páginas independentes quando essas funcionalidades pertencem principalmente ao gerenciamento de produto.

Analise dependências reais antes de remover rotas.

IMPORTANTE:
Não apagar funcionalidades.

CONSOLIDAR funcionalidades.

Se alguma rota antiga puder ser removida:
- verificar imports;
- links;
- permissões;
- APIs;
- redirects;
- testes;
- bookmarks;
- navegação.

Preferir redirect seguro quando necessário.

==================================================
6. PÁGINA DE PRODUTOS — REFATORAÇÃO PRINCIPAL
==================================================

A página de produtos será o centro de gerenciamento do catálogo.

Ela deve permitir administrar praticamente tudo relacionado ao produto.

LISTAGEM

Cada produto deve mostrar somente informações realmente úteis:

imagem
nome
SKU/código principal
status
preço
estoque
quantidade de variações
ações

Não quero os elementos espalhados e desalinhados vistos atualmente.

DESKTOP:

usar uma lista/tabela moderna e compacta.

MOBILE:

cada produto vira um card compacto.

Exemplo mobile:

[foto] Chinelo
       CHINELO-AZUL-41
       Publicado

R$ 50,00
Estoque: 0
3 variações

[Editar] [•••]

Não colocar elementos enormes.

==================================================
7. BUSCA E FILTROS DE PRODUTOS
==================================================

No desktop:

[Buscar produto........................] [Status ▼] [Filtros] [+ Novo produto]

No celular:

[Buscar produto.....................]

[Status ▼] [Filtros]

[+ Novo produto]

Pode utilizar um drawer para filtros avançados.

Remover aquela distribuição estranha:

Buscar
Todos
Sem estoque

ocupando grandes áreas da página.

Transformar "Sem estoque" em filtro/status/chip.

Exemplo:

Todos
Publicados
Rasccunhos
Sem estoque
Arquivados

Utilizar tabs/chips compactos quando apropriado.

==================================================
8. EDIÇÃO DE PRODUTO
==================================================

A experiência atual de edição possui abas e formulários apertados.

Refazer.

No desktop, utilizar drawer largo ou página dedicada dependendo da arquitetura atual.

No celular, abrir editor praticamente fullscreen.

Criar seções claras:

Informações
Preço
Variações
Estoque
Imagens
Logística
Conteúdo
SEO/visibilidade
Revisão

MAS:

isso deve fazer parte DO MESMO EDITOR.

Não obrigar o usuário a navegar por páginas diferentes do painel.

==================================================
9. VARIAÇÕES
==================================================

VARIAÇÕES devem ser administradas dentro do produto.

Exemplo:

Produto
Chinelo

VARIAÇÕES

Cor: Azul

Tamanhos:
41
42
43

Cada combinação:

Azul / 41
SKU
Preço
Estoque

Azul / 42
SKU
Preço
Estoque

Azul / 43
SKU
Preço
Estoque

Permitir:

- adicionar cor;
- remover cor;
- adicionar tamanho;
- remover tamanho;
- alterar SKU;
- alterar preço;
- alterar estoque;
- ativar/desativar variação;
- definir imagem da cor;
- duplicar variação;
- gerar combinações.

Não deixar campos minúsculos como no layout atual.

No celular:

cada variação deve ser um card ou accordion.

Exemplo:

Azul • 41
SKU: CHINELO-AZUL-41
Preço: R$ 50,00
Estoque: 4

[Editar]

==================================================
10. MÍDIAS DO PRODUTO
==================================================

A tela separada de "Mídias" do catálogo deve ser eliminada da navegação principal SE ela existe apenas para gerenciar imagens de produtos.

Imagens devem ser controladas diretamente dentro de Produto.

Permitir:

- upload;
- preview;
- reorder;
- excluir;
- definir principal;
- associar imagem à variação/cor;
- alt text quando necessário.

Drag-and-drop no desktop.

Controles simples no celular.

Não quebrar APIs ou storage existentes.

==================================================
11. ESTOQUE
==================================================

O estoque relacionado ao produto deve estar disponível dentro do produto.

Pode continuar existindo uma área operacional de estoque quando houver necessidade REAL de:

- movimentações;
- inventário;
- ajustes em massa;
- entradas;
- saídas;
- auditoria.

Mas NÃO quero precisar sair de Produto apenas para alterar o estoque de uma variação.

Dentro do produto:

Estoque
Azul / 41     4
Azul / 42     8
Azul / 43     0

Permitir edição direta quando a permissão do usuário permitir.

==================================================
12. CATEGORIAS / COLEÇÕES / MODELOS
==================================================

Analise a utilidade real de:

Categorias
Modelos
Coleções

Não remover dados ou funcionalidades necessárias.

Porém simplifique drasticamente.

Se "Modelo" for apenas uma propriedade do produto, considerar administrar dentro de Produto e remover sua página independente.

Se possuir função própria real, manter.

Categorias e coleções podem continuar como páginas independentes se forem realmente entidades reutilizadas por vários produtos.

Não manter páginas apenas porque já existem.

==================================================
13. BOTÃO "MAIS AÇÕES"
==================================================

Padronizar.

Não quero:

"... Mais ações"

jogado no layout.

Utilizar botão icon-only:

[•••]

Abrindo menu contextual:

Duplicar
Arquivar
Despublicar
Excluir

Mostrar somente ações válidas de acordo com:
- status;
- permissão;
- contexto.

==================================================
14. MODAIS E DRAWERS
==================================================

Padronizar todos.

Desktop:
drawer lateral para edições intermediárias.

Mobile:
fullscreen/bottom sheet dependendo da quantidade de conteúdo.

Nunca permitir situação como nos screenshots onde:
- conteúdo fica cortado;
- scrollbar aparece apertado;
- campos desaparecem;
- colunas ficam minúsculas;
- botão salvar fica parcialmente escondido.

Para formulários longos:

header sticky:
[X] Produto

footer sticky:
[Cancelar] [Salvar]

O conteúdo central pode rolar.

Garantir safe-area no iPhone.

==================================================
15. FORMULÁRIOS
==================================================

Padronizar:

label
campo
helper/error

Não colocar 4 campos minúsculos lado a lado.

Desktop:
2 ou no máximo 3 colunas quando fizer sentido.

Mobile:
1 coluna.

Inputs monetários:

R$ 0,00

Inputs numéricos:
quantidade adequada ao conteúdo.

Selects:
altura consistente.

Textarea:
altura suficiente.

==================================================
16. PÁGINAS COMO "NOVA SEÇÃO"
==================================================

O formulário mostrado atualmente para criação de seção está muito apertado e possui três colunas enormes de configuração.

Refazer completamente.

Separar por blocos:

Conteúdo
Layout
Dispositivos
Visual
Agendamento
Configurações avançadas

No desktop pode usar grid.

No celular deve ser uma única coluna.

Configurações menos utilizadas devem ficar dentro de:

"Configurações avançadas"

Não mostrar tudo simultaneamente.

Aplicar progressive disclosure.

Mostrar primeiro o que é necessário para concluir a tarefa.

==================================================
17. CUPONS
==================================================

A página de cupons deve seguir o mesmo novo padrão.

Cabeçalho:

Cupons
[+ Novo cupom]

Busca + filtros.

Desktop:
tabela compacta.

Mobile:
cards.

Cada cupom:

CUPOM10
10% de desconto
Ativo
12 utilizações
Válido até xx/xx

[Editar] [•••]

==================================================
18. KITS
==================================================

REFATORAR gerenciamento de kits.

Trocar completamente a experiência de:

"Preço em Centavos"

por:

"Preço"

Input monetário:

R$ 20,00

Nunca mostrar centavos crus para o usuário.

Se banco/API utiliza inteiro em centavos:

display:
price_cents / 100

save:
Math.round(priceBRL * 100)

Criar utilitário monetário central se ainda não existir.

Evitar conversões duplicadas espalhadas pelo código.

Exibir corretamente:

R$ 20,00

e não:

2000

Também corrigir qualquer outro local administrativo onde dinheiro esteja aparecendo em centavos.

FAÇA UMA BUSCA GLOBAL NO PROJETO.

Procure por campos como:

price_cents
amount_cents
value_cents
total_cents
unit_price_cents
etc.

Não alterar contrato de API sem necessidade.

Apenas garantir apresentação correta.

==================================================
19. CRIATIVOS
==================================================

A página de Criativos atual parece um formulário cru.

Refazer.

Cabeçalho:

Criativos

[+ Novo criativo]

Mostrar biblioteca primeiro.

Cada criativo como card/lista:

preview
título
campanha
tipo
plataforma
status
data

A criação/edição deve abrir drawer/modal.

Não deixar permanentemente um formulário gigante ocupando metade da página.

EMPTY STATE:

Nenhum criativo encontrado

[+ Criar primeiro criativo]

Simples.

==================================================
20. CONFIGURAÇÕES ADMINISTRATIVAS
==================================================

REMOVER COMPLETAMENTE DA INTERFACE ADMINISTRATIVA a página:

"Configurações administrativas"

mostrada no screenshot.

Ela atualmente apresenta:

intelligence_event_retention_days
intelligence_weights
homepage_limits
homepage_external_hosts
privacy_request_internal_deadline
banner_external_hosts

etc.

Isso NÃO deve estar disponível para um usuário administrativo comum.

São configurações técnicas/internas.

Remover:

- item da sidebar administrativa;
- rota administrativa pública correspondente, se ela existir somente para isso;
- links;
- breadcrumbs;
- buscas;
- atalhos.

IMPORTANTE:

NÃO apagar configurações do banco.

NÃO apagar system_settings.

NÃO quebrar o Intelligence Engine.

NÃO remover APIs internas necessárias.

Apenas retirar essa interface do Painel Administrativo.

Se realmente houver necessidade de manutenção técnica dessas configurações, elas podem ficar disponíveis SOMENTE dentro do Painel Técnico, protegidas pela permissão correta.

Mesmo no painel técnico, transformar nomes internos em uma interface compreensível quando possível.

Nunca mostrar JSON cru para alguém que não precise disso.

==================================================
21. PAINEL OPERACIONAL
==================================================

Aplicar a mesma filosofia.

O usuário operacional deve conseguir executar tarefas rapidamente.

Priorizar:

Pedidos
Separação
Expedição
Estoque
Atendimento

Reduzir páginas redundantes.

Pedidos devem concentrar:

- dados do pedido;
- cliente;
- pagamento;
- produtos;
- status;
- envio;
- rastreio;
- histórico;
- observações;
- ações permitidas.

Não criar páginas independentes para microações quando um drawer/seção dentro do pedido resolver.

==================================================
22. PAINEL GERENCIAL
==================================================

Simplificar.

Priorizar:

Visão geral
Financeiro
Vendas
Produtos
Clientes
Representantes
Relatórios

Dashboard deve mostrar informações úteis e não cards apenas decorativos.

Mobile:
KPIs em grid compacto.

Gráficos:
responsivos.

Tabelas:
cards/listas quando necessário.

Filtros de data:
simples.

==================================================
23. PAINEL TÉCNICO
==================================================

Também precisa seguir o novo design system.

Porém pode conter informações mais avançadas.

Organizar por:

Sistema
Integrações
Segurança
Deploy/diagnóstico
Jobs/processamento
Configurações técnicas

Não mostrar informações técnicas no Painel Administrativo.

==================================================
24. PERMISSÕES
==================================================

NÃO comprometer RBAC.

Cada painel, menu, botão e ação deve continuar respeitando as permissões reais.

Não resolver a simplificação escondendo algo apenas por CSS.

A autorização precisa continuar acontecendo no backend.

UI:
pode ocultar ação sem permissão.

Backend:
DEVE continuar bloqueando acesso não autorizado.

==================================================
25. LOADING / SPINNER
==================================================

O spinner atual gira rápido demais.

Diminuir a velocidade globalmente.

Algo aproximadamente entre:

1.2s e 1.6s por volta

em vez de parecer uma hélice.

Usar animação suave e linear.

Também respeitar:

prefers-reduced-motion

Não usar spinner para tudo.

Quando possível:

lista → skeleton
card → skeleton
botão → spinner pequeno
navegação → indicador discreto

Evitar flash de loading em operações extremamente rápidas.

Se operação terminar quase imediatamente, não ficar piscando spinner na tela.

==================================================
26. EMPTY STATES
==================================================

Padronizar empty states.

Não usar enormes áreas vazias.

Exemplo:

Nenhum produto encontrado

Tente alterar os filtros ou cadastre um produto.

[+ Cadastrar produto]

Ou:

Nenhum criativo ainda

[+ Criar criativo]

==================================================
27. FEEDBACK DE AÇÕES
==================================================

Toda ação deve ter feedback correto:

salvando...
salvo
erro
excluído
publicado
arquivado

Toast discreto.

Não utilizar alert() do navegador.

Confirmação apenas para ações destrutivas.

Não perguntar confirmação para ações normais.

==================================================
28. PESQUISA
==================================================

Padronizar pesquisas.

Não quero:

campo + texto "Buscar" aleatoriamente afastado.

Preferir:

[🔍 Buscar produto........................]

ou botão integrado quando realmente necessário.

Debounce quando estiver fazendo busca automática.

Cancelar request anterior quando aplicável.

Não bombardear a API a cada tecla.

==================================================
29. PERFORMANCE
==================================================

Essa refatoração NÃO pode deixar o painel pesado.

Evitar:

- bibliotecas gigantes sem necessidade;
- re-renderizações;
- requests repetidos;
- carregar dados de todas as abas;
- carregar imagens enormes;
- hidratação desnecessária;
- componentes client sem necessidade.

Utilizar lazy loading quando fizer sentido.

Editor de produto:
carregar dados necessários conforme a seção for utilizada, se isso melhorar performance sem prejudicar UX.

==================================================
30. ACESSIBILIDADE
==================================================

Garantir:

aria-label em icon buttons
focus-visible
labels reais
contraste
navegação por teclado
ESC fecha modal/drawer
Enter executa ações apropriadas
área mínima de toque em mobile
mensagens de erro associadas ao campo

==================================================
31. NÃO MEXER NO QUE JÁ FUNCIONA SEM NECESSIDADE
==================================================

Não reescrever backend inteiro.

Não recriar APIs estáveis.

Não mudar banco apenas por estética.

Não quebrar integrações.

Não alterar:

painel do cliente
layout do painel do representante

exceto correções explicitamente solicitadas como valores monetários/kits quando essas funcionalidades forem administradas em outro painel.

==================================================
32. ARQUITETURA DE COMPONENTES
==================================================

Não quero dezenas de componentes duplicados.

Identifique componentes repetidos e consolide.

Exemplos:

PanelPageHeader
PanelToolbar
SearchInput
FilterBar
StatusBadge
ResponsiveDataList
MobileEntityCard
MoneyInput
EmptyState
LoadingState
ConfirmDialog
FormField
PanelDrawer
PanelModal
ActionMenu

Use os nomes que fizerem sentido para a arquitetura atual.

Não force esses nomes caso já exista estrutura equivalente.

==================================================
33. MOBILE FIRST
==================================================

Considere que funcionários vão usar MUITO o celular.

Teste especialmente:

produto
edição de produto
variações
estoque
pedidos
kits
cupons
conteúdo
criativos
painel gerencial
painel operacional
painel técnico
seletor de painel

em:

360x800
390x844
412x915
430x932

Nenhum deles pode parecer uma versão desktop comprimida.

==================================================
34. DETALHES VISUAIS
==================================================

Quero:

border-radius discreto
bordas claras
pouca sombra
bom espaçamento
hierarquia tipográfica clara
ícones consistentes
botões coerentes
densidade administrativa adequada

Não quero interfaces gigantes.

Um painel administrativo precisa mostrar bastante informação sem parecer apertado.

Encontrar equilíbrio entre:

compacto + legível.

==================================================
35. REVISAR TODAS AS PÁGINAS
==================================================

NÃO corrija apenas as páginas das screenshots.

As screenshots são exemplos dos problemas existentes.

Percorra TODAS as rotas dos seguintes ambientes:

administrativo
operacional
gerencial
técnico

E aplique o novo padrão em todas.

Faça inventário das páginas antes de começar.

Identifique:

1. páginas mantidas;
2. páginas consolidadas;
3. páginas removidas da navegação;
4. páginas redirecionadas;
5. funcionalidades movidas;
6. componentes compartilhados.

Depois implemente.

==================================================
36. EVITAR REGRESSÕES
==================================================

Depois da implementação verificar:

login
logout
troca de painel
RBAC
menu
rotas
produtos
criação de produto
edição
publicação
variações
imagens
estoque
categorias
coleções
kits
cupons
criativos
conteúdo
pedidos
painéis
configurações técnicas
mobile

Corrigir qualquer regressão encontrada.

==================================================
37. TESTES
==================================================

Rode TODOS os testes existentes do projeto.

Além disso:

lint
typecheck
build
testes unitários
integração
E2E disponíveis

Corrija erros causados pela refatoração.

Adicione/atualize testes para os fluxos alterados.

Criar pelo menos testes E2E dos fluxos críticos:

- login;
- escolha de painel;
- abrir Painel Administrativo;
- listar produtos;
- pesquisar produto;
- abrir produto;
- editar informações;
- editar uma variação;
- alterar estoque;
- salvar;
- comportamento mobile;
- abrir menu de ações;
- kit exibindo preço em reais;
- permissões;
- logout.

==================================================
38. TESTE VISUAL RESPONSIVO
==================================================

Revise manualmente ou por testes automatizados as páginas em:

Desktop:
1920x1080
1440x900
1366x768

Tablet:
768x1024

Mobile:
430x932
390x844
375x812
360x800

Procure especificamente:

overflow
componentes cortados
scroll horizontal
texto sobreposto
botões escondidos
footer sobre conteúdo
drawer cortado
header tremendo
inputs pequenos demais
layout desalinhado

Não considerar o trabalho concluído enquanto esses problemas existirem.

==================================================
39. NÃO CRIAR FUNCIONALIDADES FALSAS
==================================================

Todos os botões precisam funcionar.

Não quero UI fake.

Se criar:

Editar
Excluir
Duplicar
Arquivar
Publicar
Salvar
Upload
Gerar variações

a funcionalidade precisa estar conectada ao comportamento real.

==================================================
40. MIGRAÇÃO SEGURA
==================================================

Como estamos consolidando páginas:

não deletar funcionalidades antes de confirmar que o novo fluxo já possui equivalência.

Fluxo:

implementar novo local
→ validar
→ migrar navegação
→ adicionar redirects se necessário
→ remover UI antiga
→ validar novamente.

==================================================
41. RESULTADO ESPERADO
==================================================

Ao terminar, alguém deve conseguir entrar pelo celular e administrar praticamente toda a operação sem sentir que está usando um sistema desktop quebrado.

Principalmente Produtos.

O fluxo ideal deve ser aproximadamente:

Produtos
→ selecionar produto
→ administrar informações
→ preço
→ fotos
→ variações
→ estoque
→ logística
→ conteúdo
→ publicar

TUDO dentro do mesmo contexto.

Não:

Produtos
→ sair
→ Variações
→ procurar produto novamente
→ sair
→ Mídias
→ procurar novamente
→ sair
→ Estoque.

Essa fragmentação deve acabar.

==================================================
42. PRIORIDADE DE IMPLEMENTAÇÃO
==================================================

Faça na seguinte ordem:

FASE 1
Design system compartilhado + layout + header + sidebar + responsividade base.

FASE 2
Seletor de painel simplificado.

FASE 3
Produtos completamente refatorado.

FASE 4
Consolidação de variações, mídias e estoque dentro do Produto.

FASE 5
Pedidos e operacional.

FASE 6
Conteúdo, banners, construtor, cupons, criativos.

FASE 7
Kits e áreas de representantes administradas internamente.

FASE 8
Gerencial.

FASE 9
Técnico.

FASE 10
Remoção da tela "Configurações administrativas" do painel administrativo.

FASE 11
Revisão completa mobile.

FASE 12
Testes e regressões.

Não abandone a tarefa no meio das fases.

==================================================
43. ANTES DE ALTERAR
==================================================

Antes de codificar:

- faça git status;
- identifique branch atual;
- identifique estrutura dos workspaces;
- leia package.json;
- leia componentes compartilhados;
- leia layouts dos painéis;
- leia middleware/auth;
- leia implementação de RBAC;
- leia APIs relacionadas;
- identifique CSS/design tokens;
- identifique componentes reutilizáveis.

Não presuma arquitetura.

Use a arquitetura REAL encontrada no projeto.

==================================================
44. DURANTE A ALTERAÇÃO
==================================================

Preserve o padrão de código já usado no projeto.

Não use:

any indiscriminadamente
@ts-ignore
eslint-disable para esconder erro
hardcode desnecessário
duplicação
setTimeout fake
mock em produção

Não faça gambiarra para o TypeScript passar.

Resolva a causa.

==================================================
45. CRITÉRIO FINAL DE ACEITAÇÃO
==================================================

Somente considere concluído quando:

✓ todos os painéis internos usam identidade visual coerente;
✓ não existem botões pretos destoando;
✓ seletor de painel está extremamente simples;
✓ Produtos concentra variações, imagens e estoque;
✓ páginas redundantes foram consolidadas quando seguro;
✓ kit trabalha visualmente com reais;
✓ configurações administrativas técnicas desapareceram do painel administrativo;
✓ formulários funcionam no celular;
✓ tabelas possuem experiência mobile apropriada;
✓ drawers/modais não cortam conteúdo;
✓ nenhum overflow horizontal involuntário;
✓ spinner possui velocidade mais suave;
✓ estados de loading estão consistentes;
✓ todas as ações possuem feedback;
✓ RBAC continua funcionando;
✓ cliente não foi redesenhado;
✓ representante não foi redesenhado;
✓ APIs existentes continuam funcionando;
✓ build passa;
✓ lint passa;
✓ typecheck passa;
✓ testes passam;
✓ E2E crítico passa.

==================================================
46. RELATÓRIO FINAL
==================================================

Ao concluir, me dê um relatório curto contendo:

- principais componentes alterados;
- páginas consolidadas;
- páginas removidas da navegação;
- redirects adicionados;
- mudanças em Produtos;
- mudanças mobile;
- correção dos kits;
- localização final das configurações técnicas;
- testes executados;
- resultado do build;
- possíveis pendências reais, se existirem.

Não diga apenas "feito".

==================================================
47. COMMIT
==================================================

Depois que:

lint
typecheck
build
testes

estiverem passando:

execute:

git status

Revise os arquivos alterados.

NÃO inclua:
.env
.env.local
segredos
tokens
credenciais
arquivos temporários
artefatos locais

Depois faça o commit de TODA essa refatoração com uma mensagem semelhante a:

feat(panel): refatora UX, produtos e responsividade dos painéis internos

Depois execute:

git status
git log -1 --oneline

e me informe:

- hash do commit;
- mensagem;
- branch;
- se o working tree ficou limpo.

IMPORTANTE FINAL:

Não faça uma "maquiagem".

Quero resolver a CAUSA do problema.

O sistema deve ficar mais simples em arquitetura, navegação e uso.

MENOS páginas.
MENOS cliques.
MENOS informação inútil.
MENOS componentes gigantes.

MAIS funções concentradas no contexto correto.
MAIS consistência.
MAIS facilidade no celular.
MAIS velocidade para trabalhar.

Use como referência de qualidade sistemas modernos de gestão de ecommerce e marketplaces, mas mantenha identidade própria da curti Z.

Não copie visualmente nenhuma plataforma.

O objetivo é parecer software profissional criado especificamente para a curti Z, e não um template genérico.

==================================================
48. COMPLEMENTO OBRIGATÓRIO — SIMPLIFICAR LOGIN
==================================================

Além de TODA a refatoração descrita anteriormente, quero corrigir também a tela de login.

A tela atual possui uma grande área lateral com textos como:

- "Tudo sobre seus pedidos em um só lugar"
- explicações sobre compras;
- pedidos organizados;
- atendimento centralizado;
- informações promocionais/institucionais.

REMOVER COMPLETAMENTE ESSA ÁREA.

Não quero uma tela dividida em duas colunas.

A tela de login deve ser EXTREMAMENTE SIMPLES.

Quero basicamente:

                 [logo curti Z]

              Acesse sua conta

        E-mail
        [_______________________]

        Senha                 Esqueci minha senha
        [_______________________] [olho]

        □ Lembrar meu acesso neste dispositivo

        [ Entrar na minha conta ]

        ───────── ou ─────────

        Primeira vez na curti Z?
        [ Cadastre-se ]

Tudo centralizado.

Não precisa copiar exatamente essa representação, mas seguir essa lógica.

DESKTOP:

- formulário centralizado horizontalmente e verticalmente;
- largura confortável, aproximadamente 400–480px;
- sem coluna lateral;
- sem banner;
- sem textos promocionais;
- sem benefícios;
- sem grandes áreas coloridas;
- sem elementos decorativos desnecessários.

MOBILE:

- formulário ocupando corretamente a largura disponível;
- margens laterais adequadas;
- sem card gigante;
- sem overflow;
- sem conteúdo espremido;
- botão principal confortável para toque;
- logo proporcional;
- teclado não pode cobrir ações importantes sem possibilidade de scroll.

A tela deve parecer uma tela moderna de autenticação de ecommerce:

simples
rápida
limpa
profissional.

Não quero aparência de landing page.

IMPORTANTE:

NÃO remover funcionalidades existentes de autenticação.

Preservar:

- login;
- validações;
- sessão;
- lembrar acesso, se estiver implementado;
- mostrar/ocultar senha;
- recuperar senha;
- cadastro;
- redirects;
- mensagens de erro;
- segurança;
- rate limiting, se existir;
- Supabase/Auth utilizado pelo projeto.

Estamos alterando UX/UI, e não quebrando o sistema de autenticação.

Remover textos desnecessários também das versões tablet/mobile.

Se existirem várias telas internas reutilizando o mesmo layout dividido de autenticação, analise se faz sentido padronizar o componente de autenticação para evitar duplicação.

==================================================
49. TECLADO NUMÉRICO AUTOMÁTICO NO CELULAR
==================================================

Quero também uma revisão GLOBAL de todos os formulários do projeto.

Sempre que um campo aceitar OBRIGATORIAMENTE números, o navegador mobile deve abrir automaticamente o teclado numérico adequado.

Isso precisa ser feito corretamente através dos atributos HTML apropriados.

NÃO faça soluções baseadas em JavaScript abrindo teclado.

Use inputMode/type/autocomplete adequados.

IMPORTANTE:

Não usar indiscriminadamente:

type="number"

para campos que não representam matematicamente um número.

Por exemplo:

CPF
CNPJ
CEP
telefone
número de cartão
códigos
documentos

podem possuir zeros à esquerda e máscaras.

Nesses casos, normalmente manter:

type="text"

e utilizar:

inputMode="numeric"

além da máscara/validação já existente.

Quando adequado:

pattern="[0-9]*"

Mas não utilizar pattern de maneira que entre em conflito com máscaras ou validações existentes.

==================================================
50. CHECKOUT — TECLADOS CORRETOS
==================================================

Revisar especificamente o checkout.

No celular:

NOME
→ teclado normal

E-MAIL
→ type="email"
→ inputMode="email"
→ autocomplete="email"

TELEFONE
→ teclado telefônico/numérico adequado
→ type="tel"
→ inputMode="tel"
→ autocomplete="tel"

CPF
→ teclado numérico
→ manter máscara XXX.XXX.XXX-XX visualmente
→ inputMode="numeric"
→ autocomplete apropriado quando aplicável

CEP
→ teclado numérico
→ máscara XXXXX-XXX
→ inputMode="numeric"
→ autocomplete="postal-code"

NÚMERO DO ENDEREÇO
→ teclado numérico SE o campo realmente aceitar somente números.

Caso o sistema permita endereços como:

123A
S/N
12-B

não restringir incorretamente a entrada.

Analise a regra real do formulário antes.

CAMPOS DE QUANTIDADE
→ teclado numérico

CAMPOS DE ESTOQUE
→ teclado numérico

==================================================
51. OUTROS CAMPOS NUMÉRICOS DO SISTEMA
==================================================

Faça uma busca pelo projeto inteiro procurando inputs de:

CPF
CNPJ
CEP
telefone
quantidade
estoque
número
código numérico
percentual
desconto
preço
valor
peso
altura
largura
comprimento
dias
prazo
limites
parcelas
número de pedido, quando digitável
documentos
dados fiscais

e defina o teclado mobile correto.

Não limitar essa melhoria somente ao Checkout.

Aplicar em:

LOJA
PAINEL ADMINISTRATIVO
PAINEL OPERACIONAL
PAINEL GERENCIAL
PAINEL TÉCNICO
áreas relacionadas ao representante
formulários compartilhados

quando esses campos existirem.

==================================================
52. VALORES MONETÁRIOS
==================================================

Para campos monetários como:

Preço
Custo
Desconto em reais
Valor do kit
Frete
etc.

utilizar experiência apropriada para celular.

Preferencialmente:

inputMode="decimal"

quando casas decimais puderem ser digitadas.

A interface brasileira deve trabalhar visualmente com:

R$ 0,00
R$ 29,90
R$ 1.299,99

e não exigir que o usuário pense em centavos internos.

Isso complementa a regra anterior dos kits.

O banco/API pode continuar utilizando centavos internamente.

Exemplo:

interface:
R$ 29,90

backend:
2990

A conversão deve ficar centralizada e confiável.

Evitar:

parseFloat incorreto com vírgula
NaN
arredondamentos incorretos
perda de centavos

==================================================
53. PERCENTUAIS
==================================================

Campos que aceitam apenas percentual devem abrir teclado numérico/decimal conforme a regra real.

Exemplo:

Desconto
[ 10 ] %

Não obrigar a pessoa a escrever "%".

O símbolo deve fazer parte visual do componente.

Respeitar os limites da regra de negócio:

0–100

quando aplicável.

==================================================
54. NÃO USAR TYPE=NUMBER INDISCRIMINADAMENTE
==================================================

Muito importante:

Não quero simplesmente substituir todos os campos por:

<input type="number">

Isso pode causar:

- setas/spinners indesejados;
- perda de zero inicial;
- comportamento ruim com máscara;
- problemas de acessibilidade;
- inconsistência mobile;
- alteração involuntária dos valores.

Escolher corretamente entre:

type="text"
type="tel"
type="email"
type="number"

e:

inputMode="numeric"
inputMode="decimal"
inputMode="tel"
inputMode="email"

de acordo com a SEMÂNTICA do campo.

==================================================
55. MÁSCARAS NÃO PODEM SER QUEBRADAS
==================================================

Preservar ou melhorar máscaras existentes.

Exemplos:

CPF:
000.000.000-00

CNPJ:
00.000.000/0000-00

CEP:
00000-000

Telefone:
(31) 99999-9999

Mas o usuário deve conseguir digitar somente números e a máscara ser aplicada automaticamente.

Não exigir que o usuário digite:

.
-
/
(
)

Esses caracteres devem ser inseridos pela interface quando houver máscara.

==================================================
56. AUTOCOMPLETE DOS FORMULÁRIOS
==================================================

Aproveitar a revisão para adicionar autocomplete semântico quando apropriado.

Exemplos:

Nome:
autocomplete="name"

E-mail:
autocomplete="email"

Telefone:
autocomplete="tel"

CEP:
autocomplete="postal-code"

Endereço:
autocomplete="street-address"

Cidade:
autocomplete="address-level2"

Estado:
autocomplete="address-level1"

Senha atual/login:
autocomplete="current-password"

Nova senha:
autocomplete="new-password"

Isso melhora muito a experiência no celular.

Não adicionar autocomplete onde representar risco ou não fizer sentido.

==================================================
57. CHECKOUT MOBILE — REVISÃO DO FORMULÁRIO
==================================================

Além do trabalho anterior no checkout, verificar novamente a experiência mobile.

O formulário não deve parecer o desktop reduzido.

No celular:

Identificação

Nome
[________________]

E-mail
[________________]

Telefone
[________________]

CPF
[________________]

Depois:

Endereço de entrega

CEP
[________________]

Endereço
[________________]

Número
[________]

Complemento
[________________]

Bairro
[________________]

Cidade
[________________]

Estado
[________________]

Não colocar vários campos estreitos lado a lado quando isso prejudicar digitação.

Pode haver duas colunas SOMENTE para campos pequenos quando houver espaço real.

Em celulares menores, preferir uma coluna.

==================================================
58. FOCO E AVANÇO ENTRE CAMPOS NO CELULAR
==================================================

O formulário deve permitir fluxo rápido de preenchimento.

Configurar corretamente o comportamento do teclado para que:

Próximo
→ avance ao próximo campo.

Concluir
→ finalize a etapa quando apropriado.

Não criar lógica artificial se o navegador já resolver isso semanticamente.

A ordem de tabulação precisa seguir a ordem visual.

Não usar tabindex positivo sem necessidade.

==================================================
59. VALIDAÇÃO DE CAMPOS NUMÉRICOS
==================================================

Teclado numérico NÃO substitui validação.

Continuar validando no frontend e backend.

Exemplos:

CPF:
11 dígitos + validação existente, se houver.

CEP:
8 dígitos.

Telefone:
validar de acordo com a regra existente.

Estoque:
não permitir valor inválido.

Quantidade:
não permitir negativo quando não fizer sentido.

Preço:
não permitir formato monetário inválido.

Nunca confiar somente no inputMode.

==================================================
60. COMPONENTE COMPARTILHADO
==================================================

Se o projeto possui muitos campos repetidos, evite implementar essas regras manualmente em dezenas de lugares diferentes.

Considere padronizar componentes/helpers como:

MoneyInput
CpfInput
CnpjInput
CepInput
PhoneInput
NumericInput
QuantityInput
PercentageInput

ou adaptar os componentes já existentes.

Não crie componentes desnecessários caso já exista uma abstração adequada.

O objetivo é impedir que:

um CPF abra teclado numérico numa página
e teclado normal em outra.

O comportamento deve ser consistente no sistema inteiro.

==================================================
61. TESTES ADICIONAIS
==================================================

Além de TODOS os testes pedidos no prompt anterior, testar também:

LOGIN

✓ desktop sem painel lateral;
✓ login centralizado;
✓ tablet;
✓ mobile;
✓ campos funcionando;
✓ mostrar senha;
✓ esqueci senha;
✓ cadastro;
✓ lembrar acesso;
✓ validações;
✓ login real;
✓ logout;
✓ redirects.

CHECKOUT MOBILE

✓ nome abre teclado adequado;
✓ email abre teclado de e-mail;
✓ telefone abre teclado apropriado;
✓ CPF abre teclado numérico;
✓ CEP abre teclado numérico;
✓ campos numéricos usam inputMode adequado;
✓ máscara de CPF funciona;
✓ máscara de CEP funciona;
✓ máscara de telefone funciona;
✓ zero inicial não é perdido;
✓ formulário não possui overflow;
✓ teclado não deixa campos impossíveis de acessar.

PAINÉIS

Verificar campos numéricos principalmente em:

✓ Produtos
✓ Variações
✓ Estoque
✓ Kits
✓ Cupons
✓ Logística
✓ Conteúdo
✓ Pedidos
✓ configurações técnicas legítimas

==================================================
62. CRITÉRIOS EXTRAS DE ACEITAÇÃO
==================================================

Adicionar aos critérios finais do trabalho:

✓ tela de login não possui mais painel informativo lateral;
✓ login está simples e centralizado;
✓ login funciona perfeitamente no celular;
✓ todos os campos exclusivamente numéricos utilizam teclado mobile adequado;
✓ CPF abre teclado numérico;
✓ CEP abre teclado numérico;
✓ telefone abre teclado apropriado;
✓ valores monetários usam experiência decimal adequada;
✓ máscaras continuam funcionando;
✓ zero inicial não é perdido;
✓ não houve uso indiscriminado de type="number";
✓ autocomplete semântico foi adicionado onde apropriado;
✓ checkout mobile ficou rápido para preencher;
✓ formulários administrativos também receberam a melhoria;
✓ nenhuma validação ou segurança foi removida.

==================================================
63. IMPORTANTE — FAZER JUNTO COM A REFATORAÇÃO ANTERIOR
==================================================

ESTE BLOCO É COMPLEMENTAR AO PROMPT ANTERIOR.

Não trate isso como uma tarefa separada.

Faça:

refatoração completa dos painéis
+
simplificação da tela de login
+
revisão dos formulários
+
teclados mobile corretos
+
checkout
+
responsividade
+
testes

como UMA ÚNICA implementação coerente.

Depois execute novamente:

lint
typecheck
build
testes
E2E

Resolva qualquer erro.

Somente DEPOIS faça o commit solicitado no prompt anterior.

O commit final deve incluir todas essas alterações em conjunto.

==================================================
64. IMAGEM PRINCIPAL NA PÁGINA DO PRODUTO
==================================================

Quero corrigir também a apresentação da IMAGEM PRINCIPAL dentro da página do produto.

Atualmente existe uma área/quadrado grande atrás da imagem e depois a imagem fica menor dentro desse espaço, criando uma aparência estranha, com muito espaço vazio e sensação de "imagem dentro de outra caixa".

REMOVER ESSE COMPORTAMENTO.

Quero uma apresentação muito mais simples e profissional.

A imagem principal deve:

- aparecer diretamente na área destinada a ela;
- ter um tamanho visual bom e proporcional;
- ficar centralizada;
- não possuir um grande quadrado/fundo artificial atrás dela;
- não parecer estar dentro de uma segunda moldura;
- não criar espaço vazio desnecessário;
- nunca ser cortada;
- nunca ser esticada;
- nunca ser deformada;
- respeitar integralmente a proporção original da imagem.

A imagem deve ser exibida usando comportamento equivalente a:

object-fit: contain;

e NUNCA:

object-fit: cover;

na imagem principal do produto.

Isso é obrigatório porque produtos podem possuir imagens com proporções diferentes.

Exemplos:

imagem quadrada
imagem vertical
imagem horizontal
imagem com fundo branco
imagem com fundo transparente

TODAS precisam aparecer inteiras.

==================================================
65. COMPORTAMENTO VISUAL ESPERADO
==================================================

Não quero algo como:

[ grande caixa cinza/branca ]
       [ imagem menor ]
[                       ]

Quero algo visualmente equivalente a:

        [ IMAGEM DO PRODUTO ]

centralizada naturalmente dentro da área disponível.

A área pode possuir apenas o fundo normal da própria página.

Não adicionar:

- fundo cinza atrás da foto;
- segunda camada branca;
- container visual enorme;
- sombra na imagem;
- borda grossa;
- moldura decorativa.

Se tecnicamente for necessário manter um wrapper para controlar layout, ele deve ser VISUALMENTE NEUTRO:

background: transparent;
border: none;
box-shadow: none;

O usuário não deve perceber que existe uma "caixa atrás da imagem".

==================================================
66. TAMANHO DA IMAGEM
==================================================

A imagem não deve ficar minúscula.

Ela deve aproveitar bem o espaço disponível sem exagerar.

Desktop:

- ocupar uma área visual confortável;
- centralizada;
- possuir max-width apropriado;
- possuir max-height apropriado;
- nunca ultrapassar o espaço disponível.

Mobile:

- utilizar praticamente toda a largura útil disponível;
- manter margens pequenas e consistentes;
- preservar proporção;
- não ultrapassar viewport;
- não ficar artificialmente pequena.

Utilizar dimensões responsivas.

Evitar largura/altura fixa em pixels que possa funcionar para uma imagem e quebrar outra.

Preferir algo como:

width: 100%;
height: 100%;
object-fit: contain;

dentro de uma área responsiva adequada, ou outra implementação equivalente que respeite a arquitetura existente.

==================================================
67. NUNCA CORTAR IMAGENS DE PRODUTO
==================================================

REGRA GLOBAL IMPORTANTE:

Na visualização principal da página do produto, a imagem NUNCA pode ser cortada.

Independentemente de a imagem original ser:

1:1
4:5
3:4
16:9
vertical
horizontal
muito alta
muito larga

ela deve aparecer completamente.

Não aplicar crop automático.

Não ampliar a imagem além do necessário a ponto de cortar bordas.

Não usar background-image com background-size: cover para esse caso.

==================================================
68. IMAGENS COM FUNDO TRANSPARENTE OU BRANCO
==================================================

Não tentar artificialmente preencher o espaço restante com outra cor.

Se uma imagem tiver fundo branco:
mostrar normalmente.

Se tiver transparência:
mostrar sobre o fundo normal da página.

Não adicionar automaticamente:

cinza
bege
branco dentro de outro branco
bordas

apenas para "preencher" o espaço.

==================================================
69. DESCONTO / BADGES
==================================================

O badge de desconto, como:

-29%

pode continuar existindo.

Porém ele deve ficar posicionado de maneira limpa na área da imagem sem causar:

- sobreposição ruim;
- alteração do tamanho da imagem;
- deslocamento do produto;
- corte da imagem.

Utilizar position apropriado no container da galeria.

No mobile também precisa permanecer legível sem ocupar muito espaço.

==================================================
70. GALERIA DO PRODUTO
==================================================

Aplicar o mesmo cuidado à galeria de imagens.

Imagem principal:
sempre contain.

Miniaturas:
podem utilizar uma área de tamanho consistente, mas também evitar cortes importantes.

Se for necessário usar crop em thumbnails por consistência visual, isso NÃO pode afetar a imagem grande quando o usuário selecionar a miniatura.

Ao clicar em uma miniatura:
a imagem grande deve carregar completamente.

==================================================
71. ZOOM / VISUALIZAÇÃO AMPLIADA
==================================================

Se já existir a funcionalidade de clicar na imagem para ampliar, preservar.

Ao abrir a visualização ampliada:

- fundo escuro;
- imagem centralizada;
- imagem completamente visível;
- object-fit: contain;
- nunca cortar;
- botão X claro;
- funcionar no desktop e mobile.

Se houver zoom adicional, garantir que inicialmente a imagem apareça inteira antes do usuário aplicar zoom manualmente.

==================================================
72. PERFORMANCE DAS IMAGENS
==================================================

Não resolver isso carregando imagens gigantes sem necessidade.

Preservar otimizações existentes como:

- Next/Image, se usado;
- srcset;
- sizes;
- lazy loading quando apropriado;
- formatos otimizados;
- CDN/storage existente.

Evitar CLS.

Reservar o espaço necessário corretamente para a imagem sem precisar criar aquela moldura visual grande que existe atualmente.

==================================================
73. RESPONSIVIDADE DA GALERIA
==================================================

Testar a página do produto em:

360x800
375x812
390x844
412x915
430x932
768x1024
1366x768
1440x900
1920x1080

Garantir:

✓ imagem inteira;
✓ imagem centralizada;
✓ imagem com bom tamanho;
✓ sem container visual desnecessário;
✓ sem fundo artificial;
✓ sem corte;
✓ sem distorção;
✓ sem overflow;
✓ desconto corretamente posicionado;
✓ miniaturas funcionando;
✓ modal de imagem funcionando.

==================================================
74. REGRA FINAL DA IMAGEM DO PRODUTO
==================================================

A regra visual deve ser simples:

A FOTO É O DESTAQUE.

Não a caixa em volta dela.

Quero olhar para a página e enxergar diretamente o produto, e não:

container
→ outro fundo
→ outra caixa
→ imagem.

Simplificar completamente.

Este ajuste também faz parte da mesma refatoração e deve entrar no MESMO commit final solicitado anteriormente.

==================================================
75. CARD DE PRODUTO NA LOJA — REMOVER A CAIXA ATRÁS DA IMAGEM
==================================================

Quero corrigir também a exibição da imagem nos CARDS DE PRODUTO da loja.

Atualmente a imagem aparece com uma caixa/fundo visível atrás dela, como se o produto estivesse dentro de um bloco separado. Não quero isso.

Quero que no card apareça basicamente a IMAGEM DO PRODUTO, de forma limpa, sem essa moldura/quadrado atrás chamando mais atenção que a própria foto.

REMOVER esse fundo/caixa visual atrás da imagem.

A imagem do card deve:

- aparecer limpa e direta;
- ficar centralizada;
- ter um tamanho bom;
- ocupar bem a área visual disponível;
- nunca ser cortada;
- nunca ser deformada;
- nunca ficar minúscula;
- respeitar a proporção original;
- não parecer dentro de uma segunda caixa;
- não ter fundo artificial separado da foto.

==================================================
76. REGRA VISUAL DOS CARDS
==================================================

No card do produto, quero enxergar:

badge de desconto (se existir)
botão de favorito (se existir)
imagem do produto
informações do produto

Mas NÃO quero enxergar:

- um quadrado cinza;
- uma caixa branca dentro do card;
- uma moldura desnecessária atrás da imagem;
- sombra exagerada atrás da foto;
- borda grossa separando a imagem.

Se precisar existir um container técnico para posicionamento, ele deve ser VISUALMENTE NEUTRO:

- background transparente;
- sem borda visível;
- sem box-shadow;
- sem aparência de quadro/moldura.

==================================================
77. IMAGEM DO CARD NUNCA PODE SER CORTADA
==================================================

Nos cards da listagem/vitrine/categorias/recomendações, a imagem também deve seguir a regra:

object-fit: contain;

e não cover, quando isso estiver causando corte.

A imagem precisa aparecer inteira mesmo se ela for:

- quadrada;
- vertical;
- horizontal;
- com fundo branco;
- com transparência.

Nunca cortar partes importantes do produto só para preencher a área do card.

==================================================
78. ÁREA DA IMAGEM NO CARD
==================================================

A área da imagem deve ser simples e bem resolvida.

Quero que a foto aproveite bem o espaço disponível, mas sem exagero.

Desktop:
- imagem com presença visual boa;
- bem centralizada;
- sem sobra excessiva ao redor.

Mobile:
- imagem proporcional;
- bem visível;
- sem ficar pequena demais;
- sem fundo artificial atrás.

Se necessário, ajustar o espaçamento interno da área da imagem para reduzir o vazio.

==================================================
79. BADGES E FAVORITO
==================================================

O badge de desconto e o botão de favorito podem continuar existindo.

Porém eles devem ficar sobrepostos de forma limpa, sem criar a sensação de que existe uma “caixa de imagem” separada.

Garantir:

- badge bem posicionado;
- coração/favorito bem posicionado;
- sem sobrepor mal a foto;
- sem empurrar a imagem;
- sem deformar o layout do card.

==================================================
80. APLICAR EM TODAS AS VITRINES
==================================================

Essa correção não deve valer apenas para um card isolado.

Aplicar em todos os lugares equivalentes onde produtos aparecem em card, como por exemplo:

- listagem principal;
- categorias;
- busca;
- vitrines;
- ofertas;
- recomendações;
- carrosséis;
- “você também pode gostar”;
- produtos relacionados;
- grids de produtos.

Quero consistência visual em toda a loja.

==================================================
81. RESULTADO ESPERADO
==================================================

A imagem do produto deve ser o destaque do card.

Não quero olhar para o card e perceber primeiro uma caixa atrás da imagem.

Quero perceber primeiro o PRODUTO.

A estrutura visual deve ficar mais ou menos assim:

[badge]                      [favorito]

         [imagem do produto]

categoria
nome
avaliação
preço

Simples, limpo e profissional.

Esta melhoria também faz parte da mesma refatoração e deve entrar no mesmo commit final.
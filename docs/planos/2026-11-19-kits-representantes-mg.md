# Melhorias nos kits de representantes em MG

Proposta de 19/11/2026 aprovada pelo proprietário. A revisão passou no CI #761 e foi publicada na loja e no painel pelo CI #762. A abertura das compras depende do cadastro real e da homologação fiscal e operacional. Consulte a seção 14 do [documento de continuidade](../CONTINUIDADE-REVENDA-MG-2026-11-18.md#14-publicação-técnica-em-19112026) para a versão e as evidências atuais.

## Estado verificado na elaboração da proposta

- Os endpoints públicos de versão da loja e do painel responderam com o commit `665e455f1639b6715b611cc1cc62ccb45c962727`, build `44402930577-1`. O PR #136 segue em rascunho no head `628460bd71e178f21d3f490d03de30e94dc20cce`. O Supabase ainda tem como última migration `20261118030000` e a tabela de pedidos comerciais de kits do PR está ausente. O backup de produção foi adiado. A etapa de publicação com backup e compras fechadas segue pendente.
- O cadastro da imagem usa a configuração `kits` em `apps/panel/src/lib/admin-resources.ts`, a tela `apps/panel/src/components/admin-resource-manager.tsx` e a rota `apps/panel/src/app/api/admin/resources/[resource]/route.ts`. Hoje pede slug manual e oferece arquivamento. O cadastro usa `public.kits`. A compra comercial no PR usa as variantes `public.product_variants` e seus SKUs. O vínculo entre cadastro, fichas e catálogo precisa ser explícito para que a ação do painel produza o efeito esperado no representante.
- O Supabase de produção retornou um cadastro em `public.kits` e zero registros de pedidos, estornos e eventos nas tabelas privadas do fluxo TEST de kits. As consultas foram agregadas. O inventário cobre o módulo de kits e deve ser revalidado antes da alteração de configuração.
- No Bling, a busca somente leitura pela natureza cadastrada como “Homologacao MG nao consumidor final - 5102” retornou zero resultados. A busca ficou restrita a essa natureza e aos filtros da tela. Ainda falta identificar quais notas foram emitidas para representantes. A conferência anterior encontrou a natureza com CSOSN `102` e o controle de numeração mostrou `001` e `003`. A série `002` permanece por confirmar.
- Foi consultado o mapa existente do Graphify em `graphify-out/graph.json`, com `GRAPHIFY_BACKEND=none`. O mapa corresponde ao commit `a658ab6646d7bcc6cd3dadd1aa127d65cf179638`. A política do Windows bloqueou o executável do Graphify. Os pontos do mapa foram confirmados nos arquivos da cópia isolada do PR.

## 1. Retirar o fluxo de testes da produção

- Interpretar “remover os testes” como retirar da experiência produtiva as entradas do checkout de teste e bloquear no servidor novas cotações, pedidos e cobranças com a referência `KITTEST`. Conservar as contas, os perfis e as permissões existentes. Conservar os testes de engenharia e o CI no repositório. Comparar a configuração de produção com a da homologação antes de mexer nas flags.
- Conferir `apps/store/src/app/api/representatives/kits/transactions/route.ts`, a rota `quote` e o processamento `KITTEST` no webhook e nas rotinas agendadas. Se houver algum pedido TEST pendente na releitura, preservar os caminhos de conciliação, cancelamento e liberação de estoque até o estado final. O inventário atual encontrou zero registros nesses controles.
- Critério de aceite. Uma conta existente continua autenticando e acessando as funções normais. A produção recusa criar uma transação TEST e o varejo conserva o próprio checkout.

## 2. Cadastro de kits e exclusão com confirmação

- Reformular o modal da imagem para **Novo kit** e **Editar kit**. Agrupar nome e descrição, preço, fichas vinculadas e status. Alinhar campos e mensagens, mostrar o preço em reais e manter as ações claras no desktop e no celular.
- Tirar o campo slug do formulário. Gerar no servidor a partir do nome ao criar ou duplicar, reaproveitando a normalização existente. Resolver colisões com sufixo e restrição de unicidade, inclusive em gravações simultâneas. Preservar o slug salvo quando o nome mudar. Retornar erros no campo Nome.
- Disponibilizar **Excluir** para cada kit, com a confirmação “Tem certeza de que deseja excluir o kit [nome]?”. Kit sem vínculos históricos pode ser excluído definitivamente. Kit com cotação, pedido, referência ou regra histórica vinculada sai da lista ativa e do catálogo de representantes por exclusão lógica. A operação checa as dependências na mesma transação, trata corridas com pedidos e preserva os SKUs compartilhados com o varejo. Se for obrigatório para ativação, a confirmação informa o impacto na regra correspondente.
- Critérios de aceite. Nome com acentos gera slug válido e dois nomes iguais recebem endereços distintos. Editar nome mantém referências existentes. Cancelar a confirmação mantém o kit. Excluir um kit remove a opção de novas compras no canal e conserva os pedidos e devoluções vinculados. A API aplica a permissão de gestão independentemente da interface.

## 3. Fichas padrão por tamanho e quantidade

- A lista que o proprietário vai enviar define o nome ou código de cada ficha, os tamanhos, a quantidade por tamanho e os kits aos quais se aplica. Em `apps/store/src/components/representative-kit-catalog.tsx`, apresentar **Escolher ficha**, a grade de tamanho e quantidade e o total de pares. Separar a quantidade prevista pela ficha da quantidade de kits pedida pelo representante.
- Vincular a ficha a SKUs existentes. Conferir se a lista corresponde à estrutura de variantes atual antes de escolher a alteração do banco. Se uma ficha consumir mais de uma variante, reservar todos os itens juntos. A seleção determina preço, estoque, composição fiscal, volumes e frete no servidor. Guardar a versão da ficha e sua composição no pedido. Mudanças futuras na ficha valem para pedidos novos.
- Critérios de aceite. O representante só vê fichas compatíveis com o kit e tem a soma dos pares antes de confirmar. A falta de qualquer tamanho impede a reserva da ficha inteira. Duas compras disputando a mesma grade respeitam o estoque compartilhado. A cotação confirmada e a NF-e refletem a composição que foi comprada.

## 4. Pagamento no recebimento em Minas Gerais

- Apresentar **Pagar agora** e **Pagar no recebimento** no checkout de kits. Na segunda opção, mostrar todos os meios efetivamente habilitados para aquela entrega. A proposta inicial inclui Pix, cartão de débito, cartão de crédito e dinheiro. Confirmar parcelamento e troco se fizerem parte da operação. O Mercado Pago Point oferece cartão, QR Code e Pix presenciais com terminal compatível. A capacidade de cobrar o valor do pedido nas modalidades contratadas pelo Melhor Envio ainda precisa ser confirmada. [Mercado Pago Point](https://www.mercadopago.com.br/developers/pt/docs/mp-point/overview) · [Operação do Melhor Envio](https://centraldeajuda.melhorenvio.com.br/hc/pt-br/articles/31220736046612-O-Melhor-Envio-%C3%A9-uma-transportadora)
- A compra antecipada no PR dispara o processamento fiscal depois da confirmação do Pix. O recebimento exige um fluxo explícito que permita a expedição de um pedido elegível com NF-e autorizada e saldo pendente. Só baixar o saldo mediante confirmação do provedor ou registro de recebimento em dinheiro por operador autorizado. Registrar valor, método e comprovante ou referência com proteção contra duplicidade. A tentativa de entrega, a entrega confirmada e a liquidação financeira têm eventos próprios.
- Definir com o proprietário quem cobra, quais CEPs e rotas atendem e quais meios aceita em cada rota. No caso de recusa, falha na cobrança ou ausência, manter rastreabilidade e liberar o estoque após retorno físico confirmado. Em devolução após recebimento, usar a conciliação e o estorno apropriados ao método.
- Critérios de aceite. A opção só aparece em endereços de MG elegíveis para a rota de cobrança. O sistema aceita um único recebimento para o valor correto, mantém pendências visíveis no painel e trata recusa, cancelamento e devolução. Testar sem despesas e sem emissão fiscal produtiva.

## 5. Conferência fiscal e publicação

- Com o número e a série das notas mencionadas, localizar no Bling e conferir apenas série, natureza, CFOP, CSOSN, ambiente, situação de autorização e relação com a operação de kits. Registrar a evidência sem documentos pessoais. Confirmar o uso das séries de venda e devolução e as regras para pagamento no recebimento antes da ativação.
- Revalidar a publicação anterior do PR #136, o backup recuperável e as migrations antes de publicar no banco produtivo. As melhorias devem partir do código efetivamente publicado ou do PR acordado. Após a aprovação, validar o patch no CI, publicar com os controles de ativação e verificar `/api/version` nos dois Workers. Conferir acesso das contas existentes, checkout varejista nacional e a disponibilidade do canal de kits restrita a MG. Habilitar a compra conforme as evidências fiscais e operacionais.

## Dados aguardados para concluir a especificação

- Lista das fichas por kit, tamanho e quantidade. A planilha ou o formato que o proprietário já usa servem como entrada.
- Responsável pela cobrança na entrega, região atendida e meios aceitos, incluindo parcelamento e dinheiro com troco se forem usados.
- Número e série de uma ou duas NF-e de representantes para localizar no Bling. A série e o número bastam para identificar os registros na sessão autenticada.

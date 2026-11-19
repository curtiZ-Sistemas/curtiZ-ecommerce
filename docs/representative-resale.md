# Kits para revenda dos representantes

O canal atende exclusivamente Minas Gerais. O escopo e as evidências de liberação estão no [relatório da revenda MG](./revenda-mg-relatorio-final.md).

O portal usa diretamente os kits já cadastrados em `products`/`product_variants`, seus preços e `inventory`. O representante escolhe cor/tamanho e quantidade de kits; estoque disponível não é confundido com quantidade comprada. Não é necessário recadastrar SKU/quantidade nem preencher a oferta legada “Completo”. A revenda permanece separada de `orders` e do checkout B2C. A condição de representante não determina se a pessoa é contribuinte do ICMS.

Enquanto a revenda não estiver homologada:

- O portal mantém consulta de ofertas/histórico e informa que a compra está indisponível.
- `buy_kit` responde409/`RESALE_NOT_HOMOLOGATED`, sem criar pedido, pagamento ou reserva.
- O trigger `representative_resale_homologation_gate` bloqueia criacao e avancos comerciais/fiscais no fluxo legado. A excecao isolada TEST exige ledger privado validado e mantem expedicao bloqueada; esta descrita abaixo. Cancelamento e reembolso continuam possiveis.

## Conferência técnica sem efeitos comerciais

`GET /api/representatives/kits/catalog?offset=0`, com sessão válida, lista24 variantes por página e próximo offset, usando somente produtos/variantes ativos com metadados de kit. Perfil ativo e acesso aprovado de representante são obrigatórios. Falha de consulta não é apresentada como catálogo vazio.

`POST /api/representatives/kits/preview`, com sessão válida e origem permitida:

```json
{"variantId":"UUID da variante já cadastrada","quantity":3,"icmsTaxpayer":false}
```

`icmsTaxpayer` é opcional para a conferência; ausente resulta em pendência explícita. Não é inferido de CNPJ ou papel. A prévia se refere à compra para revenda, mas não determina o indicador fiscal de consumidor final: `finalConsumer=null` e a validação correspondente permanece pendente. `canPurchase=false`. Cliente não fornece preço, estoque, composição, tributação ou `orderId`.

A API aceita opcionalmente `declaredScenario` com tipo de pessoa (`individual`/`business`), finalidade (`resale`/`final_consumption`/`other`), condição de ICMS (`taxpayer`/`registration_exempt`/`non_taxpayer`/`unknown`) e UF de destino. Não pode ser combinado com o campo legado `icmsTaxpayer`. No catálogo, o representante pode informar o tipo de comprador e a condição de ICMS. Quando informados, os dois campos seguem com finalidade `resale` e destino `MG`. A resposta identifica a declaração como `unverified`. Identificadores pessoais e campos de aprovação não são aceitos nesse objeto. Os bloqueios fiscais e comerciais continuam obrigatórios.

A RPC `read_representative_catalog_kit_context` valida o representante, perfil/status, variante ativa e quantidade entre1 e99. Quantidade acima do estoque resulta em bloqueio na prévia. Preço unitário vem do cadastro, total é recalculado no servidor e a composição fiscal vigente é reutilizada. SKU e estoque próprios são preservados; pares fiscais nunca baixam avulsos. Composição fiscal ausente/desatualizada continua bloqueada, sem inventar componentes.

O formato antigo `{kitId,icmsTaxpayer}` continua aceito para compatibilidade, com regras de nível da oferta e pesos explícitos entre SKUs. Ele não é a fonte da tela Comprar kits. A oferta antiga vazia não é preenchida automaticamente nem é uma pendência a ser informada pelo dono. O caminho novo usa apenas a variante escolhida e seu preço cadastrado, sem rateio entre ofertas. A decomposição por par conserva todos os centavos.

Frete, total final e tributos ficam `null` até validação própria; a prévia não é cotação completa, autorização fiscal ou integração de pagamento. Nenhum job externo é enfileirado.

No catálogo, Calcular frete chama `POST /api/representatives/kits/quote` com `mode: "preview"`, variante, quantidade e CEP. Com a prévia de frete da loja habilitada e Melhor Envio em produção, a rota confere o acesso e o estoque e retorna serviços, preço e prazo estimados com a embalagem cadastrada. O resultado serve para consulta. A rota de prévia não gera uma cotação de checkout.

A mesma rota aceita `mode: "checkout"`, variante, quantidade, endereço salvo e serviço. Recalcula o frete com o endereço do representante e grava a cotação dos kits em uma tabela privada. A cotação vale por até 30 minutos e identifica quantidade, endereço, variante e a composição usada no transporte. O checkout produtivo ainda precisa chamar a função privada de consumo na mesma transação que cria o pedido. A função devolve o valor cotado uma vez, após conferir novamente endereço, composição e vigência.

## Condições para futura homologação

Usar os SKUs, preços, estoques e composições que já estão cadastrados, sem pedir novamente SKU/quantidade ao dono. Validar a aplicação fiscal da revenda e os dados reais do destinatário, sem copiar automaticamente a aprovação B2C. Homologar pagamento de `kit_orders`, reserva/baixa do SKU próprio, cancelamento/replay, NF-e e expedição no escopo separado antes de remover o bloqueio por outra revisão.

Teste atual comprova preparação técnica e bloqueios, não uma compra de revenda concluída. Não alterar flags compartilhadas para realizar essa conferência.

## Transacao isolada TEST (implementacao de 23/10/2026)

A transacao separada usa kit_orders, ledger privado com RLS forcada e referencia KITTEST-UUID no Mercado Pago. Nao cria orders/payments B2C. O SKU comercial reserva seu proprio estoque; os componentes fiscais reais e atuais ficam no snapshot e nao baixam avulsos. O preco e recalculado do cadastro e o frete vem de cotacao sandbox vinculada ao ator, composicao de transporte, endereco e prazo.

As migrations 20261023160000 a 20261023164000 sao incrementais. Aplicar e testar primeiro no projeto isolado. Nao modificar arquivos ja aplicados. A API permanece fechada para criar/pagar sem REPRESENTATIVE_TEST_TRANSACTIONS_ENABLED=true e REPRESENTATIVE_TEST_ACTOR_ID igual a conta de representante explicitamente autorizada; modo de pagamento deve ser test e cotacao sandbox. Essas variaveis nao autorizam fiscalizacao nem vendas produtivas. Consulta, cancelamento e reembolso continuam vinculados ao titular.

POST /api/representatives/kits/quote recebe {variantId,quantity,postalCode}, quantidade de 1 a 99. Retorna cotacoes reais sandbox persistidas. POST /api/representatives/kits/transactions aceita create {variantId,quantity,quoteId,addressId,idempotencyKey}; read, pay_pix, reconcile e cancel recebem orderId. pay_card recebe orderId e card {paymentMethodId,token,issuerId?,installments}; o token deve vir do SDK do provedor. PAN e codigo de seguranca nao sao aceitos. pay_pix/pay_card podem receber payerDocument TEST: o resolvedor existente valida o documento sandbox sem salva-lo como identidade pessoal; ausente reutiliza identidade ja validada. refund recebe tambem idempotencyKey e amountInCents. Valores, ator e modo enviados pelo cliente sao rejeitados. Cartao usa o mesmo ledger, lease e chave estavel do Pix; fingerprint HMAC impede trocar o metodo/token de uma tentativa incerta e o token nao e armazenado no banco.

Opcionalmente, `create` pode receber `declaredScenario` conforme o esquema da prévia, com finalidade `resale`. No caminho TEST, a declaração é registrada como snapshot privado e não verificado na mesma transação que cria ou recupera o pedido; a UF deve coincidir com o endereço do pedido. O mesmo pedido não aceita uma declaração diferente no replay. A leitura autenticada do pedido retorna apenas a declaração do próprio titular, marcada como não verificada. Dados pessoais, campos extras e uma suposta aprovação não são aceitos nesse objeto. O cadastro não verifica condição fiscal nem libera NF-e ou expedição. A interface comercial ainda não usa esse fluxo; a compra produtiva continua fechada.

Tentativas usam lease, identidade estavel e limite de 23 horas para replay incerto. A consulta autenticada do provedor verifica referencia, identidade, moeda, valor e ambiente. Webhook mantem assinatura, frescor, hash e deduplicacao existentes, com conciliacao separada para KITTEST. Reembolso parcial conserva estoque; cancelamento do saldo integral devolve o SKU uma vez. Aprovacao tardia apos liberacao exige reconciliacao, sem reabrir reserva. XML, etiqueta e e-mails nao sao disparados: os contratos downstream ficam em blocked_validation, preservando parecer fiscal e comprovacao de entrega.

O portal comercial e a acao antiga buy_kit permanecem bloqueados. O endpoint tecnico permite homologacao controlada sem apresentar uma compra produtiva antes das aprovacoes. Testes SQL em transacao com rollback e testes de adaptador/API nao equivalem a homologacao externa de kit pago.

A rotina agendada de expiracao recebe os bindings e o fetch nativo do Worker, limita cada lote a quatro pedidos TEST e isola falhas por pedido. So cancela uma tentativa conhecida depois de consultar e validar o provedor e conferir sua expiracao; uma aprovacao concorrente segue para conciliacao. Escrita desconhecida por mais de 23 horas vai para reconciliacao obrigatoria, preservando a reserva.

## Compra comercial de kits em Minas Gerais

O portal usa a cotação confirmada para criar um pedido e reservar o SKU cadastrado em uma transação. A rota comercial é `POST /api/representatives/kits/orders`. Os pedidos e os pagamentos usam o agregado privado `representative_kit_orders` e a referência `KITMG-<UUID>`. O checkout varejista e as operações `KITTEST` conservam seus pedidos e endpoints.

O corte inicial preparado é Pix para MG01 e MG02, no atacado de mercadoria de terceiros sem ST quando comprovado. O comprador fiscal, a entrega e a saída física estão em MG. O endereço fiscal oficial e o endereço de entrega podem ser diferentes. A operação exige CNPJ, IE ativa e aprovados para o comprador e uma versão fiscal vigente para o SKU. O crédito só entra em regra aprovada da competência, com referência ao mês anterior. O banco conserva os kits existentes sem inserir SKU, aprovação fiscal, regra tributária ou dados de exemplo.

O pagamento confirmado agenda a venda e a preparação da NF-e no Bling, com rateio por pares. A tela Notas fiscais do painel operacional permite aprovar o rascunho conferido no Bling. O envio exige o mesmo hash revisado e as flags existentes de transmissão. O despacho só avança após leitura do XML de produção com protocolo, série 002, emitente, comprador, endereço de entrega, retirada, itens e valores correspondentes ao pedido. O Melhor Envio cria o envio com a NF-e e só compra uma etiqueta dentro do custo cotado. O comprador acompanha o rastreio no portal.

O cancelamento pode interromper uma reserva ou um Pix pendente. Se a confirmação do Pix vencer a corrida e o pedido ainda não tiver operação fiscal ou logística, o estorno integral é enfileirado. As devoluções aparecem no painel operacional, com permissões existentes para aprovar, inspecionar e estornar. A validação exige a NF-e autorizada correspondente ao pedido original, série 003 quando a própria curti Z emite a entrada, itens proporcionais aos kits devolvidos e saldo disponível. O estoque só recebe os kits aprovados na inspeção e após o estorno ser confirmado. Operações externas incertas conservam os identificadores e entram em conciliação sem uma nova escrita automática.

### Publicação e habilitação

1. Conferir o backup recuperável e o histórico de migrations no Supabase de destino. Aplicar as migrations do PR em ordem e publicar loja e painel pelo workflow oficial. Na publicação inicial, manter as flags comerciais desativadas.
2. Conferir `/api/version` de cada Worker e executar os smoke tests do CI. Confirmar que o catálogo e o checkout varejista nacional continuam disponíveis. Conferir frete de kit em MG e recusa para outro estado com uma conta autorizada, sem iniciar cobrança.
3. Confirmar contrato e modalidade sem ST para a rota inicial, classificação e origem do lote, guarda ou retirada em Nova Serrana, cadastro e regime do comprador, natureza fiscal, conta Bling e numeração disponível. Registrar a evidência de NF-e de venda e de pelo menos uma rota de devolução em homologação, ambas com protocolo autorizado. Para crédito, registrar a competência, a taxa e a base nas versões fiscais correspondentes.
4. Conferir no Mercado Pago a titularidade da conta (collector), Pix de homologação, webhook e estorno. Conferir no Melhor Envio os volumes cotados, o vínculo da etiqueta ao XML, compra e rastreio em ambiente isolado. Cadastrar somente as aprovações sustentadas por essas verificações.
5. Configurar `REPRESENTATIVE_KIT_MP_COLLECTOR_ID`, `REPRESENTATIVE_KIT_FULFILLMENT_ENABLED`, `REPRESENTATIVE_KIT_REFUNDS_ENABLED` e as autorizações existentes dos provedores no Worker. Habilitar `REPRESENTATIVE_KIT_CHECKOUT_ENABLED` após a verificação da rota. Para suspender novas compras, desativar essa última flag e conservar consultas, conciliação, devoluções e estornos dos pedidos existentes.

## Fichas de 12 pares

| Ficha | 34 | 35 | 36 | 37 | 38 | 39 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Padrão | 1 | 2 | 3 | 3 | 2 | 1 |
| Reposição baixa | 1 | 3 | 4 | 4 | 0 | 0 |
| Reposição alta | 0 | 0 | 0 | 4 | 4 | 4 |

No cadastro administrativo, selecione a linha de estoque pelo modelo e pela cor. A linha precisa ter uma variante avulsa ativa para cada tamanho de 34 a 39. O preço cadastrado é o valor de uma ficha. O banco grava a grade e o preço junto ao pedido. O estoque, a cotação, a NF-e e a devolução usam as quantidades por tamanho. As versões fiscais existentes para pacotes de dois ou três pares e a aprovação da ficha têm identificações próprias. Use `read_representative_kit_grade_fingerprint` no backend para obter a impressão digital da composição a homologar.

O slug é criado na inclusão ou duplicação. **Excluir** remove o kit do catálogo e da lista administrativa. O banco conserva kits com dependências históricas e permite o processamento de pedidos anteriores. As contas existentes e os SKUs usados pelo varejo conservam seu cadastro.

## Recebimento na entrega

O recebimento está disponível na entrega própria para CEPs de MG cobertos por uma rota operacional verificada. A configuração privada `representative_kit_collection_routes` guarda a faixa de CEP, o CEP de origem, o custo, o prazo, os IDs de pagamento no Bling, o terminal Point e a referência da evidência. Uma faixa sobreposta impede que o checkout reserve um pedido naquela área. O cadastro de rotas e as credenciais do terminal precisam corresponder à operação real.

O representante escolhe Pix, débito, crédito à vista ou dinheiro. Em dinheiro, ele informa quanto pretende entregar. O servidor grava esse valor no pedido e deriva o troco em centavos sobre o total confirmado. A expedição vê o troco e só registra saída após verificação do protocolo da NF-e. O pagamento presencial por Pix ou cartão começa no painel operacional após o registro de saída. O Point valida a conta, o terminal, a referência, o método e o valor antes de confirmar. A equipe confirma o numerário com uma referência auditável. Entrega sem cobrança mantém a reserva até a verificação do retorno físico e do cancelamento fiscal.

As devoluções de kits recebidos passam pela revisão fiscal e financeira. No painel, confirme devolução em dinheiro por uma referência própria ou envie e concilie o estorno pelo Point. O estoque usa as quantidades inspecionadas de cada tamanho.

Antes de habilitar `REPRESENTATIVE_KIT_COLLECTION_ENABLED`, confirme a operação de entrega, o caixa Point, o perfil autorizado do operador e os meios de pagamento, e verifique a NF-e com cobrança no recebimento. Configure os bindings do Worker da loja para cotação e o Worker do painel para Point. O painel precisa das credenciais de produção do Mercado Pago, `REPRESENTATIVE_KIT_MP_COLLECTOR_ID` e as flags de recebimento e estorno para as ações correspondentes. Mantenha a aplicação e o terminal em homologação durante testes que simulem cobranças.


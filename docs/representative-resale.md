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


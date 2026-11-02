# Kits para revenda dos representantes

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

`icmsTaxpayer` é opcional para a conferência; ausente resulta em pendência explícita. Não é inferido de CNPJ ou papel. Finalidade sempre `resale`, `finalConsumer=false` e `canPurchase=false`. Cliente não fornece preço, estoque, composição, tributação ou `orderId`.

A RPC `read_representative_catalog_kit_context` valida o representante, perfil/status, variante ativa e quantidade entre1 e99. Quantidade acima do estoque resulta em bloqueio na prévia. Preço unitário vem do cadastro, total é recalculado no servidor e a composição fiscal vigente é reutilizada. SKU e estoque próprios são preservados; pares fiscais nunca baixam avulsos. Composição fiscal ausente/desatualizada continua bloqueada, sem inventar componentes.

O formato antigo `{kitId,icmsTaxpayer}` continua aceito para compatibilidade, com regras de nível da oferta e pesos explícitos entre SKUs. Ele não é a fonte da tela Comprar kits. A oferta antiga vazia não é preenchida automaticamente nem é uma pendência a ser informada pelo dono. O caminho novo usa apenas a variante escolhida e seu preço cadastrado, sem rateio entre ofertas. A decomposição por par conserva todos os centavos.

Frete, total final e tributos ficam `null` até validação própria; a prévia não é cotação completa, autorização fiscal ou integração de pagamento. Nenhum job externo é enfileirado.

## Condições para futura homologação

Usar os SKUs, preços, estoques e composições que já estão cadastrados, sem pedir novamente SKU/quantidade ao dono. Validar a aplicação fiscal da revenda e os dados reais do destinatário, sem copiar automaticamente a aprovação B2C. Homologar pagamento de `kit_orders`, reserva/baixa do SKU próprio, cancelamento/replay, NF-e e expedição no escopo separado antes de remover o bloqueio por outra revisão.

Teste atual comprova preparação técnica e bloqueios, não uma compra de revenda concluída. Não alterar flags compartilhadas para realizar essa conferência.

## Transacao isolada TEST (implementacao de 23/10/2026)

A transacao separada usa kit_orders, ledger privado com RLS forcada e referencia KITTEST-UUID no Mercado Pago. Nao cria orders/payments B2C. O SKU comercial reserva seu proprio estoque; os componentes fiscais reais e atuais ficam no snapshot e nao baixam avulsos. O preco e recalculado do cadastro e o frete vem de cotacao sandbox vinculada ao ator, composicao de transporte, endereco e prazo.

As migrations 20261023160000 a 20261023164000 sao incrementais. Aplicar e testar primeiro no projeto isolado. Nao modificar arquivos ja aplicados. A API permanece fechada para criar/pagar sem REPRESENTATIVE_TEST_TRANSACTIONS_ENABLED=true e REPRESENTATIVE_TEST_ACTOR_ID igual a conta de representante explicitamente autorizada; modo de pagamento deve ser test e cotacao sandbox. Essas variaveis nao autorizam fiscalizacao nem vendas produtivas. Consulta, cancelamento e reembolso continuam vinculados ao titular.

POST /api/representatives/kits/quote recebe {variantId,quantity,postalCode}, quantidade de 1 a 99. Retorna cotacoes reais sandbox persistidas. POST /api/representatives/kits/transactions aceita create {variantId,quantity,quoteId,addressId,idempotencyKey}; read, pay_pix, reconcile e cancel recebem orderId. pay_card recebe orderId e card {paymentMethodId,token,issuerId?,installments}; o token deve vir do SDK do provedor. PAN e codigo de seguranca nao sao aceitos. pay_pix/pay_card podem receber payerDocument TEST: o resolvedor existente valida o documento sandbox sem salva-lo como identidade pessoal; ausente reutiliza identidade ja validada. refund recebe tambem idempotencyKey e amountInCents. Valores, ator e modo enviados pelo cliente sao rejeitados. Cartao usa o mesmo ledger, lease e chave estavel do Pix; fingerprint HMAC impede trocar o metodo/token de uma tentativa incerta e o token nao e armazenado no banco.

Tentativas usam lease, identidade estavel e limite de 23 horas para replay incerto. A consulta autenticada do provedor verifica referencia, identidade, moeda, valor e ambiente. Webhook mantem assinatura, frescor, hash e deduplicacao existentes, com conciliacao separada para KITTEST. Reembolso parcial conserva estoque; cancelamento do saldo integral devolve o SKU uma vez. Aprovacao tardia apos liberacao exige reconciliacao, sem reabrir reserva. XML, etiqueta e e-mails nao sao disparados: os contratos downstream ficam em blocked_validation, preservando parecer fiscal e comprovacao de entrega.

O portal comercial e a acao antiga buy_kit permanecem bloqueados. O endpoint tecnico permite homologacao controlada sem apresentar uma compra produtiva antes das aprovacoes. Testes SQL em transacao com rollback e testes de adaptador/API nao equivalem a homologacao externa de kit pago.

A rotina agendada de expiracao recebe os bindings e o fetch nativo do Worker, limita cada lote a quatro pedidos TEST e isola falhas por pedido. So cancela uma tentativa conhecida depois de consultar e validar o provedor e conferir sua expiracao; uma aprovacao concorrente segue para conciliacao. Escrita desconhecida por mais de 23 horas vai para reconciliacao obrigatoria, preservando a reserva.

## Proposta de contrato para futura operação produtiva

Este contrato é uma proposta para revisão da operação produtiva; não descreve a transação TEST acima e não libera `buy_kit`, pagamento de produção, NF-e ou expedição.

- **Identidade e valor:** o recurso continua sendo `kit_orders`, separado de `orders`. Use `kit_orders.id` como chave interna e `kit_orders.public_code` como `external_reference` estável do Mercado Pago; não use CPF, e-mail ou outro dado pessoal na referência. O servidor recompõe SKU/variante, quantidade, preço e total a partir do catálogo vigente. Frete, tributos e composição ausentes permanecem bloqueados; o cliente não os fornece.
- **Criação e reserva:** uma chave de idempotência estável identifica a intenção de compra do representante. A transação do banco valida sessão, perfil e estado do representante, trava estoque do SKU de kit e cria o `kit_order`, itens de snapshot, tentativa de pagamento e reserva com expiração de forma atômica. Repetir a mesma chave e os mesmos dados devolve o mesmo recurso; reutilizá-la com dados diferentes é conflito. A chamada ao provedor ocorre depois do commit. Timeout incerto exige consulta pela referência estável antes de qualquer nova criação.
- **Confirmação:** retorno do navegador não altera estado. Webhook válido inicia uma consulta autenticada do pagamento no Mercado Pago. A conciliação exige correspondência de identificador, ambiente, referência, moeda e total; divergência vai para revisão manual. Uma única transação bloqueia pedido, pagamento e reserva, registra a confirmação e converte a reserva em movimento de estoque uma vez. Replay e concorrência não repetem movimento, ativação do representante ou evento downstream.
- **Saldo reembolsável:** é o valor efetivamente aprovado menos refunds que o provedor confirmou como concluídos. Refund parcial não devolve estoque. Cancelamento pago solicita apenas o saldo restante, com chave de idempotência por operação; estado `refunded` só é gravado após reconciliação do provedor. Timeout ou resposta ambígua mantém revisão pendente e exige consulta, sem repetir POST.
- **Cancelamento e estoque:** pagamento ainda pendente só libera reserva após cancelamento/expiração confirmados no provedor; reserva vencida não apaga nem invalida um pagamento que possa ter sido aprovado. Cancelamento de kit já pago precisa conciliar primeiro o saldo e o estado de separação/expedição. A reposição de estoque da loja e a reversão do inventário do representante são movimentos distintos e exigem evento operacional confirmado; reembolso, sozinho, não simula devolução física.
- **Eventos para Bling, logística e e-mail:** emitir evento por outbox somente depois do commit da transição. A chave do evento é estável por `kit_order` e transição. O envelope mínimo inclui `kit_order_id`, `public_code`, tipo e versão do evento, status, total/moeda, `payment_reference`, identificador do pagamento, instante de confirmação e saldo reembolsado. Não inclui token, cartão, CPF, corpo bruto do provedor ou payload pessoal. Bling recebe finalidade `resale` explicitamente e não herda aprovação fiscal B2C; logística aguarda autorização fiscal de revenda e pagamento confirmado; e-mail consome o mesmo evento idempotente sem decidir o estado comercial.

A implementação TEST descrita acima já existe, com limites próprios. Antes de qualquer operação produtiva, revisar este contrato contra o código vigente e concluir os testes de concorrência, replay e reembolso, além da homologação e aprovação fiscal separadas. Não associar pedidos de kit às estruturas B2C por escrita direta nem contornar os bloqueios existentes.


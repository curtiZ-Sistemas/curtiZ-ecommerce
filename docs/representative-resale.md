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

POST /api/representatives/kits/quote recebe {variantId,quantity,postalCode}, quantidade de 1 a 99. Retorna cotacoes reais sandbox persistidas. POST /api/representatives/kits/transactions aceita create {variantId,quantity,quoteId,addressId,idempotencyKey}; demais acoes read, pay_pix, reconcile, cancel recebem orderId. refund recebe tambem idempotencyKey e amountInCents. Valores, ator e modo enviados pelo cliente sao rejeitados. CPF e identidade sao obtidos dos servicos existentes.

Tentativas usam lease, identidade estavel e limite de 23 horas para replay incerto. A consulta autenticada do provedor verifica referencia, identidade, moeda, valor e ambiente. Webhook mantem assinatura, frescor, hash e deduplicacao existentes, com conciliacao separada para KITTEST. Reembolso parcial conserva estoque; cancelamento do saldo integral devolve o SKU uma vez. Aprovacao tardia apos liberacao exige reconciliacao, sem reabrir reserva. XML, etiqueta e e-mails nao sao disparados: os contratos downstream ficam em blocked_validation, preservando parecer fiscal e comprovacao de entrega.

O portal comercial e a acao antiga buy_kit permanecem bloqueados. O endpoint tecnico permite homologacao controlada sem apresentar uma compra produtiva antes das aprovacoes. Testes SQL em transacao com rollback e testes de adaptador/API nao equivalem a homologacao externa de kit pago.

A rotina agendada de expiracao recebe os bindings e o fetch nativo do Worker, limita cada lote a quatro pedidos TEST e isola falhas por pedido. So cancela uma tentativa conhecida depois de consultar e validar o provedor e conferir sua expiracao; uma aprovacao concorrente segue para conciliacao. Escrita desconhecida por mais de 23 horas vai para reconciliacao obrigatoria, preservando a reserva.

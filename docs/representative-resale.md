# Kits para revenda dos representantes

O portal usa diretamente os kits já cadastrados em `products`/`product_variants`, seus preços e `inventory`. O representante escolhe cor/tamanho e quantidade de kits; estoque disponível não é confundido com quantidade comprada. Não é necessário recadastrar SKU/quantidade nem preencher a oferta legada “Completo”. A revenda permanece separada de `orders` e do checkout B2C. A condição de representante não determina se a pessoa é contribuinte do ICMS.

Enquanto a revenda não estiver homologada:

- O portal mantém consulta de ofertas/histórico e informa que a compra está indisponível.
- `buy_kit` responde409/`RESALE_NOT_HOMOLOGATED`, sem criar pedido, pagamento ou reserva.
- O trigger `representative_resale_homologation_gate` bloqueia novas `kit_orders`, inclusive via RPC/Data API/service_role, e avanço de pagamento/expedição/entrega em pedidos antigos. Cancelamento e reembolso continuam possíveis. Não existe flag para contornar esse bloqueio.

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

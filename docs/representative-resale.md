# Kits para revenda dos representantes

Este fluxo usa `kits`/`kit_items` e `kit_orders`, separado de `orders` e do checkout B2C. A condição de representante não determina se a pessoa é contribuinte do ICMS.

Enquanto a revenda não estiver homologada:

- O portal mantém consulta de ofertas/histórico e informa que a compra está indisponível.
- `buy_kit` responde409/`RESALE_NOT_HOMOLOGATED`, sem criar pedido, pagamento ou reserva.
- O trigger `representative_resale_homologation_gate` bloqueia novas `kit_orders`, inclusive via RPC/Data API/service_role, e avanço de pagamento/expedição/entrega em pedidos antigos. Cancelamento e reembolso continuam possíveis. Não existe flag para contornar esse bloqueio.

## Conferência técnica sem efeitos comerciais

`POST /api/representatives/kits/preview`, com sessão válida e origem permitida:

```json
{"kitId":"UUID da oferta","icmsTaxpayer":false}
```

`icmsTaxpayer` é opcional para a conferência; ausente resulta em pendência explícita. Não é inferido de CNPJ ou papel. Finalidade sempre `resale`, `finalConsumer=false` e `canPurchase=false`. Cliente não fornece preço, estoque, composição, tributação ou `orderId`.

A RPC autentica o representante, perfil/status e nível permitido. Valores vêm do cadastro. Cada item deve apontar para um SKU comercial de kit com estoque próprio e metadados vigentes. Componentes fiscais de pares são lidos de `private.bling_kit_fiscal_components`; nunca baixam estoque de avulsos. Mapeamento vazio, metadados ausentes e composição desatualizada bloqueiam a conferência completa.

Para uma oferta com mais de um SKU comercial, `kit_items.resale_allocation_weight` deve conter pesos explicitamente aprovados para o rateio de seu preço. A migration não preenche valores. Para um único SKU, todo o valor pertence a esse SKU; quantidades repetidas são separadas em grupos de preço inteiro para conservar centavos. A decomposição fiscal reutiliza o rateador existente e conserva a soma das mercadorias.

Frete, total final e tributos ficam `null` até validação própria; a prévia não é cotação completa, autorização fiscal ou integração de pagamento. Nenhum job externo é enfileirado.

## Condições para futura homologação

Cadastrar os SKUs comerciais e quantidades reais da oferta; reutilizar composição fiscal vigente ou obter somente a composição que estiver ausente. Aprovar rateio entre SKUs apenas quando necessário. Validar a aplicação fiscal da operação de revenda e os dados reais do destinatário, sem copiar automaticamente a aprovação B2C. Homologar pagamento de `kit_orders`, reserva/baixa do SKU próprio, cancelamento/replay, NF-e e expedição no escopo separado antes de remover o bloqueio por outra revisão.

Teste atual comprova preparação técnica e bloqueios, não uma compra de revenda concluída. Não alterar flags compartilhadas para realizar essa conferência.

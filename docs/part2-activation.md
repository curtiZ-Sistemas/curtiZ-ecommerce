# Ativação de logística e pós-venda

O Worker da loja executa as filas persistentes. O painel solicita as mesmas ações pela fila, com autorização no servidor e auditoria. Uma resposta `202` confirma o enfileiramento; consulte o estado da remessa para verificar a conclusão.

## Etiquetas

- `MELHOR_ENVIO_LABEL_PURCHASE_ENABLED=true` permite processar compras pendentes.
- `MELHOR_ENVIO_LABEL_GENERATION_ENABLED=true` permite gerar etiquetas já pagas.
- Em produção, ambas também exigem `MELHOR_ENVIO_LIVE_LABEL_PURCHASE_AUTHORIZED=true`, após autorização específica. A ausência equivale a desligado.
- Nenhuma dessas flags deve ser ativada antes de homologar o fluxo. Trocar tokens não habilita compras.
- A NF-e precisa estar autorizada, o pedido pago e ativo e a cotação no mesmo ambiente. A origem física deve ser Nova Serrana/MG.
- Timeout após escrita ou perda do recibo exigem conciliação. Nunca recrie uma remessa para contornar resultado incerto. Sem ID externo recuperável, confira o carrinho no provedor antes de qualquer intervenção.
- Compra e geração só avançam após consulta ao provedor. Estados de transporte chegam por webhook assinado ou consulta autenticada; eventos antigos não reabrem entrega.

## E-mails

Somente confirmação de compra e pedido de avaliação permanecem aprovados. O fluxo antigo de e-mail de NF-e é cancelado mesmo se uma flag antiga estiver habilitada. XML/DANFE continuam disponíveis pelo acesso privado do pedido.

`EMAIL_ENABLED` permanece sujeito à homologação e autorização. Aceitação na API não equivale a entrega: o estado entregue depende da consulta ao Resend. O pedido de avaliação é agendado após entrega integral e revalida sua elegibilidade antes do envio.

## Pós-venda

Cancelamentos solicitados pelo cliente ou pela operação usam o mesmo serviço de verificação do pagamento e de reembolso, com chave persistente. A fila retoma respostas pendentes, limita tentativas e conserva casos não confirmados para intervenção. Antes de repetir qualquer reembolso, o serviço consulta o provedor.

Cancelamentos de etiquetas já postadas, trocas que exigem novo frete e cancelamentos/devoluções fiscais dependem das regras e prazos do provedor. O vínculo Bling gera uma pendência fiscal persistente; isso não significa nota cancelada nem nota de devolução autorizada. A emissão real continua dependendo de homologação e autorização específicas.

## Evidências necessárias antes de vender

1. Pagamento aprovado, recusado e reembolsado no ambiente de teste do Mercado Pago.
2. NF-e homologada com todos os campos contábeis obrigatórios e séries conferidas.
3. Etiqueta comprada/gerada no sandbox, rastreamento e cancelamento conciliados.
4. Os dois e-mails de teste com retorno do provedor, sem envio histórico ou comercial.
5. Restauração de uma cópia já armazenada em projeto isolado, incluindo Storage, RLS e configurações. O CI e a aplicação de migrations não comprovam recuperação de backup. Seguir [backup e recuperação](backup-and-recovery.md).

## Parâmetros fiscais explícitos

As regras privadas incluem `pis_rate`, `cofins_rate`, `ipi_rate` e `ipi_cenq`, além dos CSTs. A migration não preenche aprovações nem valores comerciais. Campo ausente bloqueia o espelho; uma alíquota zero informada expressamente é preservada. Mudanças nesses campos invalidam o hash da configuração e exigem nova conferência.

O gerador de fragmentos tributários aceita bases explícitas em centavos. Ele não deduz base zero de alíquota zero, não gera numeração e não produz uma NF-e completa ou autorizada. A base percentual da natureza e o valor monetário da base de cada item são conceitos diferentes. Confira rateios de frete, desconto e despesas no XML efetivo calculado pelo Bling antes da ativação.

O CST de IPI de saída não deve ser copiado automaticamente para uma devolução de entrada. O espelho de entrada permanece bloqueado quando esse tratamento não está definido, mesmo com a chave original; a conferência deve considerar a operação e o documento original. Isso não bloqueia os cenários de venda já configurados.

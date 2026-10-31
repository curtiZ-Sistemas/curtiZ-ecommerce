# Mercado Pago

Configure as variáveis `MERCADO_PAGO_*` e publique as quatro Edge Functions. A preferência carrega o pedido do banco; não aceita total do navegador. O webhook valida assinatura/timestamp, registra hash e idempotência, consulta o pagamento oficial e compara referência, moeda e valor.

A URL de sucesso nunca aprova pedido. Reembolsos exigem permissão e chave de idempotência.

No cancelamento antes do despacho, um reembolso parcial já confirmado é descontado do valor original. O banco reserva o saldo restante, devolve o valor em centavos e os IDs de estornos já concluídos; a loja confere esses dados com o pagamento consultado no provedor antes de solicitar o saldo, usando a mesma chave nas novas tentativas. Um parcial anterior de valor igual ao saldo não é confundido com o estorno do cancelamento. Divergência, resposta incompleta ou estorno não confirmado mantém a operação pendente, sem novo POST de reembolso.

Se o webhook confirmar o estorno antes da resposta de cancelamento, o registro financeiro confirmado é preservado e a reserva local fica encerrada com motivo `confirmed_by_provider_webhook`, sem uma segunda despesa. A confirmação dessa conciliação é idempotente e auditada. Estoque só é reposto pela conclusão do cancelamento elegível, uma vez; o parcial isolado não repõe produtos nem componentes de kit. Reembolso não equivale a devolução ou cancelamento fiscal.

Aplicar as migrations `20261021220000_cancel_remaining_refund.sql` e `20261021220001_cancel_refund_webhook_race.sql` antes de publicar o serviço que exige o contrato com saldo restante. Não ampliar permissões de cliente nem ativar pagamentos produtivos para validar a mudança. O teste `customer_cancellation_remaining_refund_test.sql` usa somente fixtures sintéticas e rollback em banco isolado.

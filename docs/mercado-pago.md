# Mercado Pago

Configure as variáveis `MERCADO_PAGO_*` e publique as quatro Edge Functions. A preferência carrega o pedido do banco; não aceita total do navegador. O webhook valida assinatura/timestamp, registra hash e idempotência, consulta o pagamento oficial e compara referência, moeda e valor.

A URL de sucesso nunca aprova pedido. Reembolsos exigem permissão e chave de idempotência.

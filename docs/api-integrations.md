# Integrações

Contratos: `PaymentProvider`, `ShippingProvider`, `EmailProvider`, `MarketingProvider`, `WhatsAppProvider` e `ERPProvider`.

Mocks lançam erro em produção. Providers sem credencial ficam `not_configured` ou `awaiting_credentials`. Retries usam fila, backoff, idempotência e erro sanitizado.

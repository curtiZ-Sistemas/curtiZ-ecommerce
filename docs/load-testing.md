# Testes de carga

Instale k6 e use `performance/browse.js` e `performance/checkout.js` somente em local/staging. Comece com 100 usuários e avance para 1.000, 5.000 e 20.000 após revisar erros, p95/p99, banco e conexões.

O cenário de 100.000 acessos é configurável e nunca deve rodar automaticamente ou contra produção.

Para coleta em lote, recomendações e descoberta, use `performance/intelligence.js`. O cenário inclui limiares de erro e p95, aceita throttling explícito e recusa produção por padrão. Detalhes em `docs/intelligence-engine.md`.

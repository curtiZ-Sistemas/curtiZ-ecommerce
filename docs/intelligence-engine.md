# curti Z Intelligence Engine

## Arquitetura

O motor usa o Supabase como fonte de verdade e mantém a lógica crítica no servidor. O navegador registra apenas eventos consentidos em uma fila pequena (até 20 eventos ou 8 segundos), envia um lote por requisição e usa `sendBeacon` ao ocultar a página. Eventos duplicados são ignorados por `client_event_id`; impressões repetidas têm uma janela de 30 segundos.

O RPC de ingestão valida a taxonomia, limita 120 eventos por sessão/minuto em um bucket atômico e associa `auth.uid()` internamente. O cliente não informa identidade e não pode registrar `purchase`. Unidades e receita são derivadas somente da transição de pedidos reais para pagamento aprovado, com reversão em cancelamento, devolução ou reembolso.

Os dados ficam em cinco estruturas reutilizáveis:

- `marketing_events`: sinal bruto de curta retenção;
- `product_metrics_daily`: agregado diário de intenção e venda;
- `search_metrics_daily`: buscas, ausência de resultado e clique;
- `recommendation_metrics_daily`: impressões, cliques e CTR por origem;
- `session_interest_profiles`: vetor compacto por categoria, faixa de preço e produtos recentes.

O perfil aplica meia-vida de sete dias. O ranking combina recência, views, interações com imagem/variante, favoritos, carrinho, cliques em recomendações e vendas válidas. Produtos inativos, sem imagem ou sem estoque são removidos antes do ranking. A ordenação usa semente estável e limita concentração por categoria.

## Privacidade e retenção

A coleta só começa quando a categoria `analytics` está autorizada em `curtiz-cookie-consent` e no cookie HttpOnly correspondente. Revogar opcionais interrompe novos eventos, apaga a fila local e solicita a exclusão dos eventos/perfil daquela sessão; nenhum identificador do motor é criado antes do consentimento. Payloads não aceitam e-mail, telefone, endereço, documento ou texto livre além da busca limitada a 120 caracteres.

`purge_intelligence_data` remove eventos brutos conforme `intelligence_event_retention_days` (30 dias por padrão), perfis expirados e buckets antigos em lotes. Agregados não contêm identidade. Tabelas têm RLS forçada e não admitem leitura ou escrita direta de `anon`/`authenticated`.

## Cache, falhas e rollout

Recomendações genéricas via GET têm cache Edge de 120 segundos e stale-while-revalidate de 10 minutos. Respostas personalizadas são privadas e sem cache compartilhado. A vitrine não bloqueia a renderização inicial: mostra skeleton, permite retry e desaparece quando não há itens elegíveis. A descoberta usa `IntersectionObserver`, lista de vistos limitada a 50 e nunca usa `OFFSET` grande.

As flags `intelligence.tracking`, `intelligence.recommendations`, `intelligence.discovery` e `intelligence.insights` podem ser desligadas pelo Painel Técnico. O construtor da home configura o algoritmo na seção existente “Produtos recomendados”: para você, em alta, mais desejados, mais vistos, descoberta, novidades, vistos recentemente, porque você viu e faixa de preço.

## Operação

Agende `select public.purge_intelligence_data(5000);` diariamente com uma identidade técnica autorizada. Monitore tamanho de `marketing_events`, p95/p99 dos dois endpoints, taxa 429, erros dos RPCs, hit ratio do cache genérico e crescimento dos agregados.

Testes locais/estaging:

```powershell
pnpm --filter @curtiz/store test
pnpm test:db:static
pnpm tsx scripts/benchmark-intelligence.ts
k6 run -e BASE_URL=http://localhost:3000 -e VUS=10 -e DURATION=30s performance/intelligence.js
```

O teste recusa domínios de produção sem `ALLOW_PRODUCTION=true`. Faça degraus de 10, 100 e 1.000 VUs e só avance após revisar erros e percentis. O alvo de 100 mil acessos é uma projeção de capacidade, não uma validação local: exige staging equivalente, observabilidade e aumento gradual.

### Baseline local de 21/08/2026

Build de produção em `DEMO_MODE`, notebook local, 200 requisições e concorrência 10:

| Fluxo                        | req/s |     p50 |     p95 |      p99 | sucesso |
| ---------------------------- | ----: | ------: | ------: | -------: | ------: |
| Catálogo anterior (baseline) | 446,1 | 10,0 ms | 75,7 ms | 101,4 ms | 200/200 |
| Recomendações                | 433,2 | 14,3 ms | 33,5 ms |  36,4 ms | 200/200 |
| Ingestão em lotes            | 578,3 | 11,8 ms | 20,6 ms |  23,0 ms | 200/200 |

Esses números verificam o overhead HTTP e a renderização do build, não a capacidade do Supabase em produção. O teste de banco e o patamar de 100 mil acessos permanecem obrigatoriamente para staging equivalente.

# Testes de carga

Os cenários k6 ficam em `performance/` e cobrem navegação, rejeição segura de checkout inválido e o
motor de inteligência. Eles não são executados automaticamente e recusam qualquer host que não seja
localhost ou um endereço identificável de staging.

Não instale k6, Docker ou WSL no notebook de desenvolvimento apenas para esta validação. Execute em
um runner Linux controlado ou em outra máquina com k6, sempre contra staging:

```bash
k6 run -e BASE_URL=https://curtiz-ecommerce-staging.example.workers.dev \
  -e TARGET_ENV=staging -e ALLOW_STAGING=true -e VUS=100 -e DURATION=2m performance/browse.js
```

Comece com 100 usuários virtuais. Só avance para 1.000, 5.000 e 20.000 após revisar taxa de erro,
p95/p99, uso do Worker, conexões e banco. O cenário de 100.000 acessos é apenas um teto planejado e
nunca deve ser disparado automaticamente.

Comandos equivalentes podem usar `performance/checkout.js` ou `performance/intelligence.js`. Não use
credenciais reais no script e não execute carga contra produção.

# Product import image worker

Consumidor isolado das imagens da importação XLSX. O painel publica somente `jobId`, `runId` e `productId`; download, validação, Cloudflare Images e Storage acontecem aqui, uma imagem por mensagem.

## Provisionamento Cloudflare

```powershell
pnpm exec wrangler queues create curtiz-product-images
pnpm exec wrangler queues create curtiz-product-images-dlq
pnpm exec wrangler queues create curtiz-product-images-staging
pnpm exec wrangler queues create curtiz-product-images-staging-dlq
pnpm --filter @curtiz/product-import-worker exec wrangler secret put SUPABASE_URL --env production
pnpm --filter @curtiz/product-import-worker exec wrangler secret put SUPABASE_SECRET_KEY --env production
pnpm --filter @curtiz/product-import-worker exec wrangler secret put SUPABASE_URL --env staging
pnpm --filter @curtiz/product-import-worker exec wrangler secret put SUPABASE_SECRET_KEY --env staging
```

Depois de aplicar as migrations, publique primeiro o consumidor e depois o painel. Nunca configure `SUPABASE_SECRET_KEY` no painel ou em variável `NEXT_PUBLIC_*`.

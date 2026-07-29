# Arquitetura

```mermaid
flowchart LR
  Browser --> CF[Cloudflare]
  CF --> Store[Next.js Store]
  CF --> Panel[Next.js Panel]
  Store --> SB[Supabase]
  Panel --> SB
  SB --> PG[(PostgreSQL + RLS)]
  SB --> Auth[Auth/MFA]
  SB --> Storage[Storage]
  SB --> Edge[Edge Functions]
  Edge --> MP[Mercado Pago]
  Edge --> Providers[Frete / E-mail / WhatsApp / ERP]
  Edge --> Queue[Filas e jobs]
```

Loja e painel possuem bundles separados. Server Components entregam conteúdo público cacheável; páginas autenticadas são privadas e `no-store`. O domínio usa centavos, UTC e contratos independentes de provider.

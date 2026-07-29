# Supabase local

Instale Docker Desktop, copie `.env.example`, execute `pnpm supabase:start`, `pnpm supabase:reset` e `pnpm supabase:types`. O stack local é apenas para desenvolvimento e não deve ser publicado.

Para staging, use um projeto separado, `supabase link`, `supabase db push --dry-run` e revisão antes de aplicar.

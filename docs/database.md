# Banco e migrations

As migrations criam identidade/RBAC, catálogo, estoque transacional, pedidos, pagamentos, logística, suporte Realtime, pós-venda, financeiro, CMS, marketing, antifraude, filas e auditoria.

Mudanças futuras devem ser incrementais. Não edite migrations já aplicadas. Use `supabase db reset` local e `supabase db push --dry-run` antes de staging. Produção nunca recebe seed.

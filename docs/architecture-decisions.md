# Decisões de arquitetura

## ADR-001 — autenticação demo sem Docker

**Estado:** aceito.

**Contexto:** a autenticação real usa Supabase Auth, mas a estação local não possui Docker nem
credenciais de um projeto gerenciado. A API retornava 503 para todas as contas de teste.

**Decisão:** manter Supabase como primeira opção e habilitar um adaptador demo somente quando:

- `DEMO_MODE=true`;
- a requisição chega por loopback;
- senha e segredo de sessão estão configurados;
- o e-mail pertence à lista fixa de contas demo.

A sessão demo é assinada com HMAC, expira, usa cookie HTTP-only, `SameSite=Lax` e `Secure` quando
HTTPS. Produção continua falhando na validação se `DEMO_MODE=true`.

**Consequências:** as jornadas dos cinco perfis podem ser demonstradas sem banco local. Cadastro,
persistência real, recuperação, RLS e operações sensíveis continuam indisponíveis até conectar o
Supabase; o fallback não finge esses recursos.

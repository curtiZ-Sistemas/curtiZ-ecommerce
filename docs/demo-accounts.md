# Contas demo

E-mails locais:

- cliente.demo@curtiz.local
- operacional.demo@curtiz.local
- admin.demo@curtiz.local
- gerencia.demo@curtiz.local
- tecnico.demo@curtiz.local

Após executar `pnpm seed:demo`, todas usam a senha `1234567890`, definida em `.env.local` pela
variável `DEMO_USERS_PASSWORD`. O seed cria ou atualiza as contas no Supabase local e nunca
registra a senha no console. O seed e o bypass local de MFA são bloqueados em produção.

Sem Supabase, a loja também oferece autenticação demo exclusivamente em `localhost`, quando
`DEMO_MODE=true`, `DEMO_USERS_PASSWORD` e `DEMO_SESSION_SECRET` estão configurados. Esse fallback
cria uma sessão HTTP-only assinada, funciona nos dois projetos Next.js e não é habilitado em
endereços públicos.

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

# MFA interno e histórico de acessos

As migrations `202609070001_internal_mfa.sql` e
`202609070002_latest_user_access_history.sql` devem ser validadas em banco
isolado antes da aplicação pelo responsável. Não foram aplicadas em produção.

A configuração do PostgreSQL é independente do Next.js. A migration mantém
MFA desabilitado inicialmente, preservando a configuração anterior. Para exigir
MFA, o responsável deve habilitar **ambos**:

- `REQUIRE_INTERNAL_MFA=true` no runtime do painel (protege páginas e APIs).
- Como proprietário do banco:

```sql
update private.internal_security_settings
set require_internal_mfa = true where singleton;
```

Habilite o banco antes de considerar a proteção ativa; a variável de ambiente
sozinha não protege chamadas diretas ao Supabase. Para desabilitar, mantenha
as duas configurações em `false`. A tabela privada não pode ser alterada pelas
roles da API. Ausência da linha de configuração exige MFA por segurança.

Com a exigência ativa, usuários com papéis internos precisam de JWT `aal2`
para permissões internas, inclusive overrides. Os papéis, as permissões e o
status ativo continuam sendo verificados. Clientes e representantes sem papel
interno mantêm suas permissões; políticas de propriedade não foram alteradas.

O histórico usa uma consulta indexada com limite de um evento por usuário,
para até 20 usuários por página, mantendo RLS e exigindo `users.read` e
`audit.read`. Falha da RPC aparece como “Histórico indisponível”, inclusive se
a migration ainda não tiver sido aplicada.

O banner mobile existente tem proporção 941 × 1672 e texto até a base.
Uma redução expressiva da altura sem diminuir a legibilidade depende de nova
arte comercial aprovada. A implementação preserva a imagem inteira e reduz
o espaço ao redor.

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

## Onboarding e recuperação antes de habilitar

1. Cadastre e verifique um fator TOTP para pelo menos dois administradores de contingência.
2. Confirme login, desafio AAL2, logout e nova autenticação para cada papel interno. Cliente e
   representante sem papel interno não devem ser enviados ao desafio.
3. Teste perda do autenticador em conta não crítica: um administrador autorizado remove o fator no
   Supabase Auth após verificar a identidade; o usuário cadastra e verifica um novo fator antes de
   recuperar acesso interno. Não existe código de recuperação local no projeto.
4. Confirme que páginas e APIs do painel recusam AAL1 e que chamadas diretas ao banco continuam
   recusadas pelas policies/funções quando a configuração privada exige MFA.
5. Registre responsáveis e canal de escalonamento. Só depois habilite primeiro o banco e então
   `REQUIRE_INTERNAL_MFA=true` nos dois Workers.

Essa preparação é manual. Enquanto não houver evidência de dois fatores de contingência e teste de
recuperação por papel, mantenha as duas configurações desativadas; ativar apenas a flag pode bloquear
todos os administradores e não conclui a proteção do banco.

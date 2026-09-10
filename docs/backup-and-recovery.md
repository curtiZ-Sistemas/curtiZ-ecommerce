# Backup e recuperação

`BACKUP_PROVIDER` apenas declara um provedor. Não comprova cópia, integridade ou restauração; o painel informa essa limitação.

## Começar sem servidor próprio

1. Mantenha código e migrations no Git e uma cópia independente do repositório. Git não guarda pedidos, clientes ou imagens do banco.
2. Exporte roles, schema e dados pelo procedimento oficial abaixo. Use um computador confiável com Supabase CLI e seus requisitos locais. Confira o projeto vinculado antes de executar comandos.
3. Copie também os arquivos de todos os buckets de Storage, inclusive privados, preservando bucket e caminho. Backup do banco contém metadados, não esses arquivos. Para acervo pequeno, baixe pelo Dashboard e confira a contagem por bucket. Marque cópias incompletas como parciais.
4. Registre data UTC, projeto, revisão do código, arquivos, contagem de objetos e responsável, sem credenciais.
5. Use desde o início uma pasta em volume criptografado e mantenha segunda cópia independente. Guarde a chave de recuperação em cofre separado. Não envie dumps ao Git, chats ou logs.
6. Faça cópia diária enquanto houver alterações comerciais e antes de migrations. Comece com 7 cópias diárias e 4 semanais, ajustando às necessidades de recuperação e minimização de dados pessoais.

A exportação pela CLI requer Docker, ausente neste notebook. Use outro computador preparado ou o download de backup do Dashboard, quando disponível no plano. Exportação CSV de tabelas não substitui backup completo. Após vincular e conferir o projeto na CLI, crie a pasta `backups` e execute separadamente:

```sh
pnpm exec supabase db dump --linked --role-only -f backups/roles.sql
pnpm exec supabase db dump --linked -f backups/schema.sql
pnpm exec supabase db dump --linked --data-only --use-copy -f backups/data.sql
```

Confira cada código de saída. Arquivos vazios ou interrompidos não são backup. A pasta `backups` é ignorada pelo Git, mas isso não criptografa arquivos nem protege arquivos já rastreados. Não execute esses comandos se faltar requisito local: não considere a exportação concluída.

Esses comandos não exportam objetos do Storage nem toda configuração de Auth, OAuth, SMTP, Workers ou integrações. Mantenha inventário das configurações sem segredos; valores secretos e chaves ficam no cofre.

Preserve também o histórico em `supabase_migrations` e alterações específicas em `auth`/`storage`, seguindo as considerações especiais do guia oficial. Se usar Vault ou criptografia de colunas, siga o procedimento de preservação da chave antes de considerar a recuperação viável.

## Verificar e restaurar

No PowerShell, gere hashes para registrar integridade dos arquivos:

```powershell
Get-ChildItem -LiteralPath ./backups -File | Get-FileHash -Algorithm SHA256
```

Guarde os hashes junto ao registro protegido. Hash comprova os bytes, não completude ou capacidade de restauração.

Mensalmente e depois de mudanças importantes, restaure em projeto isolado seguindo o guia oficial. Nunca sobrescreva produção para testar. Desative e-mails, webhooks e integrações comerciais antes do teste.

Confira usuários, RLS, permissões, catálogo, variantes, pedidos, itens, estoque, reservas e arquivos públicos/privados. Registre duração, data da cópia e resultado. Cópia diária pode perder até um dia de alterações; avalie PITR se isso for inaceitável.

## Quando houver infraestrutura

Automatize exportação, cópia de Storage, criptografia, retenção, alertas e testes de restauração. O painel só deve indicar backup verificado com evidências reais: última cópia, cobertura, integridade e último teste de restauração. Não há automação nem restauração remota implementada nesta etapa.

Referências: [Supabase Backups](https://supabase.com/docs/guides/platform/backups) e [exportação e restauração](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

# Backup e recuperação

`BACKUP_PROVIDER` apenas declara um provedor. Não comprova cópia, integridade ou restauração; o painel informa essa limitação.

## Operação e entrega sem dependência do notebook

Backups, acesso de recuperação e execução operacional devem permanecer em contas da empresa na nuvem. O notebook do desenvolvimento não é destino de backup, cofre nem executor permanente. O procedimento nativo abaixo também pode rodar em ambiente remoto confiável; os exemplos locais são referência, não autorização para armazenar dados no computador do desenvolvedor.

- Use uma pasta/bucket privado da empresa e um cofre de recuperação separado, com acesso conferido pelos responsáveis. Não use a conta pessoal do desenvolvedor como único proprietário. O responsável precisa conseguir recuperar a chave, não apenas saber que ela foi cadastrada como um Secret que a interface não permite reler.
- Execute a exportação e a restauração em ambiente remoto temporário controlado. Se usar GitHub Actions, utilize somente runner padrão dentro da modalidade gratuita conferida, execução manual de revisão confiável, permissões mínimas e Secrets protegidos. Nunca execute esse fluxo com código de PR não confiável. Não publique dumps, arquivos do Storage, TOCs, credenciais ou chaves em logs, caches ou artifacts públicos, mesmo durante falhas.
- Criptografe os arquivos antes de enviá-los ao destino. Área temporária remota deve ter proteção apropriada e limpeza em sucesso/falha; nenhum dado de backup ou credencial precisa passar pelo disco deste notebook. Guarde evidências de integridade e recuperação em destino privado da empresa.
- Custo adicional zero é requisito: confira modalidade, franquia disponível e comportamento ao atingir limites antes de contratar ou ativar serviço. No R2, franquia gratuita não equivale a bloqueio de excedentes; alertas apenas notificam. Não ative assinatura por uso presumindo que o valor inicial de US$ 0 impede cobranças futuras. [Preços R2](https://developers.cloudflare.com/r2/pricing/), [alertas de orçamento](https://developers.cloudflare.com/billing/manage/budget-alerts/) e [custos de Actions](https://docs.github.com/en/billing/concepts/product-billing/github-actions).
- A entrega exige teste de recuperação pelos responsáveis: localizar cópia e manifesto, obter a chave pelo cofre, executar a restauração isolada e ler o relatório. Acesso a arquivos na nuvem não substitui esse teste. Mantenha cópia independente da origem; limite de espaço ou indisponibilidade deve gerar falha explícita, sem aprovar backup parcial nem remover a última cópia verificada.

Destino, cofre e credenciais do executor remoto precisam de configuração e comprovação. Estas orientações não constituem backup realizado.

### Verificação inicial do executor na nuvem

O workflow manual `Recovery prerequisites` (`.github/workflows/recovery.yml`) verifica o acesso antes de permitir qualquer exportação. A execução remota só aceita `main`, runner padrão temporário do GitHub e o ambiente protegido `backup-recovery`. PRs executam somente os testes sintéticos, sem Secrets. Não há agendamento nem publicação dos aplicativos neste workflow.

Configure no ambiente as variáveis `BACKUP_SOURCE_PROJECT_REF`, `BACKUP_RESTORE_PROJECT_REF`, `BACKUP_GOOGLE_OWNER`, `BACKUP_GOOGLE_CLIENT_ID` e `BACKUP_DRIVE_FOLDER_ID`; configure como Secrets `BACKUP_GOOGLE_CLIENT_SECRET`, `BACKUP_GOOGLE_REFRESH_TOKEN`, `BACKUP_SUPABASE_ACCESS_TOKEN` e `BACKUP_RECOVERY_PASSPHRASE`. A senha de recuperação precisa estar também no cofre da empresa e ter no mínimo 24 caracteres. Identificadores privados do destino não pertencem ao código público.

O OAuth usa somente `drive.file`, para arquivos criados pelo aplicativo, e a conta precisa ser a proprietária empresarial esperada. O PAT Supabase deve ser restrito aos dois projetos, com prazo de validade e permissões mínimas: Database read-write para emitir o login temporário; Connection Pooling read; configurações e chaves necessárias ao backup apenas read. Não conceda faturamento, administração da organização ou permissão para redefinir a senha do banco. Na verificação inicial, os dois logins temporários são emitidos com `read_only=true` e todas as sessões nativas forçam leitura.

O executor instala somente clientes PostgreSQL 17 do repositório oficial assinado. Confere TLS com validação de hostname, projeto isolado vazio, propriedade/permissões/cota do Drive e envia um pequeno manifesto **sem dados de clientes**, criptografado com GPG/AES-256. Baixa o mesmo arquivo, confere SHA-256 e descriptografa para comparação integral. A senha temporária fica somente em tmpfs privado no runner e é removida ao terminar.

A CA pública `ops/recovery/supabase-ca.crt` foi obtida pelo botão “Download certificate” do Dashboard oficial do banco. Não é o certificado A1 fiscal da empresa e não contém chave privada. Fingerprint SHA-256: `807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa`. O pooler exige essa CA para validação completa; não substitua `verify-full` por modos sem autenticação do servidor. O login temporário `cli_login_supabase_read_only_user` é `NOINHERIT`: o cliente assume explicitamente `supabase_read_only_user` e confirma `current_user` e transação somente de leitura. Referências: [TLS Supabase](https://supabase.com/docs/guides/platform/ssl-enforcement) e [conexões psql](https://supabase.com/docs/guides/database/psql).

**Preflight aprovado não é backup nem restauração.** Não exporta schemas/dados/roles/Storage, não altera o banco original e não libera migrations, PRs de negócio ou ativação comercial. A cópia completa e o teste de recuperação abaixo continuam obrigatórios. A renovação do PAT e a manutenção do consentimento OAuth devem constar da entrega aos responsáveis.

### Exportação completa pelo executor

Depois de confirmar a guarda da senha no cofre online da empresa, registre `BACKUP_CLOUD_VAULT_CONFIRMED=true` no ambiente protegido. Selecione `backup` no workflow manual; `preflight` continua sendo o padrão. A exportação roda exclusivamente em runner temporário, em tmpfs privado, sem artifacts, cache, dump ou credencial neste notebook.

`ops/recovery/backup.py` mantém um snapshot PostgreSQL de leitura aberto para `pg_dump`: produz um archive integral e archives auxiliares de aplicação, Auth e metadados Storage com o mesmo snapshot. Inclui `private`, `supabase_migrations`, RLS/grants, inventários, fingerprints de linhas, extensões e customizações gerenciadas. Exporta roles com `pg_dumpall --no-role-passwords`; credenciais de roles próprias exigiriam cofre separado. Não existem roles próprias na conferência inicial, mas o inventário é refeito por execução.

Todos os objetos públicos e privados do Storage são baixados pelo backend autorizado, preservando bucket/caminho no manifesto privado, com tamanho e SHA-256 dos bytes. Os nomes remotos não viram caminhos locais: os blobs usam nomes derivados de hash. A coleta compara novamente os metadados e as definições de roles ao terminar; mudança durante a exportação impede aprovação. Configurações de Auth, PostgreSQL, Data API, Storage e Realtime ficam dentro do bundle criptografado, nunca nos logs. Secrets que os provedores não permitem recuperar continuam exigindo guarda própria no cofre e inventário de dependências; não considere valores mascarados uma cópia recuperável.

O bundle recebe GPG/AES-256 antes de ser enviado por upload retomável ao Drive privado. O executor baixa a cópia armazenada, compara o hash do ciphertext, descriptografa e verifica os hashes e a cobertura de cada membro. Um recibo de integridade fica na mesma pasta privada, sem conteúdo de clientes, caminhos originais de objetos ou valores de configuração. Cópias anteriores não são sobrescritas ou removidas. Sem espaço ou com resposta inconclusiva, a operação falha e não libera migrations.

O resultado dessa operação é **cópia armazenada com leitura e integridade verificadas, restauração ainda não comprovada**. O PR de negócio permanece bloqueado até restauração isolada, verificações funcionais e de autorização. Os testes nativos de snapshot/archives usam PostgreSQL sintético exclusivamente no CI, sem acesso a projetos reais; o executor de backup usa os clientes nativos e não depende de Docker.

## Começar sem servidor próprio

1. Mantenha código e migrations no Git e uma cópia independente do repositório. Git não guarda pedidos, clientes ou imagens do banco.
2. Exporte roles, schema e dados pelo procedimento oficial abaixo. Use um computador confiável com Supabase CLI e seus requisitos locais. Confira o projeto vinculado antes de executar comandos.
3. Copie também os arquivos de todos os buckets de Storage, inclusive privados, preservando bucket e caminho. Backup do banco contém metadados, não esses arquivos. Para acervo pequeno, baixe pelo Dashboard e confira a contagem por bucket. Marque cópias incompletas como parciais.
4. Registre data UTC, projeto, revisão do código, arquivos, contagem de objetos e responsável, sem credenciais.
5. Use desde o início uma pasta em volume criptografado e mantenha segunda cópia independente. Guarde a chave de recuperação em cofre separado. Não envie dumps ao Git, chats ou logs.
6. Faça cópia diária enquanto houver alterações comerciais e antes de migrations. Comece com 7 cópias diárias e 4 semanais, ajustando às necessidades de recuperação e minimização de dados pessoais.

A exportação pela CLI requer Docker. Quando ele não estiver disponível, use os clientes PostgreSQL nativos conforme a seção abaixo, outro computador preparado ou o download de backup do Dashboard, quando disponível no plano. Exportação CSV de tabelas não substitui backup completo. Após vincular e conferir o projeto na CLI, crie a pasta `backups` e execute separadamente:

```sh
pnpm exec supabase db dump --linked --role-only -f backups/roles.sql
pnpm exec supabase db dump --linked -f backups/schema.sql
pnpm exec supabase db dump --linked --data-only --use-copy -f backups/data.sql
```

Confira cada código de saída. Arquivos vazios ou interrompidos não são backup. A pasta `backups` é ignorada pelo Git, mas isso não criptografa arquivos nem protege arquivos já rastreados. Não execute esses comandos se faltar requisito local: não considere a exportação concluída.

Esses comandos não exportam objetos do Storage nem toda configuração de Auth, OAuth, SMTP, Workers ou integrações. Mantenha inventário das configurações sem segredos; valores secretos e chaves ficam no cofre.

Preserve também o histórico em `supabase_migrations` e alterações específicas em `auth`/`storage`, seguindo as considerações especiais do guia oficial. Se usar Vault ou criptografia de colunas, siga o procedimento de preservação da chave antes de considerar a recuperação viável.

## Alternativa nativa sem Docker

Use `pg_dump`, `pg_dumpall`, `pg_restore` e `psql` de uma distribuição indicada pelo [PostgreSQL](https://www.postgresql.org/download/windows/). Para servidores PostgreSQL 17, use clientes 17 atualizados. Extraia somente clientes e bibliotecas necessárias; não é preciso iniciar um servidor local, instalar pgAdmin ou modificar o PATH global. Confira `--version` e `--help` dos executáveis antes de usá-los.

Antes de exportar, prepare fora do repositório:

- acesso PostgreSQL à origem e ao destino isolado, por conexão direta ou pooler de **sessão**, não de transação;
- serviços libpq `curtiz_backup_source` e `curtiz_restore_isolated`, com host, porta, usuário, banco, `sslmode=verify-full` e a CA confiável apropriada; as senhas são inseridas pelo responsável em prompt privado ou arquivo de senhas com acesso restrito, sem aparecer em argumentos, histórico ou logs;
- um diretório em volume criptografado já autorizado, uma segunda cópia privada independente e a chave de recuperação em cofre separado;
- acesso autorizado aos objetos privados do Storage e às configurações necessárias à recuperação. O MCP de consultas SQL não fornece, por si só, uma conexão libpq nem o conteúdo dos arquivos.

Não redefina senhas existentes para contornar a falta de acesso. Um arquivo em `.cache`, um ZIP comum e um hash SHA-256 não são criptografia. Se faltar conexão segura, destino ou chave recuperável, pare antes da exportação; não produza um dump desprotegido para criptografar depois.

Os comandos seguintes são um roteiro para uma máquina já preparada. `BACKUP_SECURE_DIR` precisa apontar para o volume criptografado autorizado, nunca para o checkout. Não os execute antes de conferir os dois serviços e a identidade dos projetos. Eles não realizam nem comprovam a configuração de criptografia.

```powershell
# Executar no diretório dos clientes, sem senha na linha de comando.
if (-not $env:BACKUP_SECURE_DIR -or
    -not (Test-Path -LiteralPath $env:BACKUP_SECURE_DIR -PathType Container)) {
  throw 'Defina e confira o destino privado criptografado antes de exportar.'
}
$archivePath = Join-Path $env:BACKUP_SECURE_DIR 'database.dump'
$rolesPath = Join-Path $env:BACKUP_SECURE_DIR 'roles.sql'
if ((Test-Path -LiteralPath $archivePath) -or (Test-Path -LiteralPath $rolesPath)) {
  throw 'Use um diretório novo por execução; não sobrescreva uma cópia existente.'
}
& .\pg_dump.exe --dbname=service=curtiz_backup_source --format=custom `
  --lock-wait-timeout=30s --file=$archivePath
if ($LASTEXITCODE -ne 0) { throw 'Exportação incompleta; não aprovar o backup.' }
& .\pg_dumpall.exe --dbname=service=curtiz_backup_source --roles-only `
  --no-role-passwords --file=$rolesPath
if ($LASTEXITCODE -ne 0) { throw 'Exportação de roles incompleta.' }
& .\pg_restore.exe --list --file=(Join-Path $env:BACKUP_SECURE_DIR 'archive.toc') $archivePath
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível ler o arquivo de backup.' }
```

O formato custom preserva schema, dados, sequences, funções, triggers, políticas e grants em um arquivo com snapshot consistente do banco. Não restrinja a cópia a `public`: confira também schemas privados, `auth`, `storage` e `supabase_migrations`, além dos objetos e configurações de extensões relevantes. Falta de permissão não autoriza ignorar tabelas nem desligar RLS. `pg_dumpall --no-role-passwords` preserva definições e associações de roles sem hashes de senhas; senhas de roles próprias precisam de recuperação separada no cofre. Evite mudanças de DDL, roles e configuração durante a coleta e registre a janela de cada exportação.

**A restauração em Supabase exige revisão específica.** Um dump nativo contém objetos internos que já existem no projeto de destino. Não execute `pg_restore` integralmente contra esse projeto, não remova schemas gerenciados e não ignore erros indiscriminadamente. Revise privadamente o TOC e o SQL, separe roles próprias das reservadas, compare versões de extensões/Auth/Storage e prepare uma lista de restauração compatível. Preserve customizações, ownership e grants necessários, sem substituir identidades gerenciadas pela plataforma. Arquive também as exclusões e a justificativa de cada uma. A presença no TOC comprova apenas o inventário do arquivo, não sua restauração.

Antes de importar dados, confirme o projeto isolado por identidade e mantenha suas filas, crons, webhooks, e-mails e integrações externas sem execução. O destino não deve receber tráfego da loja. Importe somente a seleção revisada com `pg_restore --exit-on-error --single-transaction`, usando `service=curtiz_restore_isolated`. O guia Supabase orienta `session_replication_role=replica` durante a importação de dados para evitar triggers e dupla criptografia; isso deve ficar restrito à sessão de restauração no destino e requer permissão apropriada. Verifique depois constraints, sequences, triggers, RLS, permissões e contagens; não execute testes com fixtures no banco original.

Quando houver Vault ou criptografia de colunas, avalie a preservação da chave raiz pelo procedimento oficial, exclusivamente entre ambiente confiável e cofre. Não consulte chaves em saída de ferramentas, logs ou chats. Um projeto novo tem outra chave; copiar ciphertext não comprova que os dados serão recuperáveis. Não sobrescreva a chave de um destino que já contém dados úteis.

Copie separadamente os bytes de **todos** os objetos do Storage, inclusive privados, preservando bucket/caminho e as restrições de acesso. Guarde manifesto privado por objeto com tamanho e SHA-256; compare metadados antes/depois para detectar alterações durante a coleta e estabeleça uma janela sem alterações quando necessário. Metadados SQL não substituem os arquivos. Restaure os objetos pela API de Storage no projeto isolado, conforme o procedimento do provedor, e compare os hashes dos bytes baixados do destino. URLs de acesso temporário e chaves não pertencem ao manifesto.

Inclua inventário protegido das extensões, publications, histórico de migrations, configurações de Auth/OAuth/SMTP, Storage, Workers, DNS e integrações. Valores secretos e chaves de criptografia da aplicação exigem recuperação pelo cofre; não devem ser impressos no inventário. Mantenha ações externas desativadas durante os testes.

Só aprove a cópia depois de reler a segunda cópia armazenada, conferir hashes e restaurar banco e objetos com verificações funcionais e de autorização. Migrations pendentes são testadas sobre a restauração e aplicadas à origem somente depois dessa aprovação. A leitura do TOC, o sucesso do CI ou a disponibilidade do projeto isolado não liberam essa etapa.

Referências: [pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html), [pg_dumpall](https://www.postgresql.org/docs/17/app-pg-dumpall.html), [pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html), [serviços libpq](https://www.postgresql.org/docs/17/libpq-pgservice.html), [TLS libpq](https://www.postgresql.org/docs/17/libpq-ssl.html) e [particularidades do Supabase](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

### Acesso nativo dedicado quando o login temporário falha

O workflow manual `Recovery prerequisites`, restrito a `main` e ao ambiente
`backup-recovery`, oferece `provision-readers`. Essa operação cria somente a role
técnica `curtiz_backup_reader` nos dois projetos autorizados: `BYPASSRLS`, associação
`pg_read_all_data` e leitura por padrão, sem superusuário, criação de roles/bancos
ou replicação. Não altera RLS das tabelas, dados comerciais nem senhas existentes.
Um nome já utilizado sem o marcador esperado causa bloqueio; repetir a operação
valida a role existente sem trocar sua senha.

A senha de cada projeto deriva da chave de recuperação empresarial por
HMAC-SHA256, com domínio e referência do projeto distintos. Somente seu verificador
SCRAM salgado segue pela API administrativa; senha, verificador e SQL nunca entram
nos logs. A chave raiz permanece no cofre e no Secret protegido. Trocar essa chave
exige planejamento de recuperação e rotação dos leitores; não a substitua como
tentativa de corrigir conexão. Após a verificação nativa dos dois leitores, defina
`BACKUP_NATIVE_AUTH_MODE=dedicated` nas variáveis do ambiente protegido. TLS continua
com `verify-full`, CA pública e sessões somente de leitura.

Referência: [procedimento oficial para leitor de backup e RLS](https://supabase.com/docs/guides/troubleshooting/pg_dump-fails-with-query-would-be-affected-by-row-level-security-policy-1d5783).

## Verificar e restaurar

No PowerShell, gere hashes para registrar integridade dos arquivos:

```powershell
Get-ChildItem -LiteralPath ./backups -File | Get-FileHash -Algorithm SHA256
```

Guarde os hashes junto ao registro protegido. Hash comprova os bytes, não completude ou capacidade de restauração.

Mensalmente e depois de mudanças importantes, restaure em projeto isolado seguindo o guia oficial. Nunca sobrescreva produção para testar. Desative e-mails, webhooks e integrações comerciais antes do teste.

Confira usuários, RLS, permissões, catálogo, variantes, pedidos, itens, estoque, reservas e arquivos públicos/privados. Registre duração, data da cópia e resultado. Cópia diária pode perder até um dia de alterações; avalie PITR se isso for inaceitável.

Use um registro protegido por execução com estes campos mínimos: identificador do backup, início e
fim UTC, projeto de origem, revisão do schema, hashes, contagem por bucket, destino criptografado,
classe de retenção (`diária` ou `semanal`), data prevista de descarte e responsável. Para um teste de
restore, acrescente projeto isolado de destino, duração, contagens comparadas, consultas funcionais
executadas, divergências e decisão `aprovado`/`reprovado`. Um backup sem esse registro ou um restore
com divergência permanece **não verificado**.

No ciclo diário, remova somente cópias cuja retenção venceu e que tenham outra cópia íntegra na
classe exigida. No teste mensal, selecione uma cópia já armazenada (não uma exportação criada apenas
para o teste), restaure banco e Storage, valide autenticação/RLS sem enviar e-mails e destrua o
projeto isolado apenas após guardar o relatório. Essas ações dependem do provedor de armazenamento,
do cofre de chaves e de um projeto Supabase isolado; não são ativadas por este repositório.

## Quando houver infraestrutura

Automatize exportação, cópia de Storage, criptografia, retenção, alertas e testes de restauração. O painel só deve indicar backup verificado com evidências reais: última cópia, cobertura, integridade e último teste de restauração. Não há automação nem restauração remota implementada nesta etapa.

Referências: [Supabase Backups](https://supabase.com/docs/guides/platform/backups) e [exportação e restauração](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

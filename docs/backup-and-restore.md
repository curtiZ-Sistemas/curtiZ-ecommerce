# Backup e recuperação

Responsável: operação técnica. Nunca salve senha ou dump do banco no repositório.

## Objetivos

- RPO alvo: 24 horas sem PITR; o RPO contratado no Supabase quando PITR estiver ativo.
- RTO alvo: 4 horas para restaurar, validar e trocar o tráfego.

## Backup

1. Confirme no Supabase Dashboard que backups automáticos/PITR estão ativos e dentro da retenção contratada.
2. Para cópia externa, use uma máquina segura e `pg_dump` com credencial efêmera fornecida fora do shell history.
3. Armazene o dump criptografado, com acesso restrito, retenção definida e checksum SHA-256 separado.

## Teste de restauração

1. Crie um projeto Supabase isolado e vazio; nunca restaure sobre produção.
2. Restaure schema e dados, aplique migrations posteriores somente se necessário e execute `supabase db lint`.
3. Execute `supabase test db` e valide contagens, pedidos, pagamentos, estoque, RLS e arquivos privados por amostragem.
4. Registre data, backup usado, duração, checksum, testes e responsável. O teste só é bem-sucedido se não houver erro de integridade e os testes de RLS/pagamento passarem.

Faça um teste de restauração trimestral e após mudança material de schema. A ativação de PITR, retenção e armazenamento externo é feita fora deste repositório.

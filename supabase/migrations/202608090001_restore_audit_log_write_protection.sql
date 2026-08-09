-- Restaura a imutabilidade da trilha de auditoria apos a normalizacao geral
-- de privilegios da migration 202608080010_panel_data_access_stability.sql.
-- Funcoes privilegiadas continuam gravando como proprietarias da tabela.

revoke insert, update, delete, truncate
  on table public.audit_logs
  from anon, authenticated;

-- Torna as permissões essenciais dos painéis independentes do seed de demonstração.

insert into public.permissions(code, description)
values
  ('orders.read_assigned', 'Ler pedidos atribuídos'),
  ('orders.read_all', 'Ler todos os pedidos'),
  ('orders.update_operational_status', 'Atualizar status operacional'),
  ('orders.cancel', 'Cancelar pedidos'),
  ('orders.partial_cancel', 'Cancelamento parcial'),
  ('orders.split_shipment', 'Dividir remessas'),
  ('orders.manual_review', 'Revisar pedidos manualmente'),
  ('products.read', 'Ler catálogo interno'),
  ('products.create', 'Criar produtos'),
  ('products.update', 'Atualizar produtos'),
  ('products.archive', 'Arquivar produtos'),
  ('products.manage_cost', 'Gerenciar custos'),
  ('inventory.read', 'Ler estoque'),
  ('inventory.adjust', 'Ajustar estoque'),
  ('inventory.approve_adjustment', 'Aprovar ajustes'),
  ('inventory.suppliers_manage', 'Gerenciar fornecedores'),
  ('inventory.purchase_orders_manage', 'Gerenciar pedidos de compra'),
  ('inventory.audit_manage', 'Gerenciar inventário'),
  ('support.quick_answers.read', 'Ler respostas rápidas'),
  ('support.quick_answers.manage', 'Gerenciar respostas rápidas'),
  ('support.conversations.read', 'Ler conversas autorizadas'),
  ('support.conversations.assign', 'Atribuir conversas'),
  ('support.conversations.reply', 'Responder conversas'),
  ('support.conversations.transfer', 'Transferir conversas'),
  ('support.conversations.escalate', 'Escalar conversas'),
  ('support.internal_notes.create', 'Criar notas internas'),
  ('support.close', 'Encerrar conversas'),
  ('support.reopen', 'Reabrir conversas'),
  ('support.reports.read', 'Ler relatórios de suporte'),
  ('support.sla.manage', 'Gerenciar SLA'),
  ('returns.read', 'Ler devoluções'),
  ('returns.manage', 'Gerenciar devoluções'),
  ('returns.approve', 'Aprovar devoluções'),
  ('returns.inspect', 'Inspecionar devoluções'),
  ('returns.refund', 'Solicitar reembolso'),
  ('financial.read_summary', 'Ler resumo financeiro'),
  ('financial.read_full', 'Ler financeiro completo'),
  ('finance.reconcile', 'Conciliar pagamentos'),
  ('finance.close_period', 'Fechar período'),
  ('finance.reopen_period', 'Reabrir período'),
  ('promotions.advanced_manage', 'Gerenciar promoções avançadas'),
  ('promotions.approve', 'Aprovar promoções'),
  ('banners.update', 'Gerenciar banners'),
  ('marketing.manage', 'Gerenciar marketing'),
  ('marketing.segments', 'Gerenciar segmentos'),
  ('marketing.automations', 'Gerenciar automações'),
  ('users.read', 'Ler usuários internos'),
  ('users.create_internal', 'Criar usuários internos'),
  ('reports.export', 'Exportar relatórios'),
  ('audit.read', 'Ler auditoria'),
  ('technical.health.read', 'Ler saúde técnica'),
  ('technical.logs.read', 'Ler logs técnicos'),
  ('technical.integrations.manage', 'Gerenciar integrações'),
  ('erp.manage', 'Gerenciar ERP')
on conflict(code) do update set description = excluded.description;

insert into public.role_permissions(role, permission_id)
select 'operational', id from public.permissions where code in (
  'orders.read_assigned','orders.update_operational_status','inventory.read',
  'returns.read','support.quick_answers.read','support.conversations.read',
  'support.conversations.reply'
) on conflict do nothing;

insert into public.role_permissions(role, permission_id)
select 'admin', id from public.permissions where code not in (
  'financial.read_full','finance.close_period','finance.reopen_period',
  'technical.logs.read','technical.integrations.manage'
) on conflict do nothing;

insert into public.role_permissions(role, permission_id)
select 'manager', id from public.permissions where code in (
  'orders.read_all','products.read','inventory.read','inventory.approve_adjustment',
  'support.conversations.read','support.conversations.reply','support.conversations.escalate',
  'support.reports.read','returns.read','returns.approve','returns.refund',
  'financial.read_summary','financial.read_full','finance.reconcile','finance.close_period',
  'finance.reopen_period','promotions.approve','reports.export','audit.read'
) on conflict do nothing;

insert into public.role_permissions(role, permission_id)
select 'technical', id from public.permissions where code in (
  'support.conversations.read','support.conversations.reply','users.read',
  'technical.health.read','technical.logs.read','technical.integrations.manage',
  'erp.manage','audit.read'
) on conflict do nothing;

notify pgrst, 'reload schema';

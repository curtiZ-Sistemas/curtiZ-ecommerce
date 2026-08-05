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
on conflict(code) do nothing;

insert into public.role_permissions(role, permission_id)
select 'operational', id from public.permissions where code in (
  'orders.read_assigned','orders.update_operational_status','inventory.read',
  'returns.read','support.quick_answers.read','support.conversations.read',
  'support.conversations.reply'
)
on conflict do nothing;

insert into public.role_permissions(role, permission_id)
select 'admin', id from public.permissions where code not in (
  'financial.read_full','finance.close_period','finance.reopen_period',
  'technical.logs.read','technical.integrations.manage'
)
on conflict do nothing;

insert into public.role_permissions(role, permission_id)
select 'manager', id from public.permissions where code in (
  'orders.read_all','products.read','inventory.read','inventory.approve_adjustment',
  'support.conversations.read','support.conversations.reply','support.conversations.escalate',
  'support.reports.read','returns.read','returns.approve','returns.refund',
  'financial.read_summary','financial.read_full','finance.reconcile','finance.close_period',
  'finance.reopen_period','promotions.approve','reports.export','audit.read'
)
on conflict do nothing;

insert into public.role_permissions(role, permission_id)
select 'technical', id from public.permissions where code in (
  'support.conversations.read','support.conversations.reply','users.read',
  'technical.health.read','technical.logs.read','technical.integrations.manage',
  'erp.manage','audit.read'
)
on conflict do nothing;

insert into public.categories(id, name, slug, description, sort_order)
values
  ('10000000-0000-0000-0000-000000000001', 'Masculino', 'masculino', 'Chinelos e slides masculinos', 1),
  ('10000000-0000-0000-0000-000000000002', 'Feminino', 'feminino', 'Chinelos e sandálias femininas', 2),
  ('10000000-0000-0000-0000-000000000003', 'Infantil', 'infantil', 'Conforto para crianças', 3),
  ('10000000-0000-0000-0000-000000000004', 'Slides', 'slides', 'Slides Curtiz', 4),
  ('10000000-0000-0000-0000-000000000005', 'Sandálias', 'sandalias', 'Sandálias Curtiz', 5)
on conflict(id) do nothing;

insert into public.products(
  id, name, slug, short_description, description, category_id, status, featured,
  base_price, cost_price, weight_grams, height_cm, width_cm, length_cm
)
values
  (
    '20000000-0000-0000-0000-000000000001',
    'curti Z Flip-Flop Wave Preto', 'flip-flop-wave-preto',
    'Leve, resistente e macio.', 'Produto fictício para demonstração local.',
    '10000000-0000-0000-0000-000000000001', 'active', true,
    59.90, 22.00, 350, 8, 20, 30
  ),
  (
    '20000000-0000-0000-0000-000000000002',
    'curti Z Flip-Flop Slim Coral', 'flip-flop-slim-coral',
    'Design minimalista em tom coral.', 'Produto fictício para demonstração local.',
    '10000000-0000-0000-0000-000000000002', 'active', true,
    54.90, 20.00, 320, 8, 20, 30
  )
on conflict(id) do nothing;

insert into public.product_variants(
  id, product_id, sku, color_name, color_hex, size, active
)
values
  (
    '30000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    'CZT-FW-PRE-40', 'Preto', '#171717', '39/40', true
  ),
  (
    '30000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000002',
    'CZT-FS-COR-38', 'Coral', '#CF6853', '37/38', true
  )
on conflict(id) do nothing;

insert into public.inventory(variant_id, available_quantity, minimum_quantity, ideal_quantity)
values
  ('30000000-0000-0000-0000-000000000001', 156, 20, 180),
  ('30000000-0000-0000-0000-000000000002', 73, 15, 100)
on conflict(variant_id) do nothing;

insert into public.support_sla_policies(id, name, priority, first_response_minutes, update_minutes, resolution_minutes)
values
  ('40000000-0000-0000-0000-000000000001', 'Normal', 'normal', 240, 480, 1440),
  ('40000000-0000-0000-0000-000000000002', 'Urgente', 'urgent', 30, 60, 240)
on conflict(id) do nothing;

insert into public.support_categories(id, name, slug, description, default_priority, default_sla_policy_id)
values
  ('41000000-0000-0000-0000-000000000001', 'Pedido', 'pedido', 'Dúvidas sobre pedidos', 'normal', '40000000-0000-0000-0000-000000000001'),
  ('41000000-0000-0000-0000-000000000002', 'Pagamento', 'pagamento', 'Dúvidas sobre pagamento', 'high', '40000000-0000-0000-0000-000000000001'),
  ('41000000-0000-0000-0000-000000000003', 'Problema técnico', 'problema-tecnico', 'Falhas técnicas', 'high', '40000000-0000-0000-0000-000000000002')
on conflict(id) do nothing;

insert into public.support_quick_answers(
  category_id, question, slug, answer, keywords, action_buttons, active, sort_order
)
values
  (
    '41000000-0000-0000-0000-000000000001',
    'Como funciona o frete?', 'como-funciona-o-frete',
    'O valor e o prazo são calculados usando o CEP informado. O prazo começa após a confirmação do pagamento.',
    array['frete','cep','prazo'], '[{"label":"Calcular frete","href":"/produtos"}]'::jsonb, true, 1
  ),
  (
    '41000000-0000-0000-0000-000000000001',
    'Como rastrear meu pedido?', 'como-rastrear-pedido',
    'Acesse Minha conta e selecione o pedido para consultar eventos confirmados pelo provedor.',
    array['rastreio','pedido','entrega'], '[{"label":"Meus pedidos","href":"/minha-conta/pedidos"}]'::jsonb, true, 2
  )
on conflict(slug) do nothing;

insert into public.system_settings(key, value, is_public)
values
  ('free_shipping_threshold_cents', '14900'::jsonb, true),
  ('inventory_reservation_minutes', '30'::jsonb, false),
  ('support_human_entry_role', '"admin"'::jsonb, false),
  ('support_business_timezone', '"America/Sao_Paulo"'::jsonb, true)
on conflict(key) do nothing;

insert into public.integration_health(provider, state, error_summary)
values
  ('mercadopago', 'awaiting_credentials', 'Credenciais não configuradas'),
  ('shipping', 'not_configured', 'Provedor não configurado'),
  ('email', 'not_configured', 'Provedor não configurado'),
  ('whatsapp', 'not_configured', 'WhatsApp não configurado'),
  ('erp', 'not_configured', 'ERP não configurado')
on conflict(provider) do update set state = excluded.state, error_summary = excluded.error_summary;

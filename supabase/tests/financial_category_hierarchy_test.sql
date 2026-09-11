begin;

create extension if not exists pgtap with schema extensions;
select plan(19);

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'f1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'finance-hierarchy@test.local', crypt('Test-password-123', gen_salt('bf')),
  now(), '{"role":"manager"}', '{"full_name":"Finance Hierarchy"}', now(), now()
) on conflict (id) do nothing;
insert into public.user_roles(user_id, role)
values ('f1000000-0000-4000-8000-000000000001', 'manager') on conflict do nothing;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","app_metadata":{"role":"manager"}}', true);

select lives_ok(
  $$select public.financial_control_mutate('category.save','{"name":"Grupo teste financeiro","code":"9.90","kind":"expense","is_group":true,"parent_id":"","sort_order":1,"active":true}'::jsonb)$$,
  '1. Cria conta totalizadora'
);
select lives_ok(
  $$select public.financial_control_mutate('category.save',jsonb_build_object('name','Internet teste financeiro','code','9.90.01','kind','expense','is_group',false,'parent_id',(select id from public.financial_categories where name='Grupo teste financeiro'),'sort_order',1,'active',true))$$,
  '2. Cria subconta vinculada ao grupo'
);
select is(
  (select parent_id from public.financial_categories where name='Internet teste financeiro'),
  (select id from public.financial_categories where name='Grupo teste financeiro'),
  '3. Mantem o vinculo hierarquico'
);
select throws_ok(
  $$select public.financial_control_mutate('category.save',jsonb_build_object('id',(select id from public.financial_categories where name='Grupo teste financeiro'),'name','Grupo teste financeiro','code','9.90','kind','expense','is_group',true,'parent_id',(select id from public.financial_categories where name='Grupo teste financeiro'),'sort_order',1,'active',true))$$,
  'financial category cannot be its own parent',
  '4. Impede autorreferencia'
);
select lives_ok(
  $$select public.financial_control_mutate('account.save','{"name":"Conta teste hierarquia","initial_balance_cents":0,"active":true}'::jsonb)$$,
  '5. Cria conta financeira de teste'
);
select throws_ok(
  $$select public.financial_control_mutate('payable.create',jsonb_build_object('party','Fornecedor teste','description','Internet','category_id',(select id from public.financial_categories where name='Grupo teste financeiro'),'issued_on',current_date,'due_on',current_date,'document_number','','amount_cents',50000,'account_id','','notes','','installment_count',1,'interval_days',30))$$,
  'invalid analytic financial category',
  '6. Rejeita grupo em conta a pagar pela RPC'
);
select lives_ok(
  $$select public.financial_control_mutate('payable.create',jsonb_build_object('party','Fornecedor teste','description','Internet','category_id',(select id from public.financial_categories where name='Internet teste financeiro'),'issued_on',current_date,'due_on',current_date,'document_number','T-1','amount_cents',50000,'account_id','','notes','','installment_count',1,'interval_days',30))$$,
  '7. Cadastra conta a pagar na subconta'
);
select lives_ok(
  $$select public.financial_control_mutate('payable.settle',jsonb_build_object('id',(select id from public.accounts_payable where document_number='T-1'),'settled_on',current_date,'account_id',(select id from public.financial_accounts where name='Conta teste hierarquia')))$$,
  '8. Paga a conta'
);
select is(
  (select count(*) from public.financial_transactions where payable_id=(select id from public.accounts_payable where document_number='T-1')),
  1::bigint,
  '9. Pagamento gera exatamente um lancamento'
);
select is(
  (select sum(amount) from public.financial_transactions where payable_id=(select id from public.accounts_payable where document_number='T-1') and reversed_at is null),
  500.00::numeric,
  '10. Caixa recebe uma unica saida de R$ 500'
);
select is(
  (select (item->>'total')::numeric from jsonb_array_elements(public.financial_control_snapshot(current_date,current_date)->'expense_category_report') item where item->>'category_name'='Internet teste financeiro'),
  500.00::numeric,
  '11. Subconta totaliza R$ 500 sem movimento adicional'
);
select is(
  (select (item->>'value')::numeric from jsonb_array_elements(public.financial_control_snapshot(current_date,current_date)->'expense_by_group') item where item->>'name'='Grupo teste financeiro'),
  500.00::numeric,
  '12. Grupo agrega os mesmos R$ 500'
);
select lives_ok(
  $$select public.financial_control_mutate('category.save','{"name":"Grupo receita teste","code":"8.80","kind":"income","is_group":true,"parent_id":"","sort_order":1,"active":true}'::jsonb)$$,
  '13. Cria totalizadora de receita'
);
select lives_ok(
  $$select public.financial_control_mutate('category.save',jsonb_build_object('name','Loja teste','code','8.80.01','kind','income','is_group',false,'parent_id',(select id from public.financial_categories where name='Grupo receita teste'),'sort_order',1,'active',true))$$,
  '14. Cria subconta de receita'
);
select lives_ok(
  $$select public.financial_control_mutate('receivable.create',jsonb_build_object('party','Cliente teste','description','Venda teste','category_id',(select id from public.financial_categories where name='Loja teste'),'issued_on',current_date,'due_on',current_date,'document_number','R-1','amount_cents',70000,'account_id','','notes','','installment_count',1,'interval_days',30))$$,
  '15. Cadastra conta a receber na subconta'
);
select lives_ok(
  $$select public.financial_control_mutate('receivable.settle',jsonb_build_object('id',(select id from public.accounts_receivable where document_number='R-1'),'settled_on',current_date,'account_id',(select id from public.financial_accounts where name='Conta teste hierarquia')))$$,
  '16. Recebe a conta'
);
select is(
  (select count(*) from public.financial_transactions where receivable_id=(select id from public.accounts_receivable where document_number='R-1')),
  1::bigint,
  '17. Recebimento gera exatamente um lancamento'
);
select lives_ok(
  $$select public.financial_control_mutate('category.save',jsonb_build_object('id',(select id from public.financial_categories where name='Internet teste financeiro'),'name','Internet teste financeiro','code','9.90.01','kind','expense','is_group',false,'parent_id','','sort_order',1,'active',false))$$,
  '18. Categoria com historico pode ser desativada sem apagar movimentos'
);
select ok(
  exists(select 1 from public.audit_logs where action='category.save' and entity_type='financial.subaccount'),
  '19. Alteracoes hierarquicas usam a auditoria global'
);

select * from finish();
rollback;

begin;

create extension if not exists pgtap with schema extensions;
select plan(44);

insert into auth.users(id,instance_id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('f2000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','mp-finance-manager@test.local','{}','{"full_name":"MP Finance Manager"}',now(),now()),
('f2000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','mp-finance-customer@test.local','{}','{"full_name":"MP Finance Customer"}',now(),now());
insert into public.user_roles(user_id,role) values
('f2000000-0000-4000-8000-000000000001','manager'),
('f2000000-0000-4000-8000-000000000002','customer') on conflict do nothing;

set local role service_role;
insert into public.orders(id,public_code,customer_id,customer_email_snapshot,customer_name_snapshot,status,payment_status,currency,subtotal,grand_total,shipping_address_snapshot) values
('f2100000-0000-4000-8000-000000000001','CZT-MP-PIX','f2000000-0000-4000-8000-000000000002','mp-finance-customer@test.local','Cliente Pix','pending_payment','pending','BRL',100,100,'{}'),
('f2100000-0000-4000-8000-000000000002','CZT-MP-CARD','f2000000-0000-4000-8000-000000000002','mp-finance-customer@test.local','Cliente Cartao','pending_payment','pending','BRL',200,200,'{}'),
('f2100000-0000-4000-8000-000000000003','CZT-MP-REJECT','f2000000-0000-4000-8000-000000000002','mp-finance-customer@test.local','Cliente Recusado','pending_payment','pending','BRL',50,50,'{}'),
('f2100000-0000-4000-8000-000000000004','CZT-MP-CANCEL','f2000000-0000-4000-8000-000000000002','mp-finance-customer@test.local','Cliente Cancelado','pending_payment','pending','BRL',75,75,'{}');
insert into public.payments(id,order_id,provider,external_reference,status,amount,currency,payment_method_summary) values
('f2200000-0000-4000-8000-000000000001','f2100000-0000-4000-8000-000000000001','mercadopago','CZT-MP-PIX','pending',100,'BRL','selected:pix'),
('f2200000-0000-4000-8000-000000000002','f2100000-0000-4000-8000-000000000002','mercadopago','CZT-MP-CARD','pending',200,'BRL','selected:visa'),
('f2200000-0000-4000-8000-000000000003','f2100000-0000-4000-8000-000000000003','mercadopago','CZT-MP-REJECT','pending',50,'BRL','selected:master'),
('f2200000-0000-4000-8000-000000000004','f2100000-0000-4000-8000-000000000004','mercadopago','CZT-MP-CANCEL','pending',75,'BRL','selected:pix');

select is((select status from public.accounts_receivable where payment_id='f2200000-0000-4000-8000-000000000001'),'pending','1. Pix pendente cria conta a receber pendente');
select is((select origin from public.accounts_receivable where payment_id='f2200000-0000-4000-8000-000000000001'),'online_store','2. Origem e loja online');
select is((select a.name from public.accounts_receivable r join public.financial_accounts a on a.id=r.destination_account_id where r.payment_id='f2200000-0000-4000-8000-000000000001'),'Mercado Pago','3. Conta Mercado Pago e criada ou reutilizada');

select lives_ok($$select public.finalize_mercadopago_payment('evt-pix-approved','900001','CZT-MP-PIX',100,'BRL','approved',now(),3.90,96.10,'bank_transfer:pix',1,'accredited')$$,'4. Webhook aprova Pix');
select is((select status from public.accounts_receivable where payment_id='f2200000-0000-4000-8000-000000000001'),'received','5. Conta a receber recebe baixa');
select is((select gross_amount from public.accounts_receivable where payment_id='f2200000-0000-4000-8000-000000000001'),100.00::numeric,'6. Registra valor bruto real');
select is((select provider_fee from public.accounts_receivable where payment_id='f2200000-0000-4000-8000-000000000001'),3.90::numeric,'7. Registra taxa real');
select is((select net_amount from public.accounts_receivable where payment_id='f2200000-0000-4000-8000-000000000001'),96.10::numeric,'8. Registra valor liquido real');
select is((select payment_method||':'||provider_installments from public.accounts_receivable where payment_id='f2200000-0000-4000-8000-000000000001'),'bank_transfer:pix:1','9. Registra meio e parcelas');
select is((select count(*) from public.financial_transactions where receivable_id=(select id from public.accounts_receivable where payment_id='f2200000-0000-4000-8000-000000000001')),1::bigint,'10. Gera uma receita bruta');
select is((select count(*) from public.accounts_payable where payment_id='f2200000-0000-4000-8000-000000000001' and origin='mercadopago_fee'),1::bigint,'11. Gera uma conta da taxa');
select is((select count(*) from public.financial_transactions t join public.accounts_payable p on p.id=t.payable_id where p.payment_id='f2200000-0000-4000-8000-000000000001' and p.origin='mercadopago_fee'),1::bigint,'12. Gera uma despesa da taxa');
select lives_ok($$select public.finalize_mercadopago_payment('evt-pix-approved','900001','CZT-MP-PIX',100,'BRL','approved',now(),3.90,96.10,'bank_transfer:pix',1,'accredited')$$,'13. Webhook repetido e aceito');
select is((select count(*) from public.financial_transactions where receivable_id=(select id from public.accounts_receivable where payment_id='f2200000-0000-4000-8000-000000000001')),1::bigint,'14. Webhook repetido nao duplica receita');
select is((select count(*) from public.accounts_payable where payment_id='f2200000-0000-4000-8000-000000000001' and origin='mercadopago_fee'),1::bigint,'15. Webhook repetido nao duplica taxa');
select is((select count(*) from public.audit_logs where entity_id='f2200000-0000-4000-8000-000000000001' and action='financial.mercadopago.approved'),1::bigint,'16. Repeticao nao duplica auditoria');

select lives_ok($$select public.finalize_mercadopago_payment('evt-card-approved','900002','CZT-MP-CARD',200,'BRL','approved',now(),8,192,'credit_card:visa',3,'accredited')$$,'17. Cartao e aprovado');
select is((select payment_method||':'||provider_installments from public.accounts_receivable where payment_id='f2200000-0000-4000-8000-000000000002'),'credit_card:visa:3','18. Cartao preserva bandeira e parcelas');
select lives_ok($$select public.finalize_mercadopago_payment('evt-card-rejected','900003','CZT-MP-REJECT',50,'BRL','rejected',null,null,null,'credit_card:master',1,'cc_rejected_bad_filled_card_number')$$,'19. Cartao recusado e reconciliado');
select is((select status from public.accounts_receivable where payment_id='f2200000-0000-4000-8000-000000000003'),'cancelled','20. Recusa cancela a conta a receber');
select is((select count(*) from public.financial_transactions where receivable_id=(select id from public.accounts_receivable where payment_id='f2200000-0000-4000-8000-000000000003')),0::bigint,'21. Recusa nao realiza receita');
select lives_ok($$select public.finalize_mercadopago_payment('evt-pix-cancelled','900004','CZT-MP-CANCEL',75,'BRL','cancelled',null,null,null,'bank_transfer:pix',1,'expired')$$,'22. Pagamento expirado ou cancelado e reconciliado');
select is((select status from public.accounts_receivable where payment_id='f2200000-0000-4000-8000-000000000004'),'cancelled','23. Cancelamento atualiza a conta a receber');
select is((select count(*) from public.financial_transactions where receivable_id=(select id from public.accounts_receivable where payment_id='f2200000-0000-4000-8000-000000000004')),0::bigint,'24. Cancelamento nao realiza receita');

select lives_ok($$select public.reconcile_mercadopago_provider_refund('900001','refund-1',40,'evt-refund-1',now())$$,'25. Reembolso parcial e reconciliado');
select is((select status from public.payments where id='f2200000-0000-4000-8000-000000000001'),'approved'::public.payment_status,'26. Parcial mantem pagamento aprovado');
select is((select refunded_amount from public.accounts_receivable where payment_id='f2200000-0000-4000-8000-000000000001'),40.00::numeric,'27. Parcial atualiza total reembolsado');
select is((select sum(amount) from public.accounts_payable where payment_id='f2200000-0000-4000-8000-000000000001' and origin='mercadopago_refund'),40.00::numeric,'28. Parcial gera despesa de reembolso');
select lives_ok($$select public.reconcile_mercadopago_provider_refund('900001','refund-1',40,'evt-refund-1',now())$$,'29. Reembolso repetido e aceito');
select is((select count(*) from public.payment_refunds where payment_id='f2200000-0000-4000-8000-000000000001'),1::bigint,'30. Reembolso repetido nao duplica registro');
select lives_ok($$select public.reconcile_mercadopago_provider_refund('900001','refund-2',60,'evt-refund-2',now())$$,'31. Segundo parcial completa o reembolso');
select is((select status from public.payments where id='f2200000-0000-4000-8000-000000000001'),'refunded'::public.payment_status,'32. Soma integral marca pagamento reembolsado');
select is((select refunded_amount from public.accounts_receivable where payment_id='f2200000-0000-4000-8000-000000000001'),100.00::numeric,'33. Total reembolsado fica correto');
select is((select count(*) from public.payment_refunds where payment_id='f2200000-0000-4000-8000-000000000001'),2::bigint,'34. Mantem os dois reembolsos parciais');
select is((select count(*) from public.financial_transactions t join public.accounts_payable p on p.id=t.payable_id where p.payment_id='f2200000-0000-4000-8000-000000000001' and p.origin='mercadopago_refund'),2::bigint,'35. Cada reembolso gera uma unica despesa');

reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"f2000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
select lives_ok($$select public.financial_control_mutate('account.save','{"name":"Banco teste MP","initial_balance_cents":0,"active":true}'::jsonb)$$,'36. Cadastra banco de destino');
select lives_ok($$select public.financial_control_mutate('transfer.save',jsonb_build_object('source_account_id',(select id from public.financial_accounts where name='Mercado Pago'),'destination_account_id',(select id from public.financial_accounts where name='Banco teste MP'),'amount_cents',5000,'occurred_on',current_date,'description','Saque Mercado Pago','external_reference','saque-mp-1'))$$,'37. Registra transferencia Mercado Pago para banco');
select is((select count(*) from public.financial_transactions where transfer_id=(select id from public.financial_transfers where external_reference='saque-mp-1')),2::bigint,'38. Transferencia gera duas pontas');
select is((select count(*) from public.financial_transactions where transfer_id=(select id from public.financial_transfers where external_reference='saque-mp-1') and not affects_result),2::bigint,'39. As duas pontas nao afetam resultado');
select is((select sum(case when type='income' then amount else -amount end) from public.financial_transactions where transfer_id=(select id from public.financial_transfers where external_reference='saque-mp-1')),0.00::numeric,'40. Transferencia tem impacto liquido zero');
select is((public.financial_control_snapshot(current_date,current_date)->'online_sales_summary'->>'gross')::numeric,300.00::numeric,'41. Dashboard totaliza somente vendas recebidas');

select set_config('request.jwt.claims','{"sub":"f2000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($$select public.financial_control_snapshot(current_date,current_date)$$,'42501','permission denied','42. Cliente nao acessa o financeiro por RLS e permissao');
select is((select count(*) from public.financial_transfers),0::bigint,'43. Cliente nao le transferencias por RLS');
select set_config('request.jwt.claims','{"sub":"f2000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
select ok(exists(select 1 from public.audit_logs where action='financial.mercadopago.refund'),'44. Reembolsos ficam na auditoria');

select * from finish();
rollback;

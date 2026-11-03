begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,instance_id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('fb000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','report-manager@test.local','{}','{}',now(),now()),
('fb000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','report-customer@test.local','{}','{}',now(),now()),
('fb000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','report-other@test.local','{}','{}',now(),now());
insert into public.user_roles(user_id,role) values
('fb000000-0000-4000-8000-000000000001','manager'),
('fb000000-0000-4000-8000-000000000001','admin'),
('fb000000-0000-4000-8000-000000000002','customer'),
('fb000000-0000-4000-8000-000000000003','customer') on conflict do nothing;

set local role service_role;
insert into public.orders(id,public_code,customer_id,customer_email_snapshot,customer_name_snapshot,status,payment_status,currency,subtotal,grand_total,shipping_address_snapshot,commercial_rules_snapshot,placed_at) values
('fb100000-0000-4000-8000-000000000001','CZT-REPORT-TEST','fb000000-0000-4000-8000-000000000002','report-customer@test.local','Test','pending_payment','pending','BRL',900,900,'{}','{"paymentMode":"test"}','2051-02-15T12:00:00Z'),
('fb100000-0000-4000-8000-000000000002','CZT-REPORT-LIVE','fb000000-0000-4000-8000-000000000002','report-customer@test.local','Production','pending_payment','pending','BRL',100,100,'{}','{"paymentMode":"production"}','2051-02-15T12:00:00Z'),
('fb100000-0000-4000-8000-000000000003','CZT-REPORT-LEGACY','fb000000-0000-4000-8000-000000000003','report-other@test.local','Legacy','pending_payment','pending','BRL',50,50,'{}','{}','2051-02-15T12:00:00Z');
insert into public.payments(id,order_id,provider,external_reference,status,amount,currency,payment_method_summary) values
('fb200000-0000-4000-8000-000000000001','fb100000-0000-4000-8000-000000000001','mercadopago','CZT-REPORT-TEST','pending',900,'BRL','selected:pix'),
('fb200000-0000-4000-8000-000000000002','fb100000-0000-4000-8000-000000000002','mercadopago','CZT-REPORT-LIVE','pending',100,'BRL','selected:pix'),
('fb200000-0000-4000-8000-000000000003','fb100000-0000-4000-8000-000000000003','mercadopago','CZT-REPORT-LEGACY','pending',50,'BRL','selected:pix');

select lives_ok($$select public.finalize_mercadopago_payment('report-test-approved','991001','CZT-REPORT-TEST',900,'BRL','approved','2051-02-15T12:00:00Z',9,891,'bank_transfer:pix',1,'accredited')$$,'Test payment still reconciles and retains its financial history');
select lives_ok($$select public.finalize_mercadopago_payment('report-live-approved','991002','CZT-REPORT-LIVE',100,'BRL','approved','2051-02-15T12:00:00Z',3,97,'bank_transfer:pix',1,'accredited')$$,'Production payment reconciles');
select lives_ok($$select public.finalize_mercadopago_payment('report-legacy-approved','991003','CZT-REPORT-LEGACY',50,'BRL','approved','2051-02-15T12:00:00Z',2,48,'bank_transfer:pix',1,'accredited')$$,'Legacy payment without paymentMode reconciles');
select lives_ok($$select public.reconcile_mercadopago_provider_refund('991001','report-test-refund',30,'report-test-refund-event','2051-02-16T12:00:00Z')$$,'Test refund remains recorded');
select lives_ok($$select public.reconcile_mercadopago_provider_refund('991002','report-live-refund',10,'report-live-refund-event','2051-02-16T12:00:00Z')$$,'Production refund remains recorded');

reset role;
select is((select count(*) from public.orders where id::text like 'fb100000-%'),3::bigint,'Original orders are preserved');
select is((select count(*) from public.reporting_orders where id::text like 'fb100000-%'),2::bigint,'Only explicitly marked test orders are excluded');
select is((select count(*) from private.reporting_accounts_receivable where payment_id='fb200000-0000-4000-8000-000000000001'),0::bigint,'Test receivable is absent from reporting');
select is((select count(*) from public.accounts_receivable where payment_id='fb200000-0000-4000-8000-000000000001'),1::bigint,'Test receivable history is retained');
select is((select count(*) from private.reporting_accounts_payable where payment_id='fb200000-0000-4000-8000-000000000001'),0::bigint,'Test fees and refunds are absent from reporting');
select is((select count(*) from private.reporting_financial_transactions t join public.accounts_receivable r on r.id=t.receivable_id where r.payment_id='fb200000-0000-4000-8000-000000000001'),0::bigint,'Test cash income is excluded');
select is((select count(*) from private.reporting_financial_transactions t join public.accounts_payable a on a.id=t.payable_id where a.payment_id='fb200000-0000-4000-8000-000000000001'),0::bigint,'Test cash expenses are excluded');
select ok(not has_table_privilege('anon','public.reporting_orders','select'),'Anonymous callers cannot select reporting orders');
select ok(not has_table_privilege('authenticated','private.reporting_financial_transactions','select'),'Financial reporting views have no new direct client grant');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"fb000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
select is((public.manager_dashboard_metrics('2051-02-01','2051-02-28')->>'gross_cents')::bigint,15000::bigint,'Dashboard retains production and legacy gross revenue');
select is((public.manager_dashboard_metrics('2051-02-01','2051-02-28')->>'orders')::bigint,2::bigint,'Dashboard excludes the approved test order');
select is((public.manager_dashboard_metrics('2051-02-01','2051-02-28')->>'refunds_cents')::bigint,1000::bigint,'Dashboard excludes test refunds');
select is((public.manager_strategic_metrics('2051-02-01','2051-02-28')->'comparison'->'current'->>'orders')::bigint,2::bigint,'Strategy uses the same production scope');
select is((public.financial_control_snapshot('2051-02-01','2051-02-28')->'online_sales_summary'->>'gross')::numeric,150::numeric,'Financial dashboard excludes test gross');
select is((public.financial_control_snapshot('2051-02-01','2051-02-28')->'online_sales_summary'->>'fees')::numeric,5::numeric,'Financial dashboard excludes test fees');
select is((public.financial_control_snapshot('2051-02-01','2051-02-28')->'online_sales_summary'->>'refunds')::numeric,10::numeric,'Financial dashboard excludes test refunds');
select is((public.financial_control_snapshot('2051-02-01','2051-02-28')->'online_sales_summary'->>'sales_count')::bigint,2::bigint,'Financial dashboard counts only production and legacy sales');

select set_config('request.jwt.claims','{"sub":"fb000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}',true);
select is((select count(*) from public.reporting_orders where id::text like 'fb100000-%'),1::bigint,'Security-invoker view preserves customer ownership RLS');
select throws_ok($$select public.financial_control_snapshot('2051-02-01','2051-02-28')$$,'42501','permission denied','Customer cannot invoke the financial report');
select * from finish();
rollback;

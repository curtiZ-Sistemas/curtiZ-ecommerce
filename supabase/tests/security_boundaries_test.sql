begin;

create extension if not exists pgtap with schema extensions;
select plan(8);

select ok(to_regclass('public.payment_refunds') is not null, '1. Tabela de reembolsos existe');
select ok(
  to_regprocedure('public.finalize_mercadopago_payment(text,text,text,numeric,text,public.payment_status,timestamptz)') is not null,
  '2. Finalização transacional de pagamento existe'
);
select ok(
  has_function_privilege('service_role', 'public.finalize_mercadopago_payment(text,text,text,numeric,text,public.payment_status,timestamptz)', 'execute'),
  '3. Service role executa finalização de pagamento'
);
select ok(
  not has_function_privilege('anon', 'public.finalize_mercadopago_payment(text,text,text,numeric,text,public.payment_status,timestamptz)', 'execute'),
  '4. Anônimo não finaliza pagamento'
);
select ok(
  has_function_privilege('service_role', 'public.submit_privacy_request(text,text,text,text,uuid)', 'execute'),
  '5. Backend executa solicitação de privacidade'
);
select ok(
  not has_function_privilege('anon', 'public.submit_privacy_request(text,text,text,text,uuid)', 'execute'),
  '6. Anônimo não contorna a proteção da API'
);
select ok(
  has_function_privilege('authenticated', 'public.operational_critical_stock_count()', 'execute'),
  '7. Usuário autenticado pode chamar métrica protegida'
);
select ok(
  not has_function_privilege('anon', 'public.operational_critical_stock_count()', 'execute'),
  '8. Anônimo não consulta métrica operacional'
);

select * from finish();
rollback;

-- Isolated fixture only; no provider calls and all rows roll back.
begin;
set local timezone to 'UTC';
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
values ('fe550000-0000-4000-8000-000000000001','financial-timezone-test@example.invalid','{}','{}');
insert into public.orders(id,public_code,customer_id,customer_email_snapshot,customer_name_snapshot,status,payment_status,subtotal,grand_total,shipping_address_snapshot,created_at)
values
 ('fe550000-0000-4000-8000-000000000002','FIN-TZ-CI-1','fe550000-0000-4000-8000-000000000001','financial-timezone-test@example.invalid','Timezone fixture','picking','pending',50,50,'{}',
  ((now() at time zone 'America/Sao_Paulo')::date + interval '1 day 1 hour') at time zone 'UTC'),
 ('fe550000-0000-4000-8000-000000000004','FIN-TZ-CI-2','fe550000-0000-4000-8000-000000000001','financial-timezone-test@example.invalid','Timezone fixture','picking','approved',50,50,'{}',
  ((now() at time zone 'America/Sao_Paulo')::date + interval '1 day 1 hour') at time zone 'UTC');

insert into public.payments(id,order_id,provider,provider_payment_id,external_reference,status,amount)
values('fe550000-0000-4000-8000-000000000003','fe550000-0000-4000-8000-000000000002','mercadopago','financial-timezone-fixture-1','FIN-TZ-CI-1','pending',50);
select is((select issued_on from public.accounts_receivable where payment_id='fe550000-0000-4000-8000-000000000003'),
  (now() at time zone 'America/Sao_Paulo')::date,'Order issue date uses the business timezone even in a UTC session');

-- A pending integration row could have been recorded before the timezone fix.
update public.accounts_receivable set issued_on=(now() at time zone 'America/Sao_Paulo')::date+1,
 due_on=(now() at time zone 'America/Sao_Paulo')::date+1
where payment_id='fe550000-0000-4000-8000-000000000003';
select lives_ok($$update public.payments set status='approved' where id='fe550000-0000-4000-8000-000000000003'$$,
  'Approval reconciles a legacy date without conflicting with the receipt date');
select is((select issued_on from public.accounts_receivable where payment_id='fe550000-0000-4000-8000-000000000003'),
  (now() at time zone 'America/Sao_Paulo')::date,'Legacy issue date is derived from the original order');
select is((select due_on from public.accounts_receivable where payment_id='fe550000-0000-4000-8000-000000000003'),
  (now() at time zone 'America/Sao_Paulo')::date,'Legacy due date is reconciled from the original payment');
select is((select received_on from public.accounts_receivable where payment_id='fe550000-0000-4000-8000-000000000003'),
  (now() at time zone 'America/Sao_Paulo')::date,'Missing provider timestamp uses the same business date');

insert into public.payments(id,order_id,provider,provider_payment_id,external_reference,status,amount,paid_at)
values('fe550000-0000-4000-8000-000000000005','fe550000-0000-4000-8000-000000000004','mercadopago','financial-timezone-fixture-2','FIN-TZ-CI-2','approved',50,
 ((now() at time zone 'America/Sao_Paulo')::date + interval '1 day 2 hours') at time zone 'UTC');
select is((select received_on from public.accounts_receivable where payment_id='fe550000-0000-4000-8000-000000000005'),
  (now() at time zone 'America/Sao_Paulo')::date,'Provider timestamp uses the business date, not the connection timezone');
select is((select count(*) from public.financial_transactions t join public.accounts_receivable r on r.id=t.receivable_id
 where r.payment_id in ('fe550000-0000-4000-8000-000000000003','fe550000-0000-4000-8000-000000000005')),
  2::bigint,'Each approved fixture creates exactly one financial transaction');
select * from finish();
rollback;


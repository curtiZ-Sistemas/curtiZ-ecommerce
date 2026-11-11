begin;
create extension if not exists pgtap with schema extensions;
select plan(11);
select diag('orders table ACL: ' || coalesce((select relacl::text from pg_class where oid = 'public.orders'::regclass), '<default>'));
select diag('encrypted CPF column ACL: ' || coalesce((select attacl::text from pg_attribute where attrelid = 'public.orders'::regclass and attname = 'cpf_ciphertext'), '<default>'));
select diag('security migration recorded: ' || exists(select 1 from supabase_migrations.schema_migrations where version = '20261110153802')::text);

insert into auth.users(id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('ea100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cpf-one@example.invalid', '{}', '{}', now(), now()),
  ('ea100000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cpf-two@example.invalid', '{}', '{}', now(), now());
update public.profiles set status = 'active'
where id in ('ea100000-0000-4000-8000-000000000001', 'ea100000-0000-4000-8000-000000000002');

insert into public.orders(id, public_code, customer_id, customer_email_snapshot, customer_name_snapshot,
  status, payment_status, subtotal, grand_total, shipping_address_snapshot, cpf_ciphertext)
values
  ('ea200000-0000-4000-8000-000000000001', 'CPF-TEST-ONE', 'ea100000-0000-4000-8000-000000000001', 'cpf-one@example.invalid', 'One', 'pending_payment', 'pending', 50, 50, '{}', 'fixture-only'),
  ('ea200000-0000-4000-8000-000000000002', 'CPF-TEST-TWO', 'ea100000-0000-4000-8000-000000000002', 'cpf-two@example.invalid', 'Two', 'pending_payment', 'pending', 50, 50, '{}', 'fixture-only');

select ok(not has_column_privilege('anon', 'public.orders', 'cpf_ciphertext', 'select'),
  'anonymous users cannot select encrypted CPF');
select ok(not has_column_privilege('authenticated', 'public.orders', 'cpf_ciphertext', 'select'),
  'authenticated users cannot select encrypted CPF');
select ok(has_column_privilege('service_role', 'public.orders', 'cpf_ciphertext', 'select'),
  'server service retains encrypted CPF access');
select ok(has_column_privilege('authenticated', 'public.orders', 'public_code', 'select'),
  'authenticated users retain access to order codes under RLS');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"ea100000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select count(*) from public.orders where id = 'ea200000-0000-4000-8000-000000000001'),
  1::bigint, 'customer can still read their own permitted order columns');
select is((select count(*) from public.orders where id = 'ea200000-0000-4000-8000-000000000002'),
  0::bigint, 'customer cannot read another customer order');
select is((select count(*) from public.reporting_orders where id = 'ea200000-0000-4000-8000-000000000001'),
  1::bigint, 'reporting view remains readable under ownership RLS');
select is((select cpf_ciphertext from public.reporting_orders where id = 'ea200000-0000-4000-8000-000000000001'),
  null::text, 'reporting view never returns encrypted CPF');
select throws_ok($$select cpf_ciphertext from public.orders limit 1$$, '42501', null,
  'direct database queries cannot read encrypted CPF');
select throws_ok($$select * from public.orders limit 1$$, '42501', null,
  'selecting every column cannot bypass the encrypted CPF restriction');
reset role;

set local role service_role;
select is((select cpf_ciphertext from public.orders where id = 'ea200000-0000-4000-8000-000000000001'),
  'fixture-only', 'server service can still read encrypted CPF');
reset role;

select * from finish();
rollback;


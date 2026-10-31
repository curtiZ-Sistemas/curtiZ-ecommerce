begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
('cf000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cpf-one@test.local','{}','{"full_name":"CPF One"}',now(),now()),
('cf000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cpf-two@test.local','{}','{"full_name":"CPF Two"}',now(),now());
update public.profiles set status = 'active' where id in
('cf000000-0000-4000-8000-000000000001','cf000000-0000-4000-8000-000000000002');

set local role service_role;
select lives_ok($$select public.save_customer_checkout_identity('cf000000-0000-4000-8000-000000000001','cipher-one','4725')$$, 'Server saves customer one');
select lives_ok($$select public.save_customer_checkout_identity('cf000000-0000-4000-8000-000000000002','cipher-two','8909')$$, 'Server saves customer two');
select is(public.get_customer_checkout_identity('cf000000-0000-4000-8000-000000000001')->>'cpfCiphertext', 'cipher-one', 'Read is scoped to the server-verified customer');
select lives_ok($$select public.save_customer_checkout_identity('cf000000-0000-4000-8000-000000000001','cipher-changed','8909')$$, 'Server changes CPF');
select is(public.get_customer_checkout_identity('cf000000-0000-4000-8000-000000000001')->>'cpfCiphertext', 'cipher-changed', 'Ciphertext is replaced');
select is((select cpf_last_four::text from public.profiles where id = 'cf000000-0000-4000-8000-000000000001'), '8909', 'Profile last4 is updated');
select is(public.get_customer_checkout_identity('cf000000-0000-4000-8000-000000000001')->>'cpfLastFour', '8909', 'Private last4 is updated');
select throws_ok($$select public.save_customer_checkout_identity('cf000000-0000-4000-8000-000000000001','cipher-invalid',null)$$, '22023', 'invalid_customer_identity', 'Incomplete identity is rejected');
reset role;

-- Force failure after the private upsert, at the profile write, to exercise rollback.
create function pg_temp.reject_test_cpf_update() returns trigger language plpgsql as $$
begin
  if new.cpf_last_four = '9999' then raise exception 'isolated_profile_write_failure'; end if;
  return new;
end;
$$;
create trigger test_reject_cpf_update before update on public.profiles
for each row execute function pg_temp.reject_test_cpf_update();
set local role service_role;
select throws_ok($$select public.save_customer_checkout_identity('cf000000-0000-4000-8000-000000000001','cipher-failed','9999')$$, 'P0001', 'isolated_profile_write_failure', 'Profile failure rejects the complete update');
select is(public.get_customer_checkout_identity('cf000000-0000-4000-8000-000000000001')->>'cpfCiphertext', 'cipher-changed', 'Failed update preserves the old ciphertext');
select is((select cpf_last_four::text from public.profiles where id = 'cf000000-0000-4000-8000-000000000001'), '8909', 'Failed update preserves profile last4');
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"cf000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select throws_ok($$select public.get_customer_checkout_identity('cf000000-0000-4000-8000-000000000002')$$, '42501', null, 'Customer cannot retrieve another customer ciphertext');
select throws_ok($$select public.get_customer_checkout_identity('cf000000-0000-4000-8000-000000000001')$$, '42501', null, 'Ciphertext is not exposed even to its owner in the browser');
select throws_ok($$select public.save_customer_checkout_identity('cf000000-0000-4000-8000-000000000002','forged','0000')$$, '42501', null, 'Customer cannot change another identity');
select throws_ok($$select public.save_my_checkout_identity('forged','0000')$$, '42501', null, 'Direct ciphertext writes cannot bypass backend CPF validation');
select throws_ok($$select * from private.customer_checkout_identity$$, '42501', null, 'Private table remains inaccessible');
reset role;
set local role anon;
select throws_ok($$select public.get_customer_checkout_identity('cf000000-0000-4000-8000-000000000001')$$, '42501', null, 'Anonymous caller cannot read identity');
select throws_ok($$select public.save_customer_checkout_identity('cf000000-0000-4000-8000-000000000001','forged','0000')$$, '42501', null, 'Anonymous caller cannot change identity');
reset role;
update public.profiles set status = 'disabled' where id = 'cf000000-0000-4000-8000-000000000001';
set local role service_role;
select is(public.get_customer_checkout_identity('cf000000-0000-4000-8000-000000000001'), null::jsonb, 'Disabled customer identity is unavailable');
select throws_ok($$select public.save_customer_checkout_identity('cf000000-0000-4000-8000-000000000001','cipher','0000')$$, '42501', 'customer_not_available', 'Disabled customer cannot update identity');
reset role;

select * from finish();
rollback;

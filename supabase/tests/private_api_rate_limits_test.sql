begin;
select plan(9);

insert into auth.users(id,email,encrypted_password,email_confirmed_at,raw_user_meta_data)
values
 ('da000000-0000-4000-8000-000000000001','bff-one@example.invalid','',now(),'{"full_name":"BFF One"}'),
 ('da000000-0000-4000-8000-000000000002','bff-two@example.invalid','',now(),'{"full_name":"BFF Two"}');
update public.profiles set status='active' where id in
 ('da000000-0000-4000-8000-000000000001','da000000-0000-4000-8000-000000000002');

select ok(not has_function_privilege('anon','public.consume_private_api_rate_limit(text)','execute'), 'Anonymous cannot consume authenticated budgets');
select ok(has_function_privilege('authenticated','public.consume_private_api_rate_limit(text)','execute'), 'Authenticated can call the fixed-budget RPC');
select ok(not has_table_privilege('authenticated','private.auth_rate_limits','select,insert,update,delete'), 'Clients cannot read or reset budgets');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"da000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',true);
select ok((select bool_and(public.consume_private_api_rate_limit('mfa_verify')) from generate_series(1,10)), 'Own first ten verification attempts are allowed');
select is(public.consume_private_api_rate_limit('mfa_verify'),false,'Eleventh attempt is denied');
select is(public.consume_private_api_rate_limit('mfa_read'),true,'Reading state has an independent budget');
select throws_ok($$select public.consume_private_api_rate_limit('arbitrary')$$,'22023','Invalid operation','Callers cannot choose arbitrary rate scopes');
select set_config('request.jwt.claims','{"sub":"da000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}',true);
select is(public.consume_private_api_rate_limit('mfa_verify'),true,'Another user retains their own budget');
reset role;
update public.profiles set status='suspended' where id='da000000-0000-4000-8000-000000000002';
set local role authenticated;
select throws_ok($$select public.consume_private_api_rate_limit('mfa_read')$$,'42501','Access denied','Suspended users are denied');
reset role;
select * from finish();
rollback;

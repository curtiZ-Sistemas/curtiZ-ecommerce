begin;
select plan(9);

select is(public.consume_auth_rate_limit('login',repeat('a',64),2,900),
  '{"status":"allowed","remaining":1}'::jsonb,'First attempt is allowed');
select is(public.consume_auth_rate_limit('login',repeat('a',64),2,900),
  '{"status":"allowed","remaining":0}'::jsonb,'Account consumes only its own remaining budget');
select is(public.consume_auth_rate_limit('login',repeat('a',64),2,900)->>'status',
  'blocked','The same account is blocked after its limit');
select cmp_ok((public.consume_auth_rate_limit('login',repeat('a',64),2,900)->>'retryAfterSeconds')::integer,
  '>',0,'A real denial returns an actionable retry interval');
select is(public.consume_auth_rate_limit('login',repeat('b',64),2,900),
  '{"status":"allowed","remaining":1}'::jsonb,'Another account keeps an independent budget');
select throws_ok($$select public.consume_auth_rate_limit('login','plain-email@example.invalid',2,900)$$,
  '22023','invalid rate limit parameters','Plain identifiers are rejected by the database contract');
select is(has_function_privilege('authenticated','public.consume_auth_rate_limit(text,text,integer,integer)','execute'),
  false,'Browser sessions cannot choose or consume arbitrary authentication keys');
select is(has_function_privilege('service_role','public.consume_auth_rate_limit(text,text,integer,integer)','execute'),
  true,'Only the trusted authentication API can consume account budgets');
select is(public.auth_rate_limit_contract_version(),2,'Readiness exposes the expected non-sensitive contract version');

select * from finish();
rollback;

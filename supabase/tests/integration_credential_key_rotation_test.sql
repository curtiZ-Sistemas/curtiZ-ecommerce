-- Isolated migrated database only; all fixtures roll back.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select ok(has_function_privilege('service_role',
  'public.replace_integration_credential_ciphertext(text,text,text,text,text,text)', 'execute'),
  'Backend can rotate ciphertexts');
select ok(not has_function_privilege('anon',
  'public.replace_integration_credential_ciphertext(text,text,text,text,text,text)', 'execute'),
  'Anonymous callers cannot rotate credentials');
select ok(not has_function_privilege('authenticated',
  'public.replace_integration_credential_ciphertext(text,text,text,text,text,text)', 'execute'),
  'Authenticated clients cannot rotate credentials');
select ok(not has_table_privilege('authenticated', 'private.integration_credentials', 'select,update'),
  'Ciphertexts remain private');
select throws_ok($$select public.replace_integration_credential_ciphertext('bling', 'sandbox',
  'a', 'r', 'v2.222222222222.AAAA.GGGG', 'v2.222222222222.CCCC.HHHH')$$,
  '22023', 'provider does not support credential key rotation', 'Other integrations retain their own ciphertext format');

insert into private.integration_credentials(provider, environment, access_token_ciphertext,
  refresh_token_ciphertext, access_token_expires_at, refresh_token_expires_at, refresh_lock_id,
  refresh_locked_until, last_error_code, created_at)
values
  ('melhorenvio', 'sandbox', 'v1.AAAA.BBBB', 'v1.CCCC.DDDD', '2099-01-01', '2099-02-01',
   'ab000000-0000-4000-8000-000000000001', '2099-03-01', 'preserved-test-error', '2026-01-01'),
  ('melhorenvio', 'production', 'v1.AAAA.BBBB', 'v1.CCCC.DDDD', '2099-01-01', null,
   null, null, null, '2026-01-01');
create temporary table credential_snapshot as
select to_jsonb(c) - 'access_token_ciphertext' - 'refresh_token_ciphertext' - 'updated_at' as metadata
from private.integration_credentials c where provider = 'melhorenvio' and environment = 'sandbox';

set local role service_role;
select ok(public.replace_integration_credential_ciphertext('melhorenvio', 'sandbox',
  'v1.AAAA.BBBB', 'v1.CCCC.DDDD', 'v2.111111111111.AAAA.EEEE', 'v2.111111111111.CCCC.FFFF'),
  'Matching pair rotates atomically through backend RPC');
select is(public.replace_integration_credential_ciphertext('melhorenvio', 'sandbox',
  'v1.AAAA.BBBB', 'v1.CCCC.DDDD', 'v2.222222222222.AAAA.GGGG', 'v2.222222222222.CCCC.HHHH'), false,
  'Second stale reader cannot replace the winner');
reset role;
select is((select access_token_ciphertext from private.integration_credentials
  where provider = 'melhorenvio' and environment = 'sandbox'), 'v2.111111111111.AAAA.EEEE',
  'Winning access ciphertext is preserved');
select is((select refresh_token_ciphertext from private.integration_credentials
  where provider = 'melhorenvio' and environment = 'sandbox'), 'v2.111111111111.CCCC.FFFF',
  'Winning refresh ciphertext is preserved');
select is((select to_jsonb(c) - 'access_token_ciphertext' - 'refresh_token_ciphertext' - 'updated_at'
  from private.integration_credentials c where provider = 'melhorenvio' and environment = 'sandbox'),
  (select metadata from credential_snapshot), 'Expiry, status, locks and other metadata remain unchanged');
select is((select access_token_ciphertext from private.integration_credentials
  where provider = 'melhorenvio' and environment = 'production'), 'v1.AAAA.BBBB',
  'Sandbox rotation cannot modify production');

-- A refresh completing after a reader loaded the old row wins over that reader's rotation.
select public.save_integration_credential('melhorenvio', 'sandbox',
  'v2.333333333333.AAAA.IIII', 'v2.333333333333.CCCC.JJJJ', '2099-04-01', '2099-05-01');
select is(public.replace_integration_credential_ciphertext('melhorenvio', 'sandbox',
  'v2.111111111111.AAAA.EEEE', 'v2.111111111111.CCCC.FFFF',
  'v2.222222222222.AAAA.GGGG', 'v2.222222222222.CCCC.HHHH'), false,
  'Stale rotation cannot overwrite refreshed OAuth tokens');
select is((select access_token_expires_at from private.integration_credentials
  where provider = 'melhorenvio' and environment = 'sandbox'), '2099-04-01'::timestamptz,
  'Stale rotation preserves renewed expiry');
select is(public.replace_integration_credential_ciphertext('melhorenvio', 'sandbox',
  'v2.333333333333.AAAA.IIII', 'wrong-refresh',
  'v2.222222222222.AAAA.GGGG', 'v2.222222222222.CCCC.HHHH'), false,
  'Both expected ciphertexts must match');
select throws_ok($$select public.replace_integration_credential_ciphertext('melhorenvio', 'sandbox',
  'v2.333333333333.AAAA.IIII', 'v2.333333333333.CCCC.JJJJ',
  'v2.222222222222.AAAA.GGGG', 'invalid')$$, '22023',
  'integration credential ciphertext must use the current format', 'Malformed refresh aborts the entire update');
select is((select access_token_ciphertext from private.integration_credentials
  where provider = 'melhorenvio' and environment = 'sandbox'), 'v2.333333333333.AAAA.IIII',
  'Partial failure preserves both tokens');
update private.integration_credentials set status = 'disconnected'
where provider = 'melhorenvio' and environment = 'sandbox';
select is(public.replace_integration_credential_ciphertext('melhorenvio', 'sandbox',
  'v2.333333333333.AAAA.IIII', 'v2.333333333333.CCCC.JJJJ',
  'v2.222222222222.AAAA.GGGG', 'v2.222222222222.CCCC.HHHH'), false,
  'Rotation does not restore a disconnected credential');

set local role authenticated;
select throws_ok($$select public.replace_integration_credential_ciphertext('melhorenvio', 'sandbox',
  'a', 'r', 'v2.222222222222.AAAA.GGGG', 'v2.222222222222.CCCC.HHHH')$$,
  '42501', null, 'Direct client execution is denied');
reset role;
select * from finish();
rollback;

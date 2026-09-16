begin;
select plan(8);

insert into auth.users(id,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
values ('ab000000-0000-4000-8000-000000000001','stale-role@example.invalid','',now(),
  '{"role":"admin"}','{"full_name":"Stale Role"}');
update public.profiles set status='active' where id='ab000000-0000-4000-8000-000000000001';
delete from public.user_roles where user_id='ab000000-0000-4000-8000-000000000001';
insert into public.user_roles(user_id,role) values('ab000000-0000-4000-8000-000000000001','customer');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"ab000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","app_metadata":{"role":"admin"}}', true);
select is(private.current_app_role(),'customer'::public.app_role,'Role atual do banco prevalece sobre admin antigo no JWT');
select is(private.user_has_role('admin'::public.app_role),false,'JWT antigo não recria role administrativa');
select is(private.has_permission('users.read'),false,'JWT antigo não concede permissão administrativa');
select is(public.consume_private_api_rate_limit('checkout_quote'),true,'Checkout possui orçamento autenticado');
select is(public.consume_private_api_rate_limit('payment_attempt'),true,'Pagamento possui orçamento independente');
select throws_ok($$select public.consume_private_api_rate_limit('admin_mutation')$$,'42501','Access denied',
  'Cliente não consome nem contorna o orçamento de mutações internas');

reset role;
select is(has_function_privilege('anon','public.enforce_auth_rate_limit(text,text,integer,integer)','execute'),false,
  'Anonymous clients cannot create arbitrary persistent abuse keys');
select is(has_function_privilege('service_role','public.enforce_auth_rate_limit(text,text,integer,integer)','execute'),true,
  'Trusted authentication APIs can consume shared HMAC budgets');
select * from finish();
rollback;

begin;
create extension if not exists pgtap with schema extensions;
-- CI preloads safeupdate for this session as configured in ci.yml. The guard
-- assertion below must fail if that setup is missing; never silently skip it.
set local safeupdate.enabled='on';
select plan(15);

create temporary table runtime_safeupdate_guard(id integer primary key,value integer);
insert into runtime_safeupdate_guard values(1,1);
select throws_ok($$update pg_temp.runtime_safeupdate_guard set value=2$$,
  '21000','UPDATE requires a WHERE clause','The real safeupdate guard is active');

update private.bling_shipping_policy set invoice_required=false where singleton=true;
select lives_ok($$select public.set_bling_shipping_policy(false)$$,'Disabled fiscal policy works with safeupdate');
select ok((select not invoice_required from private.bling_shipping_policy where singleton=true),'Disabled policy stays disabled');
select lives_ok($$select public.set_bling_shipping_policy(true)$$,'Explicit fiscal activation works with safeupdate');
select ok((select invoice_required from private.bling_shipping_policy where singleton=true),'Fiscal activation is recorded');
select lives_ok($$select public.set_bling_shipping_policy(false)$$,'A disabled binding can be observed safely');
select ok((select invoice_required from private.bling_shipping_policy where singleton=true),'Fiscal activation remains sticky');

select lives_ok($$select public.sync_transactional_email_runtime(false,false)$$,'Disabled email runtime works with safeupdate');
select ok((select not enabled from private.transactional_email_runtime where singleton=true),'Disabled mail does not activate');
select lives_ok($$select public.sync_transactional_email_runtime(true,true)$$,'Ready email runtime works with safeupdate');
select ok((select enabled and activated_at is not null from private.transactional_email_runtime where singleton=true),'Ready mail records activation');
select lives_ok($$select public.sync_transactional_email_runtime(false,false)$$,'Email runtime can be disabled again safely');
select ok((select not enabled from private.transactional_email_runtime where singleton=true),'Email runtime is disabled again');
select ok(not has_function_privilege('anon','public.set_bling_shipping_policy(boolean)','execute')
  and not has_function_privilege('authenticated','public.sync_transactional_email_runtime(boolean,boolean)','execute'),
  'Public callers cannot change private runtime');
select ok(has_function_privilege('service_role','public.set_bling_shipping_policy(boolean)','execute')
  and has_function_privilege('service_role','public.sync_transactional_email_runtime(boolean,boolean)','execute'),
  'Service role retains runtime execution');

select * from finish();
rollback;

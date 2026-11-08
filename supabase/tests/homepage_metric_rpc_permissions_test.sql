begin;
create extension if not exists pgtap with schema extensions;
select plan(3);
select ok(not has_function_privilege('anon', 'public.record_homepage_metric(uuid,text,text,text)', 'execute'), 'anonymous callers cannot write metrics directly');
select ok(not has_function_privilege('authenticated', 'public.record_homepage_metric(uuid,text,text,text)', 'execute'), 'authenticated callers cannot write metrics directly');
select ok(has_function_privilege('service_role', 'public.record_homepage_metric(uuid,text,text,text)', 'execute'), 'the server can record metrics');
select * from finish();
rollback;

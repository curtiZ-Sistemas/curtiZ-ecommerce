begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

insert into auth.users(id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('a0700000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'mfa-test@example.invalid', '{}', '{"full_name":"MFA Test"}', now(), now());
insert into public.user_roles(user_id, role) values ('a0700000-0000-4000-8000-000000000001', 'manager') on conflict do nothing;
update public.profiles set status = 'active' where id = 'a0700000-0000-4000-8000-000000000001';
-- Explicit fixture permissions keep the test independent of role seed changes.
insert into public.user_permission_overrides(user_id, permission_id, allowed, reason, created_by)
select 'a0700000-0000-4000-8000-000000000001', id, true, 'Isolated MFA test', 'a0700000-0000-4000-8000-000000000001' from public.permissions
where code in ('users.read', 'audit.read', 'products.update')
on conflict (user_id, permission_id) do update set allowed = true;

insert into public.audit_logs(entity_type, entity_id, action, reason, created_at)
select 'profiles', 'a0700000-0000-4000-8000-000000000002', 'update_access', 'busy-user', now() - n * interval '1 second'
from generate_series(1, 1100) n;
insert into public.audit_logs(entity_type, entity_id, action, reason, created_at)
values ('profiles', 'a0700000-0000-4000-8000-000000000003', 'update_access', 'older-user', now() - interval '2 days');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0700000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}', true);
select ok(private.has_permission('products.update'), 'MFA disabled preserves permissions');
select is((select count(*) from public.latest_user_access_history(array['a0700000-0000-4000-8000-000000000002','a0700000-0000-4000-8000-000000000003']::uuid[])), 2::bigint, 'one result per user despite more than 1000 events');
select is((select reason from public.latest_user_access_history(array['a0700000-0000-4000-8000-000000000003']::uuid[])), 'older-user', 'older user history is not globally truncated');
select is((select count(*) from public.latest_user_access_history(array['a0700000-0000-4000-8000-000000000004']::uuid[])), 0::bigint, 'no event is an empty result');

reset role;
update private.internal_security_settings set require_internal_mfa = true;
set local role authenticated;
select ok(not private.has_permission('products.update'), 'aal1 cannot use an allowed override');
select ok(not private.user_has_role('manager'), 'aal1 cannot use internal role helper');
select throws_ok($$select private.require_permission('products.update')$$, '42501', 'permission denied', 'protected RPC permission rejects aal1');
select throws_ok($$select * from public.latest_user_access_history('{}'::uuid[])$$, '42501', 'permission denied', 'history rejects aal1');
select is((select count(*) from public.audit_logs where reason = 'older-user'), 0::bigint, 'RLS hides internal history from aal1');
select throws_ok($$update private.internal_security_settings set require_internal_mfa = false$$, '42501', null, 'API role cannot disable MFA');

select set_config('request.jwt.claims', '{"sub":"a0700000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
select ok(private.has_permission('products.update'), 'aal2 retains permission');
select ok(private.user_has_role('manager'), 'aal2 retains internal role');
select is((select count(*) from public.audit_logs where reason = 'older-user'), 1::bigint, 'RLS allows authorized aal2');

reset role;
delete from public.user_roles where user_id = 'a0700000-0000-4000-8000-000000000001' and role in ('admin','manager','technical','operational');
insert into public.user_roles(user_id,role) values ('a0700000-0000-4000-8000-000000000001','representative') on conflict do nothing;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0700000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}', true);
select ok(private.user_has_role('representative'), 'representative role does not require internal MFA');
select is((select count(*) from public.profiles where id = auth.uid()), 1::bigint, 'own profile remains accessible');
select * from finish();
rollback;

begin;
select no_plan();
create temporary table matrix_users(role public.app_role,user_id uuid);
insert into matrix_users values
  ('admin','f1000000-0000-4000-8000-000000000001'),('operational','f1000000-0000-4000-8000-000000000002'),
  ('manager','f1000000-0000-4000-8000-000000000003'),('technical','f1000000-0000-4000-8000-000000000004');
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
select user_id,role::text || '-matrix@example.invalid','{}','{"full_name":"Matrix Fixture"}' from matrix_users;
update public.profiles set status='active' where id in (select user_id from matrix_users);
delete from public.user_roles where user_id in (select user_id from matrix_users);
insert into public.user_roles(user_id,role) select user_id,role from matrix_users;
create temporary table matrix_expected as
select users.role,users.user_id,permission.code,
  exists(select 1 from public.role_permissions rp where rp.role=users.role and rp.permission_id=permission.id) as allowed
from matrix_users users cross join public.permissions permission;
grant select on matrix_expected,matrix_users to authenticated;
create function public.test_matrix_permission(actor uuid,permission_code text) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
  perform pg_catalog.set_config('request.jwt.claims',pg_catalog.jsonb_build_object('sub',actor,'role','authenticated',
    'aal','aal2','app_metadata',pg_catalog.jsonb_build_object('role','admin'))::text,true);
  return public.has_permission(permission_code);
end;
$$;
grant execute on function public.test_matrix_permission(uuid,text) to authenticated;
set local role authenticated;
select is(
  public.test_matrix_permission(expected.user_id,expected.code),
  expected.allowed,expected.role::text || ' follows current permission matrix: ' || expected.code
) from matrix_expected expected;
reset role;
-- The same unexpired admin JWT loses access immediately after its DB assignment is revoked.
select set_config('request.jwt.claims','{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","app_metadata":{"role":"admin"}}',true);
delete from public.user_roles where user_id='f1000000-0000-4000-8000-000000000001';
insert into public.user_roles(user_id,role) values('f1000000-0000-4000-8000-000000000001','customer');
set local role authenticated;
select is(private.current_app_role(),'customer'::public.app_role,'Revocation overrides the same old admin JWT');
select is(public.has_permission('users.read'),false,'Revoked admin cannot read users');
select is(public.has_permission('users.permissions.manage'),false,'Revoked admin cannot restore its own permissions');
reset role;
select * from finish();
rollback;

-- Authentication and banner regression fixtures only; all changes roll back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);
insert into auth.users(id,email,raw_user_meta_data) values
 ('ab120000-0000-4000-8000-000000000001','reconcile-one@example.invalid','{"full_name":"   "}'),
 ('ab120000-0000-4000-8000-000000000002','reconcile-two@example.invalid','{"full_name":"  Nome de teste  "}');
select is((select full_name from public.profiles where id='ab120000-0000-4000-8000-000000000001'),'Cliente Curtiz','A whitespace-only signup name receives the existing fallback');
select is((select full_name from public.profiles where id='ab120000-0000-4000-8000-000000000002'),'Nome de teste','Signup names are trimmed');
select is((select count(*) from public.user_roles where user_id='ab120000-0000-4000-8000-000000000001' and role='customer'),1::bigint,'Signup creates the customer role once');
update public.profiles set full_name='Nome preservado',status='suspended'
where id='ab120000-0000-4000-8000-000000000001';
create temporary table replay_auth_subject(id uuid,email text,raw_user_meta_data jsonb);
create trigger replay_profile_creation after insert on replay_auth_subject
for each row execute function private.handle_new_user();
select lives_ok($$insert into replay_auth_subject values ('ab120000-0000-4000-8000-000000000001','replayed@example.invalid','{"full_name":"Nome externo"}')$$,'A repeated profile creation is idempotent');
select is((select full_name from public.profiles where id='ab120000-0000-4000-8000-000000000001'),'Nome preservado','A replay does not overwrite the existing profile');
select is((select status::text from public.profiles where id='ab120000-0000-4000-8000-000000000001'),'suspended','A replay cannot reactivate a suspended profile');
select is((select count(*) from public.user_roles where user_id='ab120000-0000-4000-8000-000000000001' and role='customer'),1::bigint,'A replay does not duplicate roles');
create temporary table banner_destination_fixture(destination_type text,destination_url text,destination_type_mobile text,destination_url_mobile text);
create trigger check_fixture_destination before insert on banner_destination_fixture
for each row execute function private.validate_banner_destination();
select lives_ok($$insert into banner_destination_fixture values ('category',null,null,null)$$,'An optional absent destination remains supported');
select throws_ok($$insert into banner_destination_fixture values ('category','/produtos'||chr(92)||'login',null,null)$$,'23514','invalid banner destination','Backslashes are rejected by the database');
select throws_ok($$insert into banner_destination_fixture values ('category','/produtos%0a',null,null)$$,'23514','invalid banner destination','Encoded line breaks are rejected');
insert into public.system_settings(key,value,is_public) values ('banner_external_hosts','["example.invalid"]',false)
on conflict (key) do update set value=excluded.value;
select throws_ok($$insert into banner_destination_fixture values ('external_url','https://outside.invalid/catalogo',null,null)$$,'42501','external banner host is not authorized','An unapproved external host is rejected');
select lives_ok($$insert into banner_destination_fixture values ('external_url','https://example.invalid/catalogo',null,null)$$,'An approved HTTPS host remains supported');
select * from finish();
rollback;

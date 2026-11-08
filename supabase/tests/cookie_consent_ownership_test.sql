begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
values ('fa000000-0000-4000-8000-000000000001','consent-owner@example.invalid','{}','{}'),
       ('fa000000-0000-4000-8000-000000000005','consent-other@example.invalid','{}','{}');
insert into public.cookie_consents(id,user_id,policy_version,categories,origin,revoked)
values ('fa000000-0000-4000-8000-000000000002','fa000000-0000-4000-8000-000000000001',
  'test','{"essential":true,"analytics":false}','banner',false);

set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
select throws_ok($$select public.record_cookie_consent('fa000000-0000-4000-8000-000000000002','test','{"essential":true,"analytics":true}','preferences',false)$$,
  '23505',null,'Anonymous caller cannot overwrite another user consent');
select throws_ok($$select public.record_cookie_consent('fa000000-0000-4000-8000-000000000002','test','{"essential":true,"analytics":false}','banner',false)$$,
  '23505',null,'Anonymous caller cannot impersonate an identical authenticated retry');
select lives_ok($$select public.record_cookie_consent('fa000000-0000-4000-8000-000000000003','test','{"essential":true}','banner',false)$$,
  'Anonymous caller can record new consent');
select lives_ok($$select public.record_cookie_consent('fa000000-0000-4000-8000-000000000003','test','{"essential":true}','banner',false)$$,
  'A retry with the same owner and payload is idempotent');
select throws_ok($$select public.record_cookie_consent('fa000000-0000-4000-8000-000000000003','test','{"essential":true,"analytics":true}','preferences',false)$$,
  '23505',null,'An existing anonymous consent cannot be changed');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"fa000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
select throws_ok($$select public.record_cookie_consent('fa000000-0000-4000-8000-000000000002','test','{"essential":true,"analytics":true}','preferences',false)$$,
  '23505',null,'Another authenticated user cannot overwrite the original consent');
select throws_ok($$select public.record_cookie_consent('fa000000-0000-4000-8000-000000000002','test','{"essential":true,"analytics":false}','banner',false)$$,
  '23505',null,'Another user cannot impersonate an identical authenticated retry');
select set_config('request.jwt.claims','{"sub":"fa000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select lives_ok($$select public.record_cookie_consent('fa000000-0000-4000-8000-000000000002','test','{"essential":true,"analytics":false}','banner',false)$$,
  'The owner can safely retry the original consent');
select lives_ok($$select public.record_cookie_consent('fa000000-0000-4000-8000-000000000004','test','{"essential":true}','preferences',false)$$,
  'Authenticated user can record updated preferences with a new identifier');
reset role;
select is((select categories->>'analytics' from public.cookie_consents where id='fa000000-0000-4000-8000-000000000002'),
  'false','Original consent remains unchanged');
select * from finish();
rollback;

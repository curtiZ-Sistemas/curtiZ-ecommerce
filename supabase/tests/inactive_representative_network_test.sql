begin;
create extension if not exists pgtap with schema extensions;
select plan(4);
insert into auth.users(id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('fa100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'network-owner@example.invalid', '{}', '{}', now(), now()),
  ('fa100000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'network-member@example.invalid', '{}', '{}', now(), now()),
  ('fa100000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'network-other@example.invalid', '{}', '{}', now(), now());
update public.profiles set status='active' where id in ('fa100000-0000-4000-8000-000000000001','fa100000-0000-4000-8000-000000000002','fa100000-0000-4000-8000-000000000003');
insert into public.representative_applications(id,user_id) values
  ('fa200000-0000-4000-8000-000000000001','fa100000-0000-4000-8000-000000000001'),
  ('fa200000-0000-4000-8000-000000000002','fa100000-0000-4000-8000-000000000002');
insert into public.representatives(id,user_id,application_id,status) values
  ('fa300000-0000-4000-8000-000000000001','fa100000-0000-4000-8000-000000000001','fa200000-0000-4000-8000-000000000001','active'),
  ('fa300000-0000-4000-8000-000000000002','fa100000-0000-4000-8000-000000000002','fa200000-0000-4000-8000-000000000002','active');
insert into public.representative_network_closure(ancestor_id,descendant_id,depth)
values ('fa300000-0000-4000-8000-000000000001','fa300000-0000-4000-8000-000000000002',1);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"fa100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is((select count(*) from public.get_representative_network()),1::bigint,'active representative reads their own network');
select set_config('request.jwt.claims','{"sub":"fa100000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select is((select count(*) from public.get_representative_network()),0::bigint,'unrelated user cannot read that network');
reset role;
update public.profiles set status='suspended' where id='fa100000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"fa100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is((select count(*) from public.get_representative_network()),0::bigint,'suspended profile cannot read the network');
reset role;
update public.profiles set status='active',account_closed_at=now() where id='fa100000-0000-4000-8000-000000000001';
set local role authenticated;
select is((select count(*) from public.get_representative_network()),0::bigint,'closed profile cannot read the network');
reset role;
select * from finish();
rollback;


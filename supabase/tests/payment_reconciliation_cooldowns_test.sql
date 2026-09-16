begin;
select plan(7);
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
values ('ca000000-0000-4000-8000-000000000001','cooldown-a@example.invalid','{}','{"full_name":"Cooldown A"}'),
       ('ca000000-0000-4000-8000-000000000002','cooldown-b@example.invalid','{}','{"full_name":"Cooldown B"}');
update public.profiles set status='active' where id in
  ('ca000000-0000-4000-8000-000000000001','ca000000-0000-4000-8000-000000000002');
delete from public.user_roles where user_id in
  ('ca000000-0000-4000-8000-000000000001','ca000000-0000-4000-8000-000000000002');
insert into public.user_roles(user_id,role) values
  ('ca000000-0000-4000-8000-000000000001','customer'),('ca000000-0000-4000-8000-000000000002','customer');
insert into public.orders(id,customer_id,customer_email_snapshot,customer_name_snapshot,status,subtotal,grand_total,shipping_address_snapshot)
values ('cb000000-0000-4000-8000-000000000001','ca000000-0000-4000-8000-000000000001','cooldown-a@example.invalid','Cooldown A','pending_payment',50,50,'{}'),
       ('cb000000-0000-4000-8000-000000000002','ca000000-0000-4000-8000-000000000002','cooldown-b@example.invalid','Cooldown B','pending_payment',50,50,'{}');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"ca000000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"role":"admin"}}',true);
select is(public.claim_payment_reconciliation('cb000000-0000-4000-8000-000000000001'),true,
  'The current owner can explicitly claim provider reconciliation');
select is(public.claim_payment_reconciliation('cb000000-0000-4000-8000-000000000001'),false,
  'Immediate repeated reconciliation is blocked by a shared resource cooldown');
select throws_ok($$select public.claim_payment_reconciliation('cb000000-0000-4000-8000-000000000002')$$,
  '42501','Access denied','A stale admin JWT cannot reconcile a foreign order');
reset role;
update private.payment_reconciliation_cooldowns set next_allowed_at=now()-interval '1 second';
set local role authenticated;
select is(public.claim_payment_reconciliation('cb000000-0000-4000-8000-000000000001'),true,
  'The resource becomes available only after its cooldown');
reset role;
update public.profiles set status='suspended' where id='ca000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.claim_payment_reconciliation('cb000000-0000-4000-8000-000000000001')$$,
  '42501','Access denied','A suspended account cannot reconcile even its own order');
reset role;
select is(has_function_privilege('anon','public.claim_payment_reconciliation(uuid)','execute'),false,
  'Anonymous clients cannot claim provider work');
select is(has_function_privilege('authenticated','public.claim_payment_reconciliation(uuid)','execute'),true,
  'Authenticated access still passes database ownership and active-status checks');
select * from finish();
rollback;

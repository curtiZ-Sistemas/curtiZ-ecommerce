begin;
create extension if not exists pgtap with schema extensions;
select plan(5);
insert into auth.users(id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('ef100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'history-one@example.invalid', '{}', '{}', now(), now()),
  ('ef100000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'history-two@example.invalid', '{}', '{}', now(), now());
update public.profiles set status = 'active' where id in ('ef100000-0000-4000-8000-000000000001', 'ef100000-0000-4000-8000-000000000002');
insert into public.orders(id, public_code, customer_id, customer_email_snapshot, customer_name_snapshot, status, payment_status, subtotal, grand_total, shipping_address_snapshot)
values
  ('ef200000-0000-4000-8000-000000000001', 'HISTORY-ONE', 'ef100000-0000-4000-8000-000000000001', 'history-one@example.invalid', 'Fixture one', 'refund_pending', 'approved', 50, 50, '{}'),
  ('ef200000-0000-4000-8000-000000000002', 'HISTORY-TWO', 'ef100000-0000-4000-8000-000000000002', 'history-two@example.invalid', 'Fixture two', 'refund_pending', 'approved', 50, 50, '{}');
select ok(not has_function_privilege('anon', 'public.list_my_visible_orders(integer)', 'execute'), 'anonymous user cannot access the order history');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"ef100000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select ok(public.list_my_visible_orders(50) @> '[{"id":"ef200000-0000-4000-8000-000000000001"}]'::jsonb, 'active customer can read own order');
select ok(not (public.list_my_visible_orders(50) @> '[{"id":"ef200000-0000-4000-8000-000000000002"}]'::jsonb), 'customer cannot read another customer order');
reset role;
update public.profiles set account_closed_at = now() where id = 'ef100000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.list_my_visible_orders(50)$$, '42501', null, 'closed customer cannot read order history');
reset role;
update public.profiles set account_closed_at = null, status = 'suspended' where id = 'ef100000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.list_my_visible_orders(50)$$, '42501', null, 'suspended customer cannot read order history');
reset role;
select * from finish();
rollback;

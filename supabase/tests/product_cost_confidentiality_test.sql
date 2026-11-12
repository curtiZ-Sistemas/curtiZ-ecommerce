-- Regression contract for product costs. This test must run only against an
-- isolated database: production permissions have not yet been changed.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

select ok(not has_column_privilege('anon', 'public.products', 'cost_price', 'select'),
  'anonymous callers cannot read product cost');
select ok(not has_column_privilege('authenticated', 'public.products', 'cost_price', 'select'),
  'authenticated callers cannot read product cost directly');
select ok(not has_column_privilege('anon', 'public.product_variants', 'cost_override', 'select'),
  'anonymous callers cannot read variant cost');
select ok(not has_column_privilege('authenticated', 'public.product_variants', 'cost_override', 'select'),
  'authenticated callers cannot read variant cost directly');
select ok(has_column_privilege('service_role', 'public.products', 'cost_price', 'select'),
  'server service retains product cost access');
select ok(has_column_privilege('service_role', 'public.product_variants', 'cost_override', 'select'),
  'server service retains variant cost access');

set local role authenticated;
select throws_ok($$select cost_price from public.products limit 1$$, '42501', null,
  'direct product cost query is rejected');
select throws_ok($$select cost_override from public.product_variants limit 1$$, '42501', null,
  'direct variant cost query is rejected');
reset role;

select * from finish();
rollback;

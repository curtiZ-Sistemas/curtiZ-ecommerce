-- Keep financial reporting behind its existing security-definer functions.
-- A separate private view lets customer-facing reporting retain RLS without
-- granting customers access to order costs or estimated profit.
do $$
begin
  if exists (
    select 1 from pg_attribute
    where attrelid = 'public.orders'::regclass and attnum > 0 and not attisdropped
      and attname::text <> all(array['id','public_code','customer_id','customer_email_snapshot','customer_name_snapshot',
        'customer_phone_snapshot','cpf_ciphertext','cpf_last_four','status','payment_status','currency','subtotal',
        'discount_total','shipping_total','shipping_cost','fee_total','grand_total','cost_total','estimated_profit',
        'coupon_id','shipping_address_snapshot','commercial_rules_snapshot','risk_level','placed_at','created_at','updated_at'])
  ) then raise exception 'orders columns changed; review financial grants'; end if;
end;
$$;
create view private.reporting_orders_financial with (security_invoker = true) as
select id, public_code, customer_id, customer_email_snapshot, customer_name_snapshot,
  customer_phone_snapshot, null::text as cpf_ciphertext, cpf_last_four, status,
  payment_status, currency, subtotal, discount_total, shipping_total, shipping_cost,
  fee_total, grand_total, cost_total, estimated_profit, coupon_id,
  shipping_address_snapshot, commercial_rules_snapshot, risk_level, placed_at,
  created_at, updated_at
from public.orders
where (commercial_rules_snapshot ->> 'paymentMode') is distinct from 'test';
revoke all on private.reporting_orders_financial from public, anon, authenticated;

-- Replace only reviewed security-definer functions. Abort on unexpected drift,
-- rather than silently breaking an unknown consumer of the existing view.
do $$
declare f record; seen text[] := array[]::text[]; definition text;
begin
  for f in
    select p.oid, n.nspname, p.proname, p.prosecdef, p.proowner
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prokind = 'f'
      and pg_get_functiondef(p.oid) ilike '%public.reporting_orders%'
  loop
    if f.nspname <> 'public' or not f.prosecdef
       or f.proowner <> (select relowner from pg_class where oid = 'private.reporting_orders_financial'::regclass)
       or f.proname = any(seen) or f.proname not in (
      'admin_approved_sales_total_in_cents', 'financial_control_snapshot',
      'manager_dashboard_metrics', 'manager_strategic_metrics'
    ) then
      raise exception 'unexpected reporting_orders consumer: %', f.oid::regprocedure;
    end if;
    definition := pg_get_functiondef(f.oid);
    if position('public.reporting_orders' in definition) = 0 then
      raise exception 'unexpected reporting reference in %', f.oid::regprocedure;
    end if;
    execute replace(definition, 'public.reporting_orders', 'private.reporting_orders_financial');
    seen := array_append(seen, f.proname::text);
  end loop;
  if cardinality(seen) <> 4 then raise exception 'unexpected reporting functions: %', seen; end if;
end;
$$;

create or replace view public.reporting_orders with (security_invoker = true) as
select id, public_code, customer_id, customer_email_snapshot, customer_name_snapshot,
  customer_phone_snapshot, null::text as cpf_ciphertext, cpf_last_four, status,
  payment_status, currency, subtotal, discount_total, shipping_total,
  null::numeric(12,2) as shipping_cost, fee_total, grand_total,
  null::numeric(12,2) as cost_total, null::numeric(12,2) as estimated_profit, coupon_id,
  shipping_address_snapshot, commercial_rules_snapshot, risk_level, placed_at,
  created_at, updated_at
from public.orders
where (commercial_rules_snapshot ->> 'paymentMode') is distinct from 'test';

revoke select on public.orders from authenticated;
revoke select (shipping_cost, cost_total, estimated_profit) on public.orders from public, anon, authenticated;
grant select (
  id, public_code, customer_id, customer_email_snapshot, customer_name_snapshot,
  customer_phone_snapshot, cpf_last_four, status, payment_status, currency,
  subtotal, discount_total, shipping_total, fee_total, grand_total, coupon_id,
  shipping_address_snapshot, commercial_rules_snapshot, risk_level, placed_at,
  created_at, updated_at
) on public.orders to authenticated;
notify pgrst, 'reload schema';

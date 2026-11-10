-- RLS controls which orders are visible, but a table-wide SELECT also exposed
-- encrypted CPF values to every authenticated reader of an allowed order.
-- Preserve the existing public columns and leave service_role untouched.
revoke select on table public.orders from authenticated;
grant select (
  id, public_code, customer_id, customer_email_snapshot, customer_name_snapshot,
  customer_phone_snapshot, cpf_last_four, status, payment_status, currency,
  subtotal, discount_total, shipping_total, shipping_cost, fee_total, grand_total,
  cost_total, estimated_profit, coupon_id, shipping_address_snapshot,
  commercial_rules_snapshot, risk_level, placed_at, created_at, updated_at
) on public.orders to authenticated;

notify pgrst, 'reload schema';


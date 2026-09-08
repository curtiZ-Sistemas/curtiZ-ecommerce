-- Frete fixo temporário do checkout. O valor é imposto no banco antes da criação do pedido.
create or replace function private.apply_fixed_shipping_to_mercadopago_test_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.commercial_rules_snapshot ->> 'paymentProvider' = 'mercadopago'
    and new.commercial_rules_snapshot ->> 'paymentMode' = 'test' then
    new.shipping_total := 16.90;
    new.grand_total := new.subtotal + 16.90;
    new.commercial_rules_snapshot := coalesce(new.commercial_rules_snapshot, '{}'::jsonb)
      || jsonb_build_object(
        'shippingProvider', 'fixed_shipping',
        'shippingMethod', 'standard',
        'shippingAmount', 16.90
      );
  end if;
  return new;
end;
$$;

drop trigger if exists apply_fixed_shipping_to_mercadopago_test_order on public.orders;
create trigger apply_fixed_shipping_to_mercadopago_test_order
  before insert on public.orders
  for each row execute function private.apply_fixed_shipping_to_mercadopago_test_order();

revoke all on function private.apply_fixed_shipping_to_mercadopago_test_order()
  from public, anon, authenticated;

-- Corrige somente pedidos de teste pendentes que ainda não chegaram ao Mercado Pago.
update public.orders sale
set shipping_total = 16.90,
    grand_total = sale.subtotal + 16.90,
    commercial_rules_snapshot = coalesce(sale.commercial_rules_snapshot, '{}'::jsonb)
      || jsonb_build_object(
        'shippingProvider', 'fixed_shipping',
        'shippingMethod', 'standard',
        'shippingAmount', 16.90
      ),
    updated_at = now()
from public.payments payment
where payment.order_id = sale.id
  and payment.provider = 'mercadopago'
  and payment.provider_payment_id is null
  and payment.status = 'pending'
  and sale.status = 'pending_payment'
  and sale.shipping_total = 0
  and sale.commercial_rules_snapshot ->> 'paymentMode' = 'test';

update public.payments payment
set amount = sale.grand_total,
    updated_at = now()
from public.orders sale
where sale.id = payment.order_id
  and payment.provider = 'mercadopago'
  and payment.provider_payment_id is null
  and payment.status = 'pending'
  and sale.status = 'pending_payment'
  and sale.shipping_total = 16.90
  and sale.commercial_rules_snapshot ->> 'paymentMode' = 'test';

notify pgrst, 'reload schema';

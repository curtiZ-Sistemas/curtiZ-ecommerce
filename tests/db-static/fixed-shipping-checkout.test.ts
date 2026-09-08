import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/202609080004_fixed_shipping_checkout.sql",
  "utf8"
);

describe("frete fixo temporário do checkout", () => {
  it("impõe R$ 16,90 no banco e soma o valor ao subtotal", () => {
    expect(migration).toContain("new.shipping_total := 16.90");
    expect(migration).toContain("new.grand_total := new.subtotal + 16.90");
    expect(migration).toContain("'shippingProvider', 'fixed_shipping'");
    expect(migration).toContain("before insert on public.orders");
  });

  it("não altera pedidos que já chegaram ao provedor de pagamento", () => {
    expect(migration).toContain("payment.provider_payment_id is null");
    expect(migration).toContain("payment.status = 'pending'");
    expect(migration).toContain("sale.status = 'pending_payment'");
  });
});

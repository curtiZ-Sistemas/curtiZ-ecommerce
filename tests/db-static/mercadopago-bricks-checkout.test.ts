import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/202609080003_mercadopago_bricks_test_checkout.sql",
  "utf8"
);

describe("Mercado Pago Bricks test checkout migration", () => {
  it("uses database prices and creates order, payment and reservations atomically", () => {
    expect(migration).toContain("coalesce(variant.price_override, product.base_price)");
    expect(migration).toContain("private.reserve_inventory(");
    expect(migration).toContain("insert into public.orders(");
    expect(migration).toContain("insert into public.order_items(");
    expect(migration).toContain("insert into public.payments(");
    expect(migration).toContain("insert into public.idempotency_keys");
  });

  it("keeps creation authenticated and releases stock after rejection or cancellation", () => {
    expect(migration).toContain("v_user_id uuid := auth.uid()");
    expect(migration).toContain("grant execute on function public.create_mercadopago_test_order");
    expect(migration).toContain("to authenticated");
    expect(migration).toContain("p_status in ('rejected', 'cancelled')");
    expect(migration).toContain("private.release_order_reservations(local_payment.order_id)");
  });
});

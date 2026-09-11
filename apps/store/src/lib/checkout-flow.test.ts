import { describe, expect, it } from "vitest";
import { normalizeOptionalCouponCode, shouldResumePendingCheckout } from "./checkout-flow";

describe("checkout flow", () => {
  it.each([undefined, null, "", "   "])("trata %j como cupom ausente", (value) => {
    expect(normalizeOptionalCouponCode(value)).toBeUndefined();
  });

  it("normaliza somente um cupom realmente informado", () => {
    expect(normalizeOptionalCouponCode("  SAVE10  ")).toBe("SAVE10");
  });

  it("retoma somente um pedido idempotente com pagamento pendente", () => {
    expect(shouldResumePendingCheckout(
      { reused: true },
      { status: "pending_payment", payment_status: "pending" }
    )).toBe(true);
    expect(shouldResumePendingCheckout(
      { reused: false },
      { status: "pending_payment", payment_status: "pending" }
    )).toBe(false);
    expect(shouldResumePendingCheckout(
      { reused: true },
      { status: "processing", payment_status: "approved" }
    )).toBe(false);
  });
});

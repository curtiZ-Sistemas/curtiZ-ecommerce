import { describe, expect, it } from "vitest";
import {
  calculateSubtotal,
  canTransitionOrder,
  evaluatePromotion,
  initialSupportAssignment,
  roleHasPermission
} from "./index";

describe("domínio Curtiz", () => {
  it("calcula subtotal apenas em centavos", () => {
    expect(calculateSubtotal([{ quantity: 2, unitPriceInCents: 5_990 }])).toBe(11_980);
  });

  it("bloqueia transição inválida de pedido", () => {
    expect(canTransitionOrder("pending_payment", "shipped")).toBe(false);
  });

  it("encaminha suporte novo ao Administrador", () => {
    expect(initialSupportAssignment.assignedRole).toBe("admin");
  });

  it("não permite financeiro completo ao operacional", () => {
    expect(roleHasPermission("operational", "financial.read_full")).toBe(false);
  });

  it("limita desconto fixo ao subtotal", () => {
    expect(
      evaluatePromotion(
        { type: "fixed", amountInCents: 10_000 },
        { subtotalInCents: 5_000, quantity: 1, shippingInCents: 0 }
      )
    ).toBe(5_000);
  });
});

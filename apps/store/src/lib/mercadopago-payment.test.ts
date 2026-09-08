import { describe, expect, it } from "vitest";
import { normalizeMercadoPagoStatus, publicPaymentState } from "./mercadopago-payment";

describe("status do Mercado Pago", () => {
  it.each([
    ["approved", "approved"],
    ["pending", "pending"],
    ["in_process", "pending"],
    ["authorized", "pending"],
    ["rejected", "rejected"],
    ["cancelled", "cancelled"],
    ["in_mediation", "in_review"]
  ])("normaliza %s", (provider, local) => {
    expect(normalizeMercadoPagoStatus(provider)).toBe(local);
  });

  it("não apresenta revisão interna como aprovação", () => {
    expect(publicPaymentState("in_review")).toBe("error");
  });
});

import { describe, expect, it } from "vitest";
import { checkoutMissingFields, isCancelledOrderStatus, normalizeOptionalCouponCode, shouldResumePendingCheckout } from "./checkout-flow";

const readyCheckout = {
  customer: { name: "Cliente Teste", email: "cliente@example.com", phone: "(11) 99999-9999", cpf: "" },
  address: { postalCode: "01310-100", street: "Avenida Paulista", number: "1000", complement: "",
    district: "Bela Vista", city: "São Paulo", state: "SP" },
  cpfConfigured: true,
  itemCount: 1
};

describe("checkout flow", () => {
  it.each([undefined, null, "", "   "])("trata %j como cupom ausente", (value) => {
    expect(normalizeOptionalCouponCode(value)).toBeUndefined();
  });

  it("normaliza somente um cupom realmente informado", () => {
    expect(normalizeOptionalCouponCode("  SAVE10  ")).toBe("SAVE10");
  });

  it("bloqueia pagamento direto durante e depois do cancelamento", () => {
    expect(isCancelledOrderStatus("cancellation_requested")).toBe(true);
    expect(isCancelledOrderStatus("cancelled")).toBe(true);
    expect(isCancelledOrderStatus("pending_payment")).toBe(false);
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

  it("considera pronto somente checkout com identidade, contato, endereço e itens válidos", () => {
    expect(checkoutMissingFields(readyCheckout)).toEqual([]);
    expect(checkoutMissingFields({ ...readyCheckout, customer: {
      name: "X", email: "invalido", phone: "119999", cpf: ""
    }, cpfConfigured: false })).toEqual(["name", "email", "phone", "cpf"]);
    expect(checkoutMissingFields({ ...readyCheckout, address: {
      ...readyCheckout.address, postalCode: "", street: "", number: "", district: "", city: "", state: ""
    } })).toEqual(["postalCode", "street", "number", "district", "city", "state"]);
  });

  it("aceita CPF novo válido sem depender de last4 legado", () => {
    expect(checkoutMissingFields({ ...readyCheckout, cpfConfigured: false,
      customer: { ...readyCheckout.customer, cpf: "529.982.247-25" } })).toEqual([]);
    expect(checkoutMissingFields({ ...readyCheckout, cpfConfigured: false })).toContain("cpf");
  });
});

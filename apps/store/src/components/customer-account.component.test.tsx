import { describe, expect, it } from "vitest";
import { canContinueOrderPayment, customerStatusLabel } from "../lib/customer-account-presentation";

describe("customer account presentation", () => {
  it("uses clear pt-BR labels for commerce states", () => {
    expect(customerStatusLabel("pending_payment")).toBe("Aguardando pagamento");
    expect(customerStatusLabel("ready_to_ship")).toBe("Pronto para envio");
    expect(customerStatusLabel("return_requested")).toBe("Devolução solicitada");
    expect(customerStatusLabel("approved_waiting_kit")).toBe("Aprovado · kit pendente");
    expect(customerStatusLabel("suspended")).toBe("Suspenso");
  });

  it("keeps unknown provider states readable without inventing a status", () => {
    expect(customerStatusLabel("awaiting_provider")).toBe("awaiting provider");
  });

  it.each([
    ["pending_payment", "pending", "selected:pix", true],
    ["pending_payment", "rejected", "credit_card:visa", true],
    ["cancellation_requested", "pending", "selected:pix", false],
    ["cancelled", "pending", "selected:pix", false],
    ["processing", "pending", "selected:pix", false],
    ["shipped", "pending", "selected:pix", false],
    ["delivered", "pending", "selected:pix", false],
    ["pending_payment", "approved", "credit_card:visa", false],
    ["pending_payment", "pending", "", false]
  ])("controls payment resumption for order=%s payment=%s", (order, payment, method, expected) => {
    expect(canContinueOrderPayment(order, payment, method)).toBe(expected);
  });
});

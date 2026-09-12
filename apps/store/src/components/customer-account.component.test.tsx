import { describe, expect, it } from "vitest";
import {
  canContinueOrderPayment,
  customerOrderActionLabel,
  customerOrderProgress,
  matchesCustomerOrderFilter,
  customerStatusLabel
} from "../lib/customer-account-presentation";

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
    ["expired", "pending", "selected:pix", false],
    ["payment_approved", "pending", "selected:pix", false],
    ["preparing", "pending", "selected:pix", false],
    ["refunded", "pending", "selected:pix", false],
    ["processing", "pending", "selected:pix", false],
    ["shipped", "pending", "selected:pix", false],
    ["delivered", "pending", "selected:pix", false],
    ["pending_payment", "approved", "credit_card:visa", false],
    ["pending_payment", "pending", "", false]
  ])("controls payment resumption for order=%s payment=%s", (order, payment, method, expected) => {
    expect(canContinueOrderPayment(order, payment, method)).toBe(expected);
  });

  it("blocks expired payments even before order housekeeping runs", () => {
    const now = Date.parse("2026-09-12T12:00:00Z");
    expect(canContinueOrderPayment("pending_payment", "pending", "pix", "expired", "", now)).toBe(false);
    expect(canContinueOrderPayment("pending_payment", "pending", "pix", "", "2026-09-12T12:00:00Z", now)).toBe(false);
    expect(canContinueOrderPayment("pending_payment", "pending", "pix", "", "2026-09-12T12:01:00Z", now)).toBe(true);
  });

  it.each([
    ["payment_approved", "Acompanhar pedido"],
    ["processing", "Acompanhar pedido"],
    ["shipped", "Rastrear pedido"],
    ["delivered", "Ver detalhes"],
    ["cancellation_requested", "Cancelamento solicitado"],
    ["cancelled", "Cancelado"]
  ])("labels the primary order action for %s", (status, expected) => {
    expect(customerOrderActionLabel(status)).toBe(expected);
  });

  it("groups all fulfillment preparation states in the same useful filter", () => {
    expect(matchesCustomerOrderFilter("payment_approved", "preparing")).toBe(true);
    expect(matchesCustomerOrderFilter("picking", "preparing")).toBe(true);
    expect(matchesCustomerOrderFilter("ready_to_ship", "preparing")).toBe(true);
    expect(matchesCustomerOrderFilter("shipped", "preparing")).toBe(false);
  });

  it("builds progress from the backend status without time-based advancement", () => {
    expect(customerOrderProgress("pending_payment")).toEqual([
      { label: "Pedido realizado", state: "complete" },
      { label: "Processando pagamento", state: "current" },
      { label: "Preparando pedido", state: "upcoming" },
      { label: "Enviado", state: "upcoming" },
      { label: "Entregue", state: "upcoming" }
    ]);
    expect(customerOrderProgress("shipped").map((step) => step.state)).toEqual([
      "complete", "complete", "complete", "current", "upcoming"
    ]);
  });
});

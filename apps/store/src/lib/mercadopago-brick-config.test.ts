import { describe, expect, it } from "vitest";
import { createCheckoutPaymentPayload, createMercadoPagoInitialization, readMercadoPagoBrickSession } from "./mercadopago-brick-config";

const identity = { idempotencyKey: "key", email: "cliente@example.com", cpf: "12345678909" };
const validResponse = {
  ok: true,
  orderId: "order-id",
  orderCode: "CZ-123",
  subtotalInCents: 5100,
  shippingInCents: 1690,
  amountInCents: 6790,
  publicKey: "TEST-public-key",
  paymentMode: "test"
};

describe("configuração do Payment Brick", () => {
  it("converte o total validado pelo backend em 67.90 como number", () => {
    const session = readMercadoPagoBrickSession(validResponse, identity, 1690);
    expect(session).not.toBeNull();
    expect(createMercadoPagoInitialization(session!)).toMatchObject({ amount: 67.9 });
    expect(typeof createMercadoPagoInitialization(session!)?.amount).toBe("number");
    expect(createMercadoPagoInitialization(session!)?.payer.entityType).toBe("individual");
  });

  it.each([
    { payment_method_id: "pix" },
    { payment_method_id: "visa", token: "card-token", issuer_id: "25", installments: 2 }
  ])("normaliza o payload de Pix e cartao enviado ao backend", (formData) => {
    expect(createCheckoutPaymentPayload(formData, identity)).toMatchObject({
      payment_method_id: formData.payment_method_id,
      payer: { entity_type: "individual", identification: { type: "CPF", number: identity.cpf } }
    });
  });

  it.each([
    { ...validResponse, amountInCents: null },
    { ...validResponse, amountInCents: undefined },
    { ...validResponse, amountInCents: "R$ 67,90" },
    { ...validResponse, amountInCents: 6700 },
    { ...validResponse, publicKey: "" }
  ])("recusa resposta incompleta ou total divergente", (response) => {
    expect(readMercadoPagoBrickSession(response, identity, 1690)).toBeNull();
  });
});

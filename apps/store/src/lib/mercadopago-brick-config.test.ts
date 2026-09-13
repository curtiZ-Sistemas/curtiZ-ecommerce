import { describe, expect, it } from "vitest";
import { createCheckoutPaymentPayload, createMercadoPagoInitialization, readMercadoPagoBrickSession } from "./mercadopago-brick-config";

const identity = { idempotencyKey: "key", email: "cliente@example.com", checkout: null,
  paymentMode: "test" as const };
const validResponse = {
  ok: true,
  orderId: "order-id",
  orderCode: "CZ-123",
  subtotalInCents: 5100,
  discountInCents: 0,
  couponName: "",
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
    expect(createCheckoutPaymentPayload({ ...formData,
      payer: { identification: { type: "CPF", number: "12345678909" } } }, identity)).toMatchObject({
      payment_method_id: formData.payment_method_id,
      payer: { entity_type: "individual", identification: { type: "CPF", number: "12345678909" } }
    });
  });

  it("não preenche a inicialização TEST com CPF real", () => {
    const session = readMercadoPagoBrickSession(validResponse, identity, 1690)!;
    expect(session.paymentMode).toBe("test");
    expect(createMercadoPagoInitialization(session)?.payer).not.toHaveProperty("identification");
  });

  it.each([
    { payment_method_id: "pix" },
    { payment_method_id: "pix", payer: {} },
    { payment_method_id: "pix", payer: { identification: {} } },
    { payment_method_id: "pix", payer: { identification: { type: "CPF", number: "" } } },
    { payment_method_id: "visa", token: "card-token", issuer_id: 25, installments: 2 },
    { payment_method_id: "bolbradesco", payer: { email: identity.email } }
  ])("delega documento ausente ao servidor quando o CPF já foi salvo: %j", formData => {
    const payload = createCheckoutPaymentPayload(formData, identity);
    expect(payload).toMatchObject({
      payment_method_id: formData.payment_method_id,
      payer: { entity_type: "individual" }
    });
    expect(payload?.payer).not.toHaveProperty("identification");
    if ("token" in formData) {
      expect(payload).toMatchObject({ token: "card-token", issuer_id: 25, installments: 2 });
    }
  });

  it.each(["pix", "visa", "bolbradesco"])("prioriza o documento TEST fornecido pelo Brick em %s", paymentMethodId => {
    const session = { ...identity };
    const payload = createCheckoutPaymentPayload({ payment_method_id: paymentMethodId,
      token: paymentMethodId === "visa" ? "card-token" : undefined,
      payer: { identification: { type: "CPF", number: "12345678900" } } }, session);
    expect(payload?.payer.identification?.number).toBe("12345678900");
    expect(session).toEqual(identity);
  });

  it("deixa o fallback do documento ausente exclusivamente no servidor", () => {
    expect(createCheckoutPaymentPayload({ payment_method_id: "pix" }, identity)?.payer).not.toHaveProperty("identification");
  });

  it.each(["test", "production"] as const)("não substitui documento malformado fornecido em %s", paymentMode => {
    expect(createCheckoutPaymentPayload({ payment_method_id: "pix",
      payer: { identification: { type: "CPF", number: "11111111111" } } },
    { ...identity, paymentMode })).toBeNull();
  });

  it("valida o documento fornecido e delega fallback de produção ao servidor", () => {
    const session = { ...identity, paymentMode: "production" as const };
    expect(createCheckoutPaymentPayload({ payment_method_id: "pix" }, session)?.payer.identification?.number)
      .toBeUndefined();
    expect(createCheckoutPaymentPayload({ payment_method_id: "pix",
      payer: { identification: { type: "CPF", number: "12345678900" } } }, session)).toBeNull();
    expect(createCheckoutPaymentPayload({ payment_method_id: "pix" }, session)?.payer)
      .not.toHaveProperty("identification");
  });

  it("não envia identidade real do cliente ao browser em produção", () => {
    const session = readMercadoPagoBrickSession(validResponse, identity, 1690)!;
    expect(createMercadoPagoInitialization({ ...session, paymentMode: "production" })?.payer)
      .not.toHaveProperty("identification");
  });

  it("inicializa cartões salvos exclusivamente com referências oficiais", () => {
    const session = readMercadoPagoBrickSession(validResponse, identity, 1690)!;
    expect(createMercadoPagoInitialization({ ...session, savedCards: { customerId: "customer-1", cardIds: ["card-1"] } })?.payer)
      .toMatchObject({ customerId: "customer-1", cardsIds: ["card-1"] });
  });
  it("encaminha o token novo do cartão salvo para validação de ownership no servidor", () => {
    expect(createCheckoutPaymentPayload({ payment_method_id: "visa", token: "new-cvv-token",
      payer: { type: "customer", id: "customer-1" } }, identity)).toMatchObject({
      token: "new-cvv-token", payer: { type: "customer", id: "customer-1" }
    });
  });
  it("não aceita cartão salvo sem token novo nem CPF malformado em produção", () => {
    expect(createCheckoutPaymentPayload({ payment_method_id: "visa", payer: { type: "customer", id: "customer-1" } }, identity)).toBeNull();
    expect(createCheckoutPaymentPayload({ payment_method_id: "visa", token: "new-token",
      payer: { type: "customer", id: "customer-1", identification: { number: "11111111111" } } },
    { ...identity, paymentMode: "production" })).toBeNull();
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

import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { MercadoPagoPaymentProvider } from "./index";

const orderId = "10000000-0000-4000-8000-000000000001";
const reference = `KITMG-${orderId}`;
const input = {
  orderId, amountInCents: 12100, email: "buyer@example.invalid", buyerName: "Synthetic buyer",
  buyerDocument: "11222333000181", expiresAt: "2099-01-01T00:00:00Z"
};
const payment = { id: 123, live_mode: true, collector_id: 456, transaction_amount: 121,
  currency_id: "BRL", external_reference: reference, payment_method_id: "pix" };

describe("Mercado Pago commercial kit Pix", () => {
  it("sends the approved CNPJ, fixed expiration and idempotency key for this order", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payment));
    const provider = new MercadoPagoPaymentProvider("APP_USR-fixture", "production", transport);
    expect(await provider.createRepresentativeKitPix(input)).toMatchObject({ externalReference: reference, collectorId: "456" });
    const [url, init] = transport.mock.calls[0]!;
    expect(url).toBe("https://api.mercadopago.com/v1/payments");
    expect(new Headers(init?.headers).get("x-idempotency-key")).toBe(orderId);
    if (typeof init?.body !== "string") throw new Error("Expected a JSON request body");
    expect(JSON.parse(init.body)).toMatchObject({
      transaction_amount: 121, external_reference: reference, payment_method_id: "pix",
      payer: { identification: { type: "CNPJ", number: input.buyerDocument } },
      date_of_expiration: "2099-01-01T00:00:00.000Z"
    });
  });

  it("identifies an individual payer by CPF when the buyer has no CNPJ", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payment));
    const provider = new MercadoPagoPaymentProvider("APP_USR-fixture", "production", transport);
    await provider.createRepresentativeKitPix({ ...input, buyerDocument: "52998224725" });
    const sent = transport.mock.calls[0]?.[1]?.body;
    if (typeof sent !== "string") throw new Error("Expected a JSON request body");
    const body = JSON.parse(sent) as { payer: Record<string, unknown> };
    expect(body.payer).toMatchObject({ entity_type: "individual", identification: { type: "CPF", number: "52998224725" } });
  });

  it("refuses a payer document that is neither 11 nor 14 digits", async () => {
    const transport = vi.fn<typeof fetch>();
    const provider = new MercadoPagoPaymentProvider("APP_USR-fixture", "production", transport);
    for (const buyerDocument of ["", "1234567890", "123456789012", "1122233300018x"]) {
      await expect(provider.createRepresentativeKitPix({ ...input, buyerDocument })).rejects.toThrow("invalid_kit_payment");
    }
    expect(transport).not.toHaveBeenCalled();
  });

  it("refuses the commercial aggregate with test credentials without reaching the provider", async () => {
    const transport = vi.fn<typeof fetch>();
    await expect(new MercadoPagoPaymentProvider("TEST-fixture", "test", transport).createRepresentativeKitPix(input))
      .rejects.toThrow("payment_mode_mismatch");
    expect(transport).not.toHaveBeenCalled();
  });

  it("queries the matched payment by ID and rejects a non-live readback", async () => {
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ results: [payment] }))
      .mockResolvedValueOnce(Response.json({ ...payment, live_mode: false }));
    const provider = new MercadoPagoPaymentProvider("APP_USR-fixture", "production", transport);
    await expect(provider.findRepresentativeKitPayment(reference)).rejects.toThrow("payment_mode_mismatch");
    expect(transport.mock.calls[1]?.[0]).toBe("https://api.mercadopago.com/v1/payments/123");
    expect(transport.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });

  it("distinguishes a missing result from duplicate payments without another write", async () => {
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ results: [] }))
      .mockResolvedValueOnce(Response.json({ results: [payment, { ...payment, id: 124 }] }));
    const provider = new MercadoPagoPaymentProvider("APP_USR-fixture", "production", transport);
    await expect(provider.findRepresentativeKitPayment(reference)).resolves.toBeNull();
    await expect(provider.findRepresentativeKitPayment(reference)).rejects.toThrow("ambiguous_kit_payment");
    expect(transport.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });
});

describe("Mercado Pago commercial kit card", () => {
  const card = {
    aggregate: "representative_kit_orders" as const, orderId, orderCode: reference, amountInCents: 12100, currency: "BRL" as const,
    idempotencyKey: "20000000-0000-4000-8000-000000000002", customerEmail: "buyer@example.invalid", customerName: "Synthetic buyer",
    customerDocument: "11222333000181", documentType: "CNPJ" as const, entityType: "association" as const,
    paymentMethodId: "visa", token: "token-fixture-123", installments: 3
  };
  const cardPayment = { ...payment, payment_method_id: "visa", payment_type_id: "credit_card", installments: 3, status: "approved" };

  it("charges the kit reference with the token, installments, CNPJ and the attempt as idempotency key", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json(cardPayment));
    const provider = new MercadoPagoPaymentProvider("APP_USR-fixture", "production", transport);
    expect(await provider.createPayment(card)).toMatchObject({ externalReference: reference, paymentTypeId: "credit_card", installments: 3 });
    const [, init] = transport.mock.calls[0]!;
    expect(new Headers(init?.headers).get("x-idempotency-key")).toBe(card.idempotencyKey);
    if (typeof init?.body !== "string") throw new Error("Expected a JSON request body");
    expect(JSON.parse(init.body)).toMatchObject({
      transaction_amount: 121, token: card.token, installments: 3, payment_method_id: "visa", external_reference: reference,
      metadata: { aggregate: "representative_kit_orders", kit_order_id: orderId },
      payer: { entity_type: "association", identification: { type: "CNPJ", number: card.customerDocument } }
    });
    expect(JSON.parse(init.body)).not.toHaveProperty("date_of_expiration");
  });

  it("refuses test credentials, a foreign reference, a missing token and a bad document before any request", async () => {
    const transport = vi.fn<typeof fetch>();
    const live = new MercadoPagoPaymentProvider("APP_USR-fixture", "production", transport);
    await expect(new MercadoPagoPaymentProvider("TEST-fixture", "test", transport).createPayment(card)).rejects.toThrow("payment_mode_mismatch");
    for (const change of [{ orderCode: "ORDER-1" }, { token: undefined }, { customerDocument: "123" }, { amountInCents: 0 }]) {
      await expect(live.createPayment({ ...card, ...change })).rejects.toThrow("invalid_kit_payment");
    }
    expect(transport).not.toHaveBeenCalled();
  });

  it("sets aside refused attempts when it looks the payment up by reference, but not other duplicates", async () => {
    const refused = { ...cardPayment, id: 122, status: "rejected" };
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ results: [cardPayment, refused] }))
      .mockResolvedValueOnce(Response.json(cardPayment))
      .mockResolvedValueOnce(Response.json({ results: [refused] }))
      .mockResolvedValueOnce(Response.json({ results: [cardPayment, { ...cardPayment, id: 124 }, refused] }));
    const provider = new MercadoPagoPaymentProvider("APP_USR-fixture", "production", transport);
    await expect(provider.findRepresentativeKitPayment(reference)).resolves.toMatchObject({ id: "123" });
    await expect(provider.findRepresentativeKitPayment(reference)).resolves.toBeNull();
    await expect(provider.findRepresentativeKitPayment(reference)).rejects.toThrow("ambiguous_kit_payment");
  });
});

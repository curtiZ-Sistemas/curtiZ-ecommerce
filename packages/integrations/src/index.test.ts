import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FIXED_SHIPPING_IN_CENTS,
  FixedShippingProvider,
  isMercadoPagoTestCredential,
  isMockRuntimeAllowed,
  MercadoPagoProviderError,
  MercadoPagoTestPaymentProvider,
  MockShippingProvider
} from "./index";

afterEach(() => vi.unstubAllGlobals());

describe("runtime de providers mock", () => {
  it("permite build otimizado de staging sem confundir NODE_ENV com ambiente comercial", () => {
    expect(isMockRuntimeAllowed({ NODE_ENV: "production", APP_ENV: "staging" })).toBe(true);
  });

  it("bloqueia mocks no ambiente comercial de produção", () => {
    expect(isMockRuntimeAllowed({ NODE_ENV: "production", APP_ENV: "production" })).toBe(false);
  });

  it("expõe estado honesto quando o mock não é permitido", async () => {
    const previous = { app: process.env.APP_ENV, node: process.env.NODE_ENV };
    process.env.APP_ENV = "production";
    process.env.NODE_ENV = "production";
    await expect(new MockShippingProvider().health()).resolves.toBe("not_configured");
    process.env.APP_ENV = previous.app;
    process.env.NODE_ENV = previous.node;
  });
});

describe("Mercado Pago em teste", () => {
  it("bloqueia qualquer credencial que não seja de teste", () => {
    expect(isMercadoPagoTestCredential("TEST-123")).toBe(true);
    expect(isMercadoPagoTestCredential("APP_USR-live")).toBe(false);
    expect(() => new MercadoPagoTestPaymentProvider("APP_USR-live")).toThrow(
      MercadoPagoProviderError
    );
  });

  it("usa valor interno e idempotência ao criar o pagamento", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 123,
        status: "approved",
        status_detail: "accredited",
        transaction_amount: 42.4,
        currency_id: "BRL",
        external_reference: "CZT-TEST",
        payment_method_id: "visa",
        payment_type_id: "credit_card",
        date_approved: "2026-09-08T12:00:00Z"
      })
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new MercadoPagoTestPaymentProvider("TEST-token");
    await provider.createPayment({
      orderId: "order-id",
      orderCode: "CZT-TEST",
      amountInCents: 4_240,
      currency: "BRL",
      idempotencyKey: "10000000-0000-4000-8000-000000000001",
      customerEmail: "cliente@example.com",
      customerName: "Cliente Teste",
      customerDocument: "12345678909",
      entityType: "individual",
      paymentMethodId: "visa",
      token: "card-token",
      installments: 1
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("x-idempotency-key")).toBe(
      "10000000-0000-4000-8000-000000000001"
    );
    if (typeof init.body !== "string") throw new Error("request body ausente");
    expect(JSON.parse(init.body)).toMatchObject({
      transaction_amount: 42.4,
      payer: { entity_type: "individual" },
      external_reference: "CZT-TEST",
      metadata: { order_id: "order-id" }
    });
  });
});

describe("frete fixo temporário", () => {
  it("retorna R$ 16,90 sem prazo inventado", async () => {
    const [quote] = await new FixedShippingProvider().quote({
      postalCode: "01001000",
      subtotalInCents: 2_550,
      packages: []
    });
    expect(quote).toMatchObject({
      provider: "fixed_shipping",
      service: "Entrega padrão",
      amountInCents: FIXED_SHIPPING_IN_CENTS,
      estimatedDays: null
    });
    expect(2_550 + FIXED_SHIPPING_IN_CENTS).toBe(4_240);

    const [doubleQuantityQuote] = await new FixedShippingProvider().quote({
      postalCode: "99999999",
      subtotalInCents: 5_100,
      packages: []
    });
    expect(doubleQuantityQuote?.amountInCents).toBe(FIXED_SHIPPING_IN_CENTS);
    expect(5_100 + (doubleQuantityQuote?.amountInCents ?? 0)).toBe(6_790);
  });
});

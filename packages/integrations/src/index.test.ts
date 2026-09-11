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

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

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
        date_approved: "2026-09-08T12:00:00Z",
        installments: 3,
        fee_details: [{ type: "mercadopago_fee", amount: 1.7 }],
        transaction_details: { net_received_amount: 40.7 },
        refunds: [{ id: 9001, amount: 10.2, status: "approved", date_created: "2026-09-09T12:00:00Z" }]
      })
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new MercadoPagoTestPaymentProvider("TEST-token");
    const payment = await provider.createPayment({
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
    expect(JSON.parse(init.body)).not.toHaveProperty("date_of_expiration");
    expect(payment).toMatchObject({
      providerFeeInCents: 170,
      netReceivedInCents: 4_070,
      installments: 3,
      refunds: [{ id: "9001", amountInCents: 1_020, status: "approved" }]
    });
  });

  it("valida os meios habilitados na conta antes de criar pedido", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ id: "pix" }, { id: "visa" }, { id: "inválido" }, { name: "sem id" }]
    });
    vi.stubGlobal("fetch", fetchMock);
    const methods = await new MercadoPagoTestPaymentProvider("TEST-token").getPaymentMethodIds();
    expect(methods).toEqual(["pix", "visa"]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.mercadopago.com/v1/payment_methods",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("envia Pix com vencimento de 30 minutos e preserva as instruções retornadas", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T12:00:00Z"));
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 456,
        status: "pending",
        status_detail: "pending_waiting_transfer",
        transaction_amount: 42.4,
        currency_id: "BRL",
        external_reference: "CZT-PIX",
        payment_method_id: "pix",
        payment_type_id: "bank_transfer",
        date_of_expiration: "2026-09-10T12:30:00Z",
        point_of_interaction: { transaction_data: { qr_code: "pix-copia-e-cola", qr_code_base64: "base64-png" } }
      })
    });
    vi.stubGlobal("fetch", fetchMock);
    const payment = await new MercadoPagoTestPaymentProvider("TEST-token").createPayment({
      orderId: "order-id", orderCode: "CZT-PIX", amountInCents: 4_240, currency: "BRL",
      idempotencyKey: "10000000-0000-4000-8000-000000000002", customerEmail: "cliente@example.com",
      customerName: "Cliente Teste", customerDocument: "12345678909", entityType: "individual",
      paymentMethodId: "pix", installments: 1
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    if (typeof init.body !== "string") throw new Error("request body ausente");
    const requestBody: unknown = JSON.parse(init.body);
    expect(requestBody).toMatchObject({ date_of_expiration: "2026-09-10T12:30:00.000Z" });
    expect(payment).toMatchObject({ pixCopyPaste: "pix-copia-e-cola", pixQrCodeBase64: "base64-png" });
    vi.useRealTimers();
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

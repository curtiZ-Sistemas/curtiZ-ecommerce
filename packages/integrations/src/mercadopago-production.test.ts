import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { MercadoPagoPaymentProvider } from "./index";

afterEach(() => vi.unstubAllGlobals());
describe("Mercado Pago production adapter with isolated provider fixtures", () => {
  const payment = { id: 123, live_mode: true, status: "approved", transaction_amount: 50,
    currency_id: "BRL", external_reference: "CZ-FIXTURE", fee_details: [{ amount: 2 }],
    transaction_details: { net_received_amount: 48 } };
  const input = { orderId: "fixture", orderCode: "CZ-FIXTURE", amountInCents: 5000, currency: "BRL" as const,
    idempotencyKey: "fixture-key", customerEmail: "fixture@example.com", customerName: "Fixture",
    customerDocument: "52998224725", entityType: "individual" as const, paymentMethodId: "visa", issuerId: 25, installments: 1, token: "fixture-token" };
  it("creates a live payment with server amount and stable idempotency, and parses financial values", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payment));
    vi.stubGlobal("fetch", fetcher);
    expect(await new MercadoPagoPaymentProvider("APP_USR-fixture", "production").createPayment(input))
      .toMatchObject({ id: "123", amountInCents: 5000, providerFeeInCents: 200, netReceivedInCents: 4800 });
    const request = fetcher.mock.calls[0]?.[1];
    expect(new Headers(request?.headers).get("x-idempotency-key")).toBe("fixture-key");
    if (typeof request?.body !== "string") throw new Error("missing_fixture_request_body");
    expect(JSON.parse(request.body)).toMatchObject({ transaction_amount: 50, external_reference: "CZ-FIXTURE", issuer_id: 25 });
  });
  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])("rejects invalid issuer %s before contacting the provider", async issuerId => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(new MercadoPagoPaymentProvider("APP_USR-fixture", "production").createPayment({ ...input, issuerId }))
      .rejects.toMatchObject({ code: "invalid_issuer" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([false, undefined, "true"])("rejects a provider response whose live_mode is %s", async live_mode => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...payment, live_mode })));
    await expect(new MercadoPagoPaymentProvider("APP_USR-fixture", "production").getPayment("123"))
      .rejects.toMatchObject({ code: "payment_mode_mismatch" });
  });
  it("keeps live responses out of test reconciliation", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(Response.json(payment)));
    await expect(new MercadoPagoPaymentProvider("TEST-fixture", "test").getPayment("123"))
      .rejects.toMatchObject({ code: "payment_mode_mismatch" });
  });
  it.each(["cancel", "refund"])("never sends a %s mutation for a payment from another environment", async action => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...payment, live_mode: false }));
    vi.stubGlobal("fetch", fetcher);
    const provider = new MercadoPagoPaymentProvider("APP_USR-fixture", "production");
    await expect(action === "cancel" ? provider.cancelPayment("123") : provider.refundPayment("123", 5000, "key"))
      .rejects.toMatchObject({ code: "payment_mode_mismatch" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe("GET");
  });
  it.each([["TEST-fixture", "production"], ["APP_USR-fixture", "test"]] as const)("rejects a mixed credential before a request", (key, mode) => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    expect(() => new MercadoPagoPaymentProvider(key, mode)).toThrow(); expect(fetcher).not.toHaveBeenCalled();
  });
});

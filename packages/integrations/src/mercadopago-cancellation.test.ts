import { afterEach, describe, expect, it, vi } from "vitest";
import { MercadoPagoTestPaymentProvider } from "./index";
vi.mock("server-only", () => ({}));
afterEach(() => vi.unstubAllGlobals());
describe("Mercado Pago cancellation/refund requests", () => {
  it.each([undefined, null, 1, "pending", "rejected"])("never infers refund approval from status %s", async status => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      id: "123", live_mode: false, transaction_amount: 67.9,
      refunds: [{ id: "refund-1", amount: 67.9, status }]
    })));
    const payment = await new MercadoPagoTestPaymentProvider("TEST-fixture").getPayment("123");
    expect(payment.refunds.filter(refund => ["approved", "completed"].includes(refund.status))).toEqual([]);
  });
  it("cancels the existing payment with PUT, without creating a charge", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ id: "123", live_mode: false, status: "cancelled", transaction_amount: 67.9, currency_id: "BRL", external_reference: "CZT-1" })));
    vi.stubGlobal("fetch", fetcher);
    expect((await new MercadoPagoTestPaymentProvider("TEST-fixture").cancelPayment("123")).status).toBe("cancelled");
    expect(fetcher).toHaveBeenCalledWith("https://api.mercadopago.com/v1/payments/123", expect.objectContaining({ method: "PUT", body: '{"status":"cancelled"}' }));
  });
  it("refund retries retain the idempotency key and full amount", async () => {
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => Response.json(init?.method === "GET"
      ? { id: "123", live_mode: false, transaction_amount: 67.9 }
      : { id: "refund-1", status: "approved", amount: 67.9 }));
    vi.stubGlobal("fetch", fetcher);
    const provider = new MercadoPagoTestPaymentProvider("TEST-fixture");
    await provider.refundPayment("123",6790,"same-key"); await provider.refundPayment("123",6790,"same-key");
    for (const call of fetcher.mock.calls.filter(([, init]) => init?.method === "POST") as unknown as Array<[string, RequestInit]>) {
      expect(call[0]).toBe("https://api.mercadopago.com/v1/payments/123/refunds");
      expect(new Headers(call[1].headers).get("x-idempotency-key")).toBe("same-key");
      expect(call[1].body).toBe('{"amount":67.9}');
    }
  });
  it.each(["pending", "rejected"])("does not finalize an unconfirmed %s refund", async status => {
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => Response.json(init?.method === "GET"
      ? { id: "123", live_mode: false, transaction_amount: 67.9 } : { id: "refund-1", status, amount: 67.9 })));
    await expect(new MercadoPagoTestPaymentProvider("TEST-fixture").refundPayment("123",6790,"same-key")).rejects.toThrow();
  });
});

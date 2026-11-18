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
    expect(JSON.parse(String(init?.body))).toMatchObject({
      transaction_amount: 121, external_reference: reference, payment_method_id: "pix",
      payer: { identification: { type: "CNPJ", number: input.buyerDocument } },
      date_of_expiration: "2099-01-01T00:00:00.000Z"
    });
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

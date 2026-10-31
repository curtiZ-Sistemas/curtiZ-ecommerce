import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { MercadoPagoPaymentProvider, type MercadoPagoPaymentInput } from "./index";

const input: MercadoPagoPaymentInput = { aggregate: "kit_orders", orderId: "10000000-0000-4000-8000-000000000001",
  orderCode: "KITTEST-10000000-0000-4000-8000-000000000001", amountInCents: 8043, currency: "BRL", idempotencyKey: "stable-key",
  customerEmail: "fixture@example.invalid", customerName: "Fixture", customerDocument: "test-document",
  entityType: "individual", paymentMethodId: "pix", installments: 1 };
describe("kit payment identity", () => {
  it("uses separate provider metadata while preserving the idempotency key", async () => {
    const transport = vi.fn<typeof fetch>();
    transport.mockResolvedValue(new Response(JSON.stringify({ id: 123, live_mode: false, status: "pending",
      transaction_amount: 80.43, currency_id: "BRL", external_reference: input.orderCode, payment_method_id: "pix", payment_type_id: "bank_transfer" })));
    await new MercadoPagoPaymentProvider("TEST-fixture", "test", transport).createPayment(input);
    const init = transport.mock.calls[0]?.[1];
    expect(init).toBeDefined();
    if (typeof init?.body !== "string") throw new Error("Missing request body");
    const body: unknown = JSON.parse(init.body);
    expect(body).toHaveProperty("metadata", { aggregate: "kit_orders", kit_order_id: input.orderId });
    expect(body).not.toHaveProperty("metadata.order_id");
    expect(new Headers(init?.headers).get("x-idempotency-key")).toBe("stable-key");
  });
  it("blocks production before contacting the provider", async () => {
    const transport = vi.fn();
    await expect(new MercadoPagoPaymentProvider("APP_USR-fixture", "production", transport).createPayment(input)).rejects.toThrow("payment_mode_mismatch");
    expect(transport).not.toHaveBeenCalled();
  });
});

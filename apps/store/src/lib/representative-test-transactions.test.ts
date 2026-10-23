import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MercadoPagoPayment } from "@curtiz/integrations";
const provider = vi.hoisted(() => ({ getPayment: vi.fn(), createPayment: vi.fn(), cancelPayment: vi.fn(), refundPayment: vi.fn() }));
const credentials = vi.hoisted(() => ({ mode: "test" }));
vi.mock("server-only", () => ({}));
vi.mock("@curtiz/config", () => ({ getMercadoPagoCredentials: () => ({ accessToken: "TEST-fixture", mode: credentials.mode }) }));
vi.mock("@curtiz/integrations", () => ({ MercadoPagoPaymentProvider: class {
  getPayment = provider.getPayment; createPayment = provider.createPayment;
  cancelPayment = provider.cancelPayment; refundPayment = provider.refundPayment;
} }));
import { assertKitPayment, beginKitPix, cancelKitTestOrder, kitTestProvider, persistKitPayment, refundKitTestOrder } from "./representative-test-transactions";

const order = "10000000-0000-4000-8000-000000000001";
const context = { orderId: order, mode: "test", reference: `KITTEST-${order}`, amountInCents: 8043,
  refundedInCents: 0, remainingInCents: 8043, state: "reserved", providerPaymentId: "123" };
const payment: MercadoPagoPayment = { id: "123", status: "pending", statusDetail: "pending_waiting_transfer",
  amountInCents: 8043, currency: "BRL", externalReference: `KITTEST-${order}`, paymentMethodId: "pix", paymentTypeId: "bank_transfer",
  dateApproved: null, expiresAt: "2026-10-23T17:00:00Z", pixCopyPaste: "test-only-qr", pixQrCodeBase64: "test-only-image",
  boletoUrl: "", digitableLine: "", providerFeeInCents: null, netReceivedInCents: null, installments: null, refunds: [] };
const rpc = vi.fn();
const db = { rpc } as unknown as SupabaseClient;
beforeEach(() => { vi.clearAllMocks(); credentials.mode = "test";
  vi.stubEnv("RATE_LIMIT_HMAC_KEY", "test-only-key-at-least-thirty-two-characters"); });
afterEach(() => vi.unstubAllEnvs());

describe("representative TEST payment boundary", () => {
  it("rejects production configuration before constructing a payment", () => {
    credentials.mode = "production";
    expect(() => kitTestProvider()).toThrow();
    expect(provider.createPayment).not.toHaveBeenCalled();
  });
  it.each([{ currency: "USD" }, { amountInCents: 1 }, { externalReference: "B2C-order" }, { id: "456" }])("rejects mismatched provider identity", change => {
    expect(() => assertKitPayment(context, { ...payment, ...change })).toThrow();
  });
  it("keeps presentation unavailable when settlement loses its lease", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    await expect(persistKitPayment(db, context, "lock", payment)).rejects.toThrow();
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("persists instructions only after accepted settlement", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await persistKitPayment(db, context, "lock", payment);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenNthCalledWith(1, "settle_kit_test_payment", expect.anything());
    expect(rpc).toHaveBeenNthCalledWith(2, "store_kit_test_instructions", expect.anything());
  });
  it("releases a lease instead of regressing a paid order on a delayed notification", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await persistKitPayment(db, { ...context, state: "paid" }, "lock", payment);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("release_kit_test_lease", { p_order: order, p_lock: "lock" });
  });
  it("uses the database amount and stable identity and verifies the provider read", async () => {
    rpc.mockImplementation(async (name: string) => ({ data: name === "claim_kit_test_creation"
      ? { ...context, providerPaymentId: null, idempotencyKey: "stable-key" } : true, error: null }));
    provider.createPayment.mockResolvedValue(payment);
    provider.getPayment.mockResolvedValue(payment);
    await beginKitPix(db, { id: "actor", email: "fixture@example.invalid" }, order, "test-document", "Fixture");
    expect(provider.createPayment).toHaveBeenCalledWith(expect.objectContaining({ orderId: order, orderCode: `KITTEST-${order}`,
      amountInCents: 8043, idempotencyKey: "stable-key", paymentMethodId: "pix" }));
    expect(provider.getPayment).toHaveBeenCalledWith("123");
  });
  it("never releases a reservation after an uncertain provider creation", async () => {
    rpc.mockImplementation(async (name: string) => ({ data: name === "read_kit_test_transaction"
      ? { ...context, providerPaymentId: null } : false, error: null }));
    await expect(cancelKitTestOrder(db, "actor", order)).rejects.toThrow();
    expect(provider.cancelPayment).not.toHaveBeenCalled();
  });
  it("does not repeat a completed refund", async () => {
    rpc.mockResolvedValue({ data: { state: "completed" }, error: null });
    await refundKitTestOrder(db, "actor", order, "refund-key", 100);
    expect(provider.getPayment).not.toHaveBeenCalled();
    expect(provider.refundPayment).not.toHaveBeenCalled();
  });
  it("blocks blind retry of an old uncertain refund", async () => {
    rpc.mockImplementation(async (name: string) => ({ data: name === "prepare_kit_test_refund" ? { providerPaymentId: "123", state: "pending" }
      : name === "read_kit_test_transaction" ? { ...context, state: "paid" }
        : { createdAt: "2020-01-01T00:00:00Z", completedRefundIds: [] }, error: null }));
    provider.getPayment.mockResolvedValue({ ...payment, status: "approved" });
    await expect(refundKitTestOrder(db, "actor", order, "refund-key", 100)).rejects.toThrow();
    expect(provider.refundPayment).not.toHaveBeenCalled();
  });
});

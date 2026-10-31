import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { processReturnRefund, returnNotificationPayload, runReturnJobs } from "./return-jobs";

const state = vi.hoisted(() => ({ rpc: vi.fn(), get: vi.fn(), refund: vi.fn(), send: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc: state.rpc }) }));
vi.mock("@curtiz/integrations", () => ({ MercadoPagoPaymentProvider: class { getPayment = state.get; refundPayment = state.refund; }, sendTransactionalEmail: state.send }));
vi.mock("@curtiz/security", () => ({ logServerEvent: vi.fn() }));
const environment = { MERCADO_PAGO_ENVIRONMENT: "test", MERCADO_PAGO_ACCESS_TOKEN: "TEST-fixture", NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY: "TEST-public",
  SUPABASE_URL: "https://example.supabase.co", SUPABASE_SECRET_KEY: "test-key", NEXT_PUBLIC_STORE_URL: "https://curtiz.com.br" };
const job = { id: "job", paymentId: "payment", orderCode: "ORDER-TEST", orderId: "order", customerId: "owner", amountInCents: 3367,
  paymentAmountInCents: 10101, knownRefundIds: [], idempotencyKey: "return:stable-job", code: "DEV-ABC123", email: "customer@example.invalid" };
const payment = { id: "payment", externalReference: "ORDER-TEST", currency: "BRL", amountInCents: 10101, status: "approved", refunds: [] };
beforeEach(() => {
  vi.clearAllMocks();
  state.rpc.mockReset().mockResolvedValue({ data: true, error: null });
  state.get.mockReset().mockResolvedValue(payment);
  state.refund.mockReset().mockResolvedValue({ id: "confirmed-refund" });
});
const db = () => createClient("https://example.supabase.co", "test-key");

describe("return refund authorization", () => {
  it("uses backend amount and durable key, validating payment ownership first", async () => {
    await expect(processReturnRefund(db(), job, environment, fetch)).resolves.toEqual({ id: "confirmed-refund" });
    expect(state.rpc).toHaveBeenCalledWith("check_mercadopago_order_mode", { p_mode: "test", p_order_id: "order", p_customer_id: "owner" });
    expect(state.refund).toHaveBeenCalledExactlyOnceWith("payment", 3367, "return:stable-job");
  });
  it("rejects cross-environment orders before querying or refunding", async () => {
    state.rpc.mockResolvedValue({ data: false, error: null });
    await expect(processReturnRefund(db(), job, environment, fetch)).rejects.toThrow("mode_mismatch");
    expect(state.get).not.toHaveBeenCalled(); expect(state.refund).not.toHaveBeenCalled();
  });
  it.each([{ id: "other" }, { externalReference: "OTHER" }, { currency: "USD" }, { amountInCents: 10100 }, { status: "pending" }, { status: "refunded" }])("blocks mismatched payment %j", async mismatch => {
    state.get.mockResolvedValue({ ...payment, ...mismatch });
    await expect(processReturnRefund(db(), job, environment, fetch)).rejects.toThrow("requires_review");
    expect(state.refund).not.toHaveBeenCalled();
  });
  it("blocks an unrecognized external refund rather than issuing another", async () => {
    state.get.mockResolvedValue({ ...payment, refunds: [{ id: "external", amountInCents: 100, status: "approved" }] });
    await expect(processReturnRefund(db(), job, environment, fetch)).rejects.toThrow("requires_review");
    expect(state.refund).not.toHaveBeenCalled();
  });
  it("allows known confirmed partial refunds within the payment balance", async () => {
    state.get.mockResolvedValue({ ...payment, refunds: [{ id: "known", amountInCents: 6734, status: "approved" }] });
    await expect(processReturnRefund(db(), { ...job, knownRefundIds: ["known"] }, environment, fetch)).resolves.toHaveProperty("id");
  });
  it("reconciles a specific existing receipt without issuing another refund", async () => {
    state.get.mockResolvedValue({ ...payment, status: "refunded", refunds: [{ id: "existing", amountInCents: 3367, status: "approved" }] });
    await expect(processReturnRefund(db(), { ...job, providerId: "existing" }, environment, fetch)).resolves.toEqual({ id: "existing" });
    expect(state.refund).not.toHaveBeenCalled();
  });
  it.each([{ id: "other", amountInCents: 3367, status: "approved" }, { id: "existing", amountInCents: 3300, status: "approved" }, { id: "existing", amountInCents: 3367, status: "pending" }])("rejects mismatched reconciliation receipt %j", receipt => {
    state.get.mockResolvedValue({ ...payment, refunds: [receipt] });
    return expect(processReturnRefund(db(), { ...job, providerId: "existing" }, environment, fetch)).rejects.toThrow("receipt_requires_review");
  });
  it("rejects pending partial refunds and amounts above the remaining balance", async () => {
    state.get.mockResolvedValue({ ...payment, refunds: [{ id: "known", amountInCents: 6735, status: "approved" }] });
    await expect(processReturnRefund(db(), { ...job, knownRefundIds: ["known"] }, environment, fetch)).rejects.toThrow("requires_review");
    state.get.mockResolvedValue({ ...payment, refunds: [{ id: "known", amountInCents: 100, status: "pending" }] });
    await expect(processReturnRefund(db(), { ...job, knownRefundIds: ["known"] }, environment, fetch)).rejects.toThrow("requires_review");
    expect(state.refund).not.toHaveBeenCalled();
  });
});

describe("return queue", () => {
  it("persists provider confirmation before displaying a completed refund", async () => {
    state.rpc.mockImplementation(async (name: string) => ({ data: name === "claim_return_job" ? job : true, error: null }));
    await runReturnJobs(environment, "execution");
    expect(state.rpc).toHaveBeenCalledWith("finish_return_job", expect.objectContaining({ p_outcome: "completed", p_provider_id: "confirmed-refund" }));
    expect(state.send).not.toHaveBeenCalled();
  });
  it("holds uncertain refunds for reconciliation without a blind retry", async () => {
    state.rpc.mockImplementation(async (name: string) => ({ data: name === "claim_return_job" ? job : true, error: null }));
    state.refund.mockRejectedValue(new Error("timeout"));
    await runReturnJobs(environment, "execution");
    expect(state.refund).toHaveBeenCalledTimes(1);
    expect(state.rpc).toHaveBeenCalledWith("finish_return_job", expect.objectContaining({ p_outcome: "review", p_error: "refund_requires_review" }));
    expect(state.rpc).not.toHaveBeenCalledWith("finish_return_job", expect.objectContaining({ p_outcome: "completed" }));
  });
  it("retains a successful receipt if saving confirmation fails", async () => {
    state.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => ({ data: name === "claim_return_job" ? job : true,
      error: name === "finish_return_job" && args.p_outcome === "completed" ? { message: "database unavailable" } : null }));
    await runReturnJobs(environment, "execution");
    expect(state.rpc).toHaveBeenCalledWith("finish_return_job", expect.objectContaining({ p_outcome: "review", p_provider_id: "confirmed-refund" }));
  });
});

describe("return notification", () => {
  const settings = { from: "curti Z <store@example.invalid>", replyTo: "support@example.invalid" };
  it("directs the customer to their authenticated account without exposing evidence", () => {
    const payload = returnNotificationPayload({ ...job, description: "private customer information", storage_path: "private/photo.webp" }, settings, "https://curtiz.com.br");
    expect(payload.text).toContain("https://curtiz.com.br/minha-conta/trocas");
    expect(payload.html).toContain('lang="pt-BR"');
    expect(payload.html).not.toContain("private customer information");
    expect(payload.html).not.toContain("private/photo.webp");
  });
  it.each(["http://curtiz.com.br", "https://curtiz.com.br/path", "https://user:secret@curtiz.com.br"])("rejects unsafe origin %s", origin => {
    expect(() => returnNotificationPayload(job, settings, origin)).toThrow("configuration");
  });
  it("rejects injected references", () => {
    expect(() => returnNotificationPayload({ ...job, code: '<script>bad</script>' }, settings, "https://curtiz.com.br")).toThrow("configuration");
  });
});

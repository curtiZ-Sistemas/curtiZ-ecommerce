import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cancelCustomerOrder } from "./customer-order-cancellation";
import { canCancelCustomerOrder, canContinueOrderPayment } from "./customer-account-presentation";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), get: vi.fn(), cancel: vi.fn(), refund: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./supabase/server", () => ({ createServiceSupabaseClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@curtiz/integrations", () => ({ MercadoPagoPaymentProvider: class {
  getPayment = mocks.get; cancelPayment = mocks.cancel; refundPayment = mocks.refund;
} }));
const payment = { id: "mp-1", externalReference: "CZT-1", amountInCents: 6790, currency: "BRL", status: "approved", refunds: [] };
let context: Record<string, unknown>;
beforeEach(() => {
  vi.stubEnv("MERCADO_PAGO_ENVIRONMENT", "test");
  vi.stubEnv("MERCADO_PAGO_ACCESS_TOKEN", "TEST-fixture");
  vi.stubEnv("NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY", "TEST-public");
  vi.clearAllMocks();
  context = { orderCode: "CZT-1", amountInCents: 6790, providerPaymentId: "mp-1", paid: true };
  mocks.get.mockReset().mockResolvedValue(payment);
  mocks.cancel.mockReset().mockResolvedValue({ ...payment, status: "cancelled" });
  mocks.refund.mockReset().mockResolvedValue({ id: "refund-1" });
  mocks.rpc.mockReset().mockImplementation(async name => ({ error: null, data:
    name === "begin_customer_order_cancellation" ? context
      : name === "prepare_customer_order_cancellation" ? { paymentId: "local-payment", idempotencyKey: "stable-key", refundAmountInCents: 6790, completedRefundIds: [] } : true }));
});
afterEach(() => { vi.unstubAllEnvs(); });
describe("customer cancellation orchestration", () => {
  const prepareRemaining = (amount: unknown, ids: string[] = ["partial-existing"]) => {
    const original = mocks.rpc.getMockImplementation()!;
    mocks.rpc.mockImplementation((name: string, ...args: unknown[]) => name === "prepare_customer_order_cancellation"
      ? Promise.resolve({ data: { paymentId: "local-payment", idempotencyKey: "stable-key", refundAmountInCents: amount,
        completedRefundIds: ids }, error: null }) : original(name, ...args) as Promise<unknown>);
  };
  const partial = { id: "partial-existing", status: "approved", amountInCents: 2000 };
  it("refunds only the server-reserved balance after a confirmed partial refund", async () => {
    prepareRemaining(4790);
    mocks.get.mockResolvedValue({ ...payment, refunds: [partial] });
    expect((await cancelCustomerOrder("order", "owner")).body).toMatchObject({ status: "refunded" });
    expect(mocks.refund).toHaveBeenCalledExactlyOnceWith("mp-1", 4790, "stable-key");
    expect(mocks.rpc).toHaveBeenCalledWith("finalize_mercadopago_refund", expect.objectContaining({ p_refund_amount: 47.9 }));
  });
  it("does not acknowledge the previous partial as a new refund when the amounts are equal", async () => {
    prepareRemaining(3395);
    mocks.get.mockResolvedValue({ ...payment, refunds: [{ ...partial, amountInCents: 3395 }] });
    expect((await cancelCustomerOrder("order", "owner")).body).toMatchObject({ status: "refunded" });
    expect(mocks.refund).toHaveBeenCalledExactlyOnceWith("mp-1", 3395, "stable-key");
  });
  it("reconciles a lost response for the remaining refund without another POST", async () => {
    prepareRemaining(4790);
    mocks.get.mockResolvedValue({ ...payment, status: "refunded", refunds: [partial,
      { id: "remaining-confirmed", status: "approved", amountInCents: 4790 }] });
    expect((await cancelCustomerOrder("order", "owner")).body).toMatchObject({ status: "refunded" });
    expect(mocks.refund).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith("finalize_mercadopago_refund", expect.objectContaining({
      p_provider_refund_id: "remaining-confirmed", p_refund_amount: 47.9 }));
  });
  it("retries an uncertain remaining refund with the same amount and key", async () => {
    prepareRemaining(4790);
    mocks.get.mockResolvedValue({ ...payment, refunds: [partial] });
    mocks.refund.mockRejectedValueOnce(new Error("timeout"));
    expect((await cancelCustomerOrder("order", "owner")).body).toMatchObject({ status: "refund_pending" });
    expect((await cancelCustomerOrder("order", "owner")).body).toMatchObject({ status: "refunded" });
    expect(mocks.refund.mock.calls).toEqual([["mp-1", 4790, "stable-key"], ["mp-1", 4790, "stable-key"]]);
  });
  it.each([undefined, 0, -1, 6791, 47.9])("holds an invalid server balance %s without requesting money", async amount => {
    prepareRemaining(amount);
    expect((await cancelCustomerOrder("order", "owner")).body).toMatchObject({ status: "refund_pending" });
    expect(mocks.refund).not.toHaveBeenCalled();
  });
  it("holds a partial refund whose webhook has not been reconciled locally", async () => {
    mocks.get.mockResolvedValue({ ...payment, refunds: [partial] });
    expect((await cancelCustomerOrder("order", "owner")).body).toMatchObject({ status: "refund_pending" });
    expect(mocks.refund).not.toHaveBeenCalled();
  });
  it("holds an unconfirmed provider refund without a second request", async () => {
    mocks.get.mockResolvedValue({ ...payment, refunds: [{ ...partial, status: "pending" }] });
    expect((await cancelCustomerOrder("order", "owner")).body).toMatchObject({ status: "refund_pending" });
    expect(mocks.refund).not.toHaveBeenCalled();
  });
  it("blocks a cancellation from another environment before claiming or refunding", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    expect((await cancelCustomerOrder("order", "owner")).statusCode).toBe(409);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("check_mercadopago_order_mode", { p_mode: "test", p_order_id: "order", p_customer_id: "owner" });
    expect(mocks.refund).not.toHaveBeenCalled();
  });
  it("passes the explicit production mode and authenticated owner to the guard", async () => {
    vi.stubEnv("MERCADO_PAGO_ENVIRONMENT", "production"); vi.stubEnv("MERCADO_PAGO_PRODUCTION_READY", "true");
    vi.stubEnv("MERCADO_PAGO_ACCESS_TOKEN", "APP_USR-fixture"); vi.stubEnv("NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY", "APP_USR-public");
    expect((await cancelCustomerOrder("order", "owner")).body).toMatchObject({ status: "refunded" });
    expect(mocks.rpc).toHaveBeenCalledWith("check_mercadopago_order_mode", { p_mode: "production", p_order_id: "order", p_customer_id: "owner" });
  });
  it("unpaid checkout without a provider payment cancels without refund", async () => {
    context = { ...context, paid: false, providerPaymentId: "", paymentInFlight: false };
    expect((await cancelCustomerOrder("order", "owner")).body).toMatchObject({ status: "cancelled" });
    expect(mocks.rpc).toHaveBeenCalledWith("begin_customer_order_cancellation", { p_order_id: "order", p_customer_id: "owner" });
    expect(mocks.rpc).toHaveBeenCalledWith("prepare_customer_order_cancellation", { p_order_id: "order", p_customer_id: "owner", p_paid: false });
    expect(mocks.refund).not.toHaveBeenCalled(); expect(mocks.get).not.toHaveBeenCalled();
  });
  it.each(["pending", "in_process", "authorized"])("cancels %s provider payment before confirming local cancellation", async status => {
    context.paid = false; mocks.get.mockResolvedValue({ ...payment, status });
    expect((await cancelCustomerOrder("order", "owner")).body).toMatchObject({ status: "cancelled" });
    expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith("mp-1"); expect(mocks.refund).not.toHaveBeenCalled();
  });
  it.each(["processing", "picking", "ready_to_ship"])("paid %s requests full refund using backend data", async status => {
    context.status = status;
    expect((await cancelCustomerOrder("order", "owner")).body).toMatchObject({ status: "refunded" });
    expect(mocks.refund).toHaveBeenCalledExactlyOnceWith("mp-1",6790,"stable-key");
    expect(mocks.rpc).toHaveBeenCalledWith("finalize_mercadopago_refund", expect.objectContaining({ p_payment_id: "local-payment", p_requested_by: "owner", p_refund_amount: 67.9 }));
  });
  it("payment approved during cancellation follows refund instead of unpaid cancellation", async () => {
    context.paid = false;
    expect((await cancelCustomerOrder("order", "owner")).body).toMatchObject({ status: "refunded" });
    expect(mocks.cancel).not.toHaveBeenCalled();
  });
  it("rejected ownership/dispatch guard makes no provider request", async () => {
    mocks.rpc.mockResolvedValue({ error: { message: "cancellation_not_allowed" }, data: null });
    expect((await cancelCustomerOrder("order", "other")).statusCode).toBe(409);
    expect(mocks.get).not.toHaveBeenCalled(); expect(mocks.refund).not.toHaveBeenCalled();
  });
  it("concurrent RPC lease admits one external refund", async () => {
    let claimed = false;
    mocks.rpc.mockImplementation(async name => {
      if (name === "check_mercadopago_order_mode") return { data: true, error: null };
      if (name === "begin_customer_order_cancellation") {
        const data = claimed ? { busy: true } : context; claimed = true; return { data, error: null };
      }
      return { data: name === "prepare_customer_order_cancellation" ? { paymentId: "local-payment", idempotencyKey: "stable-key", refundAmountInCents: 6790, completedRefundIds: [] } : true, error: null };
    });
    await Promise.all([cancelCustomerOrder("order","owner"),cancelCustomerOrder("order","owner")]);
    expect(mocks.refund).toHaveBeenCalledTimes(1);
  });
  it("uncertain refund stays held and retry reuses exactly the same key", async () => {
    mocks.refund.mockRejectedValueOnce(new Error("timeout"));
    expect((await cancelCustomerOrder("order","owner")).body).toMatchObject({ status: "refund_pending" });
    await cancelCustomerOrder("order","owner");
    expect(mocks.refund.mock.calls).toEqual([["mp-1",6790,"stable-key"],["mp-1",6790,"stable-key"]]);
    const calls = mocks.rpc.mock.calls as Array<[string, { p_paid?: boolean }]>;
    expect(calls.some(([, args]) => args?.p_paid === false)).toBe(false);
  });
  it("already completed cancellation has no external effects", async () => {
    context.status = "refunded";
    expect((await cancelCustomerOrder("order","owner")).body).toMatchObject({ status: "refunded" });
    expect(mocks.refund).not.toHaveBeenCalled();
  });
  it("lost refund response reconciles the provider refund without issuing a second one", async () => {
    mocks.get.mockResolvedValue({ ...payment, status: "refunded", refunds: [{ id: "refund-existing", status: "approved", amountInCents: 6790 }] });
    expect((await cancelCustomerOrder("order","owner")).body).toMatchObject({ status: "refunded" });
    expect(mocks.refund).not.toHaveBeenCalled();
  });
  it("unknown in-flight payment is held, not cancelled blindly", async () => {
    context = { ...context, providerPaymentId: "", paid: false, paymentInFlight: true };
    expect((await cancelCustomerOrder("order","owner")).statusCode).toBe(202);
    expect(mocks.rpc).not.toHaveBeenCalledWith("prepare_customer_order_cancellation", expect.anything());
  });
  it.each(["shipped", "delivered", "refunded", "cancelled"])("%s hides cancellation and payment", status => {
    expect(canCancelCustomerOrder(status)).toBe(false);
    expect(canContinueOrderPayment(status,"pending","pix")).toBe(false);
  });
  it("dispatched shipment overrides stale order state", () => {
    expect(canCancelCustomerOrder("ready_to_ship","ready","2026-09-14T00:00:00Z")).toBe(false);
    expect(canCancelCustomerOrder("picking","dispatched")).toBe(false);
    expect(canCancelCustomerOrder("ready_to_ship","ready")).toBe(true);
  });
});

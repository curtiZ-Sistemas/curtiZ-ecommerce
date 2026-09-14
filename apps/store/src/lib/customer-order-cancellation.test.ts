import { beforeEach, describe, expect, it, vi } from "vitest";
import { cancelCustomerOrder } from "./customer-order-cancellation";
import { canCancelCustomerOrder, canContinueOrderPayment } from "./customer-account-presentation";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), get: vi.fn(), cancel: vi.fn(), refund: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./supabase/server", () => ({ createServiceSupabaseClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@curtiz/integrations", () => ({ MercadoPagoTestPaymentProvider: class {
  getPayment = mocks.get; cancelPayment = mocks.cancel; refundPayment = mocks.refund;
} }));
const payment = { id: "mp-1", externalReference: "CZT-1", amountInCents: 6790, currency: "BRL", status: "approved", refunds: [] };
let context: Record<string, unknown>;
beforeEach(() => {
  vi.clearAllMocks();
  context = { orderCode: "CZT-1", amountInCents: 6790, providerPaymentId: "mp-1", paid: true };
  mocks.get.mockReset().mockResolvedValue(payment);
  mocks.cancel.mockReset().mockResolvedValue({ ...payment, status: "cancelled" });
  mocks.refund.mockReset().mockResolvedValue({ id: "refund-1" });
  mocks.rpc.mockReset().mockImplementation(async name => ({ error: null, data:
    name === "begin_customer_order_cancellation" ? context
      : name === "prepare_customer_order_cancellation" ? { paymentId: "local-payment", idempotencyKey: "stable-key" } : true }));
});
describe("customer cancellation orchestration", () => {
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
      if (name === "begin_customer_order_cancellation") {
        const data = claimed ? { busy: true } : context; claimed = true; return { data, error: null };
      }
      return { data: name === "prepare_customer_order_cancellation" ? { paymentId: "local-payment", idempotencyKey: "stable-key" } : true, error: null };
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

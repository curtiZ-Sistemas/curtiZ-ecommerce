import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ mode: "test", get: vi.fn(), cancel: vi.fn(), call: vi.fn(), record: vi.fn(), reconcile: vi.fn(), assert: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({}) }));
vi.mock("@curtiz/config", () => ({ getMercadoPagoCredentials: () => ({ mode: state.mode, accessToken: "TEST-fixture" }) }));
vi.mock("@curtiz/security", () => ({ logServerEvent: vi.fn() }));
vi.mock("@curtiz/integrations", () => ({ MercadoPagoPaymentProvider: class { getPayment = state.get; cancelPayment = state.cancel; } }));
vi.mock("./representative-test-transactions", () => ({ kitCall: state.call, kitRecord: state.record,
  reconcileKitTestPayment: state.reconcile, assertKitPayment: state.assert }));
import { runRepresentativeTestJobs } from "./representative-test-jobs";
const environment = { SUPABASE_URL: "https://isolated.supabase.co", SUPABASE_SECRET_KEY: "test-only-key" };
beforeEach(() => { vi.clearAllMocks(); state.mode = "test"; });
describe("kit TEST expiration queue", () => {
  it("does no work with production credentials", async () => {
    state.mode = "production";
    await runRepresentativeTestJobs(environment);
    expect(state.call).not.toHaveBeenCalled();
  });
  it("releases an unstarted intent through its checked RPC", async () => {
    state.call.mockImplementation(async (...args: unknown[]) => args[1] === "due_kit_test_transactions" ? [{ orderId: "order", actorId: "actor" }] : true);
    await expect(runRepresentativeTestJobs(environment)).resolves.toEqual({ processed: 1, failed: 0 });
    expect(state.get).not.toHaveBeenCalled();
  });
  it("validates provider identity before any cancellation", async () => {
    state.call.mockResolvedValue([{ orderId: "order", actorId: "actor", providerPaymentId: "123" }]);
    state.get.mockResolvedValue({ status: "pending", expiresAt: "2020-01-01T00:00:00Z" });
    state.record.mockResolvedValue({ state: "reserved" });
    state.assert.mockImplementation(() => { throw new Error("mismatch"); });
    await expect(runRepresentativeTestJobs(environment)).resolves.toEqual({ processed: 0, failed: 1 });
    expect(state.cancel).not.toHaveBeenCalled();
    state.assert.mockReset();
  });
  it("preserves approval when it wins an expiration race", async () => {
    state.call.mockResolvedValue([{ orderId: "order", actorId: "actor", providerPaymentId: "123" }]);
    state.record.mockResolvedValue({ state: "reserved" });
    state.get.mockResolvedValue({ status: "approved" });
    await runRepresentativeTestJobs(environment);
    expect(state.cancel).not.toHaveBeenCalled();
    expect(state.reconcile).toHaveBeenCalled();
  });
  it("does not cancel when the provider reports a future expiration", async () => {
    state.call.mockResolvedValue([{ orderId: "order", actorId: "actor", providerPaymentId: "123" }]);
    state.record.mockResolvedValue({ state: "reserved" });
    state.get.mockResolvedValue({ status: "pending", expiresAt: "2099-01-01T00:00:00Z" });
    await runRepresentativeTestJobs(environment);
    expect(state.cancel).not.toHaveBeenCalled();
  });
  it("continues to other jobs after an isolated failure", async () => {
    state.call.mockImplementation(async (...args: unknown[]) => args[1] === "due_kit_test_transactions"
      ? [{ orderId: "bad", actorId: "actor", providerPaymentId: "123" }, { orderId: "unstarted", actorId: "actor" }] : true);
    state.get.mockRejectedValue(new Error("provider unavailable"));
    await expect(runRepresentativeTestJobs(environment)).resolves.toEqual({ processed: 1, failed: 1 });
  });
});

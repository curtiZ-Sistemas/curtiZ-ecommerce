import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ rpc: vi.fn(), cancel: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@curtiz/security", () => ({ logServerEvent: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc: state.rpc }) }));
vi.mock("./customer-order-cancellation", () => ({ cancelCustomerOrder: state.cancel }));
import { runAfterSaleJobs } from "./after-sale-jobs";

const environment = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SECRET_KEY: "test-only" };
beforeEach(() => {
  vi.clearAllMocks(); let claimed = false;
  state.rpc.mockImplementation(async name => ({ error: null, data: name === "claim_after_sale_job"
    ? claimed ? null : (claimed = true, { id: "job-1", orderId: "order-1", customerId: "owner-1" }) : true }));
  state.cancel.mockReset().mockResolvedValue({ statusCode: 202, body: { status: "refund_pending" } });
});
describe("after-sale recovery", () => {
  it("uses the same service and owner from the durable job, retaining unconfirmed results", async () => {
    await runAfterSaleJobs(environment, "test");
    expect(state.cancel).toHaveBeenCalledWith("order-1", "owner-1", expect.objectContaining({ environment }));
    expect(state.rpc).toHaveBeenCalledWith("finish_after_sale_job", expect.objectContaining({ p_completed: false }));
  });
  it("acknowledges only confirmed cancellation or refund", async () => {
    state.cancel.mockResolvedValue({ statusCode: 200, body: { status: "refunded" } });
    await runAfterSaleJobs(environment, "test");
    expect(state.rpc).toHaveBeenCalledWith("finish_after_sale_job", expect.objectContaining({ p_completed: true }));
  });
  it("retains the operation after an unexpected provider failure", async () => {
    state.cancel.mockRejectedValue(new Error("provider unavailable"));
    await expect(runAfterSaleJobs(environment, "test")).rejects.toThrow("provider unavailable");
    expect(state.rpc).toHaveBeenCalledWith("finish_after_sale_job", expect.objectContaining({ p_completed: false }));
  });
});

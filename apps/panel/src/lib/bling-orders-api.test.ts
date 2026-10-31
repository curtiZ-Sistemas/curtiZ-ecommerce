import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const state = vi.hoisted(() => ({ rpc: vi.fn(), active: true, role: "technical", mfa: true, origin: true, budget: true }));
vi.mock("server-only", () => ({}));
vi.mock("@curtiz/security", () => ({ DEMO_SESSION_COOKIE: "demo", verifyDemoSession: () => false }));
vi.mock("@/lib/api-rate-limit", () => ({ consumePanelMutationBudget: () => state.budget }));
vi.mock("@/lib/technical-api", () => ({ safeTechnicalOrigin: () => state.origin, technicalNoStore: { "cache-control": "private, no-store" } }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "operator" } }, error: null }) }, rpc: state.rpc,
  from: (table: string) => ({ select: () => ({ eq: () => table === "profiles"
    ? { maybeSingle: async () => ({ data: { status: state.active ? "active" : "blocked" }, error: null }) }
    : Promise.resolve({ data: [{ role: state.role }], error: null }) }) })
}) }));
import { POST } from "../app/api/integrations/bling/orders/route";
const orderId = "11111111-1111-4111-8111-111111111111";
const request = (action: string) => new NextRequest("https://panel.example/api/integrations/bling/orders", {
  method: "POST", body: JSON.stringify({ orderId, action }), headers: { "content-type": "application/json" }
});
beforeEach(() => { vi.clearAllMocks(); Object.assign(state, { active: true, role: "technical", mfa: true, origin: true, budget: true }); state.rpc.mockResolvedValue({ data: true, error: null }); });
describe("panel fiscal queue actions", () => {
  it.each(["prepare", "send", "consult"])("enqueues %s through the permission checked RPC", async action => {
    expect((await POST(request(action))).status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith("request_bling_invoice_action", { p_order_id: orderId, p_action: action });
  });
  it.each(["active", "origin"] as const)("requires %s before mutation", async guard => {
    state[guard] = false;
    expect((await POST(request("send"))).status).toBe(403);
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("rejects customer access and rate limited requests", async () => {
    state.role = "customer";
    expect((await POST(request("send"))).status).toBe(403);
    state.role = "technical"; state.budget = false;
    expect((await POST(request("send"))).status).toBe(429);
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("reports a duplicate or unsafe job as conflict", async () => {
    state.rpc.mockResolvedValue({ data: false, error: null });
    expect((await POST(request("send"))).status).toBe(409);
  });
});

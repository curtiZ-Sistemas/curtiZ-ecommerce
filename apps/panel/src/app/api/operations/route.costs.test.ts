import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({ rpc: vi.fn(), selects: [] as string[] }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/internal-mfa", () => ({ hasRequiredInternalMfa: async () => true }));
vi.mock("../../../lib/api-rate-limit", () => ({ consumePanelMutationBudget: async () => true, panelRateLimitStatus: () => 401 }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "operator" } }, error: null }) },
    rpc: state.rpc,
    from: (table: string) => {
      const data = table === "profiles" ? { status: "active" } : table === "user_roles" ? [{ role: "operational" }] : table === "orders" ? [{
        id: "order", public_code: "TEST", status: "processing", payment_status: "approved",
        shipments: [{ id: "shipment", shipping_amount: 12 }], order_items: [], order_status_history: [], order_notes: []
      }] : [];
      const response = { data, count: table === "orders" ? 1 : 0, error: null };
      const query = {
        select: (selection: string) => { if (table === "orders") state.selects.push(selection); return query; },
        eq: () => query, neq: () => query, in: () => query, order: () => query,
        range: () => query, limit: () => query, or: () => query,
        maybeSingle: async () => response,
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(response).then(resolve)
      };
      return query;
    }
  })
}));
import { GET } from "./route";

beforeEach(() => {
  state.selects.length = 0;
  state.rpc.mockReset().mockImplementation(async (name: string) => ({
    data: name === "operational_read_shipment_costs" ? [{ shipment_id: "shipment", shipping_cost: 7 }] : true,
    error: null
  }));
});

describe("operational shipment cost responses", () => {
  it("reads costs through the protected function after fetching orders", async () => {
    const response = await GET(new NextRequest("http://localhost/api/operations?section=pedidos"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ orders: [{ shipments: [{ shippingCost: 7 }] }] });
    expect(state.selects[0]).not.toContain("shipping_cost");
    expect(state.rpc).toHaveBeenCalledWith("operational_read_shipment_costs", { p_shipment_ids: ["shipment"] });
  });
  it("fails closed instead of reporting an invented cost", async () => {
    state.rpc.mockImplementation(async (name: string) => ({ data: name === "operational_read_shipment_costs" ? [] : true, error: null }));
    const response = await GET(new NextRequest("http://localhost/api/operations?section=pedidos"));
    expect(response.status).toBe(503);
  });
  it("preserves an unrecorded cost as null", async () => {
    state.rpc.mockImplementation(async (name: string) => ({ data: name === "operational_read_shipment_costs" ? [{ shipment_id: "shipment", shipping_cost: null }] : true, error: null }));
    const response = await GET(new NextRequest("http://localhost/api/operations?section=pedidos"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ orders: [{ shipments: [{ shippingCost: null }] }] });
  });
});

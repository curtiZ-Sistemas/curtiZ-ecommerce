import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  select: vi.fn()
}));
vi.mock("@/lib/manager-api", () => ({
  authorizeManagerRequest: async () => ({ supabase: {
    rpc: state.rpc,
    from: () => {
      const query = {
        select: (value: string) => { state.select(value); return query; },
        order: () => query,
        range: async () => ({ data: [{ id: "one", public_code: "A" }], count: 1, error: null }),
        limit: async () => ({ data: [{ id: "one", public_code: "A" }], error: null })
      };
      return query;
    }
  } }),
  managerNoStore: { "cache-control": "private, no-store" },
  managerRows: (value: unknown): unknown[] => Array.isArray(value) ? value as unknown[] : [],
  unauthorizedManagerResponse: () => new Response(null, { status: 401 })
}));
import { GET } from "./route";

const context = { params: Promise.resolve({ resource: "pedidos-vendas" }) };
beforeEach(() => {
  state.select.mockReset();
  state.rpc.mockReset().mockImplementation(async (name: string) => ({
    data: name === "manager_read_order_profits" ? [{ order_id: "one", estimated_profit: 4 }] : true,
    error: null
  }));
});

describe("manager order profit responses", () => {
  it("reads profit only through the protected function", async () => {
    const result = await GET(new NextRequest("http://localhost/api/manager/resources/pedidos-vendas"), context);
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ items: [{ id: "one", estimated_profit: 4 }] });
    expect(state.select).toHaveBeenCalled();
    expect(String(state.select.mock.calls[0]?.[0])).not.toContain("estimated_profit");
    expect(state.rpc).toHaveBeenCalledWith("manager_read_order_profits", { p_order_ids: ["one"] });
  });
  it("returns an error when protected profit data is missing", async () => {
    state.rpc.mockImplementation(async (name: string) => ({ data: name === "manager_read_order_profits" ? [] : true, error: null }));
    const result = await GET(new NextRequest("http://localhost/api/manager/resources/pedidos-vendas"), context);
    expect(result.status).toBe(503);
  });
  it("uses confirmed profits in authorized CSV exports", async () => {
    const result = await GET(new NextRequest("http://localhost/api/manager/resources/pedidos-vendas?format=csv"), context);
    expect(result.status).toBe(200);
    expect(await result.text()).toContain('"4"');
    expect(state.rpc).toHaveBeenCalledWith("manager_log_export", expect.any(Object));
  });
  it("does not export or audit a CSV if profit confirmation fails", async () => {
    state.rpc.mockImplementation(async (name: string) => ({ data: name === "manager_read_order_profits" ? null : true, error: name === "manager_read_order_profits" ? { code: "42501" } : null }));
    const result = await GET(new NextRequest("http://localhost/api/manager/resources/pedidos-vendas?format=csv"), context);
    expect(result.status).toBe(503);
    expect(state.rpc).not.toHaveBeenCalledWith("manager_log_export", expect.any(Object));
  });
});

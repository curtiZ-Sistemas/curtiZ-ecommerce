import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ client: vi.fn(), rpc: vi.fn(), selects: [] as string[] }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.client }));
vi.mock("@/lib/api-rate-limit", () => ({
  consumePanelMutationBudget: vi.fn(async () => true),
  panelRateLimitFailure: vi.fn(),
  panelRateLimitStatus: vi.fn(() => 401)
}));
import { GET } from "./route";

const productId = "fb300000-0000-4000-8000-000000000001";
const variantId = "fb400000-0000-4000-8000-000000000001";

beforeEach(() => {
  mocks.selects.length = 0;
  mocks.rpc.mockReset();
  mocks.rpc.mockImplementation(async (name: string) => {
    if (name === "has_permission") return { data: true, error: null };
    if (name === "admin_product_delete_eligibility") return { data: {}, error: null };
    if (name === "admin_read_catalog_costs") return { data: [{ product_id: productId, product_cost: 12.5, variants: { [variantId]: 8.25 } }], error: null };
    return { data: null, error: null };
  });
  mocks.client.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "admin" } }, error: null }) },
    rpc: mocks.rpc,
    from: (table: string) => {
      const data = table === "profiles" ? { status: "active" }
        : table === "user_roles" ? [{ role: "admin" }]
          : table === "products" ? [{ id: productId, name: "Produto", slug: "produto", status: "draft", base_price: 50, product_variants: [{ id: variantId, active: true }] }]
            : [];
      const result = { data, error: null, count: table === "products" ? 1 : 0 };
      const query = {
        select: (selection: string) => { if (table === "products") mocks.selects.push(selection); return query; },
        eq: () => query,
        neq: () => query,
        in: () => query,
        or: () => query,
        order: () => query,
        limit: () => query,
        range: () => query,
        maybeSingle: async () => result,
        then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve)
      };
      return query;
    }
  });
});

describe("catalog product cost access", () => {
  it("loads costs only through the protected reader", async () => {
    const response = await GET(new NextRequest("http://localhost:3001/api/catalog/products"));
    expect(response.status).toBe(200);
    expect(mocks.selects[0]).not.toMatch(/cost_price|cost_override/u);
    expect(mocks.rpc).toHaveBeenCalledWith("admin_read_catalog_costs", { p_product_ids: [productId] });
    const body: unknown = await response.json();
    expect(body).toMatchObject({ products: [{ id: productId, costInCents: 1250, variants: [{ id: variantId, costInCents: 825 }] }] });
  });

  it("returns an error instead of unconfirmed costs if the reader fails", async () => {
    mocks.rpc.mockImplementation(async (name: string) => name === "has_permission"
      ? { data: true, error: null }
      : { data: null, error: { message: "unavailable" } });
    const response = await GET(new NextRequest("http://localhost:3001/api/catalog/products"));
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty("products");
  });

  it("loads protected costs after filtering out-of-stock products", async () => {
    const response = await GET(new NextRequest("http://localhost:3001/api/catalog/products?stock=out"));
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(body).toMatchObject({ products: [{ id: productId, costInCents: 1250, variants: [{ id: variantId, costInCents: 825 }] }] });
    expect(mocks.rpc).toHaveBeenCalledWith("admin_read_catalog_costs", { p_product_ids: [productId] });
  });
});

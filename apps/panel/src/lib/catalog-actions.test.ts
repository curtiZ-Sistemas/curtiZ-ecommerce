import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type * as Security from "@curtiz/security";

type QueryResult = { data: unknown; error: { code: string; message: string; details?: string } | null; count?: number };

const state = vi.hoisted(() => ({
  client: vi.fn<() => Promise<unknown>>(),
  query: vi.fn<(table: string, selection: string, mutation?: Record<string, unknown>) => QueryResult>(),
  rpc: vi.fn<(name: string, parameters?: Record<string, unknown>) => Promise<QueryResult>>(),
  remove: vi.fn<(paths: string[]) => Promise<{ error: null }>>()
}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: state.client }));
vi.mock("@/lib/internal-mfa", () => ({ hasRequiredInternalMfa: async () => true }));
vi.mock("@curtiz/security", async (importOriginal) => ({
  ...await importOriginal<typeof Security>(),
  verifyDemoSession: () => null
}));
vi.mock("@/lib/public-media", () => import("./public-media"));
vi.mock("@/lib/postgres-uuid", () => import("./postgres-uuid"));
vi.mock("@/lib/admin-resources", () => import("./admin-resources"));
vi.mock("@/lib/admin-api", () => ({
  authorizeAdminRequest: async () => ({ supabase: await state.client(), userId: "admin" }),
  objectRows: (value: unknown): unknown[] => Array.isArray(value) ? value as unknown[] : [],
  privateNoStore: { "cache-control": "private, no-store" },
  safePanelOrigin: () => true,
  unauthorizedAdminResponse: () => new Response(null, { status: 401 })
}));
import { GET, PATCH, DELETE } from "../app/api/catalog/products/route";
import { POST as createCategory, PATCH as updateCategory, DELETE as deleteCategory } from "../app/api/admin/resources/[resource]/route";

const id = "20000000-0000-4000-8000-000000000001";
const image = { id, storage_path: "/test.webp", alt_text: "Teste", is_primary: true, sort_order: 0, width: 100, height: 100 };
const product = { id, name: "Produto teste", slug: "teste", status: "draft", base_price: 10, product_images: [image], product_variants: [{ id, sku: "TEST", color_name: "Azul", size: "36", active: true, inventory: { available_quantity: 2, reserved_quantity: 0 } }] };
const permissionError = { code: "42501", message: "internal permission detail", details: "internal query detail" };
const request = (method = "GET", body?: unknown) => new NextRequest("http://localhost:3001/api/catalog/products", {
  method, ...(body ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {})
});
const categoryContext = { params: Promise.resolve({ resource: "categorias" }) };

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  state.query.mockReset().mockImplementation((table: string) => ({
    data: table === "profiles" ? { status: "active" } : table === "user_roles" ? [{ role: "admin" }] : table === "products" ? [product] : [],
    error: null, count: table === "products" ? 1 : 0
  }));
  state.rpc.mockReset().mockImplementation((name: string) => Promise.resolve({
    data: name === "has_permission" ? true : name === "admin_delete_product" ? { deleted: true, storagePaths: ["products/test.webp"] } : { [id]: { canDelete: true, blockers: [] } }, error: null
  }));
  state.remove.mockReset().mockResolvedValue({ error: null });
  state.client.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "admin" } }, error: null }) },
    rpc: state.rpc,
    storage: { from: () => ({ remove: state.remove }) },
    from: (table: string) => {
      let selection = "";
      let mutation: Record<string, unknown> | undefined;
      const chain = {
        select: (value: string) => { selection = value; return chain; },
        insert: (value: Record<string, unknown>) => { mutation = value; return chain; },
        update: (value: Record<string, unknown>) => { mutation = value; return chain; },
        delete: () => chain,
        eq: () => chain, neq: () => chain, in: () => chain, order: () => chain, range: () => chain, limit: () => chain,
        single: () => chain, maybeSingle: () => chain,
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(state.query(table, selection, mutation)).then(resolve)
      };
      return chain;
    }
  });
});
afterEach(() => vi.restoreAllMocks());

describe("catalog GET essentials", () => {
  it("loads images, variants and inventory using the explicit primary-category relation", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(body).toMatchObject({ products: [{ images: [{ primary: true, url: "http://localhost:3000/test.webp" }], variants: [{ sku: "TEST", available: 2 }] }] });
    expect(state.query.mock.calls.find(([table]) => table === "products")?.[1]).toContain("categories!products_category_id_fkey(name)");
  });
  it("keeps essential data in the older-schema fallback and logs the selected fallback", async () => {
    const normal = state.query.getMockImplementation()!;
    state.query.mockImplementation((table, select, values) => table === "products" && select.includes("product_media(")
      ? { data: null, error: { code: "PGRST200", message: "missing media relationship" } }
      : normal(table, select, values));
    const response = await GET(request());
    const body: unknown = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ products: [{ images: [{ primary: true }], variants: [{ sku: "TEST", available: 2 }] }] });
    expect(console.warn).toHaveBeenCalledWith(expect.any(String), { select: "compatibleProductSelect" });
  });
  it("does not hide permission errors behind products with empty images or variants", async () => {
    const normal = state.query.getMockImplementation()!;
    state.query.mockImplementation((table, select, values) => table === "products" ? { data: null, error: permissionError } : normal(table, select, values));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("internal");
    expect(state.query.mock.calls.filter(([table]) => table === "products")).toHaveLength(1);
  });
});

describe("product DELETE", () => {
  it("returns success and removes the media paths returned by the RPC", async () => {
    const response = await DELETE(request("DELETE", { productId: id }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
    expect(state.remove).toHaveBeenCalledWith(["products/test.webp"]);
  });
  it("keeps a legitimate conflict and returns its readable blockers", async () => {
    state.rpc.mockImplementation(async (name: string) => name === "admin_delete_product"
      ? { data: null, error: { code: "23503", message: "product has related records" } }
      : { data: { [id]: { canDelete: false, blockers: ["pedidos"] } }, error: null });
    const response = await DELETE(request("DELETE", { productId: id }));
    expect(response.status).toBe(409);
    expect(await response.json() as unknown).toMatchObject({ message: expect.stringContaining("pedidos. Use Arquivar") as unknown });
    expect(state.remove).not.toHaveBeenCalled();
  });
});

describe("product save", () => {
  const savePayload = (status: "draft" | "active", variants = [{ sku: "", color: "Padrão", colorHex: "", size: "Único", priceInCents: null, costInCents: null, stock: 2, active: true, gtin: "", mpn: "" }]) => ({
    action: "save", name: "Produto teste", slug: "", shortDescription: "", description: "Descrição",
    categoryId: status === "active" ? id : null, categoryIds: status === "active" ? [id] : [], modelId: null,
    collectionId: null, status, featured: false, priceInCents: status === "active" ? 1000 : null,
    compareAtPriceInCents: null, costInCents: null, weightGrams: null, heightCm: null, widthCm: null,
    lengthCm: null, stockReason: "Cadastro inicial", variants,
    sizeGuide: [{ size: "36", measurementCm: 24.5 }]
  });

  beforeEach(() => {
    state.query.mockImplementation((table) => ({
      data: table === "profiles" ? { status: "active" } : table === "user_roles" ? [{ role: "admin" }] : table === "categories" ? { name: "Slides" } : null,
      error: null
    }));
    state.rpc.mockImplementation(async (name) => ({ data: name === "admin_save_product_authorized" ? id : true, error: null }));
  });

  it("creates draft, published and variation products through PATCH", async () => {
    for (const payload of [
      savePayload("draft"),
      savePayload("active"),
      savePayload("active", [
        { sku: "SKU-36", color: "Azul", colorHex: "#0000ff", size: "36", priceInCents: null, costInCents: null, stock: 1, active: true, gtin: "", mpn: "MPN-36" },
        { sku: "SKU-37", color: "Azul", colorHex: "#0000ff", size: "37", priceInCents: null, costInCents: null, stock: 1, active: true, gtin: "", mpn: "MPN-37" }
      ])
    ]) {
      const response = await PATCH(request("PATCH", payload));
      expect(response.status).toBe(200);
      expect(await response.json() as unknown).toMatchObject({ ok: true, productId: id });
    }
    const saveCall = state.rpc.mock.calls.find(([name]) => name === "admin_save_product_authorized");
    expect(saveCall?.[1]).toMatchObject({
      p_payload: { sizeGuide: [{ size: "36", measurementCm: 24.5 }] }
    });
  });

  it("converts a slug lookup failure into useful JSON instead of a raw 500", async () => {
    state.query.mockImplementation((table) => table === "products"
      ? { data: null, error: { code: "57014", message: "internal timeout" } }
      : { data: table === "profiles" ? { status: "active" } : [{ role: "admin" }], error: null });
    const response = await PATCH(request("PATCH", savePayload("draft")));
    expect(response.status).toBe(503);
    expect(await response.json() as unknown).toMatchObject({ message: expect.stringContaining("Seus dados foram mantidos") as unknown });
    expect(console.error).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ operation: "generate_slug", code: "57014" }));
  });
});

describe("category mutations", () => {
  it("preserves an explicit slug on create and edit", async () => {
    const normal = state.query.getMockImplementation()!;
    state.query.mockImplementation((table, select, values) => table === "categories" ? { data: { id, ...values }, error: null } : normal(table, select, values));
    const values = { name: "Slides", slug: "slides-original", active: true, sort_order: 0 };
    expect((await createCategory(request("POST", { values }), categoryContext)).status).toBe(201);
    expect((await updateCategory(request("PATCH", { id, values }), categoryContext)).status).toBe(200);
    for (const call of state.query.mock.calls.filter(([table]) => table === "categories")) {
      expect(call[2]).toMatchObject({ slug: "slides-original" });
    }
  });
  it("returns a field error for an actual duplicate slug, with server-only diagnostics", async () => {
    state.query.mockReturnValue({ data: null, error: { code: "23505", message: "internal duplicate detail", details: "slug conflict" } });
    const response = await createCategory(request("POST", { values: { name: "Slides", slug: "slides", active: true } }), categoryContext);
    expect(response.status).toBe(409);
    const body: unknown = await response.json();
    expect(body).toMatchObject({ errors: { slug: expect.any(String) as unknown } });
    expect(JSON.stringify(body)).not.toContain("internal");
    expect(console.error).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ table: "categories.POST", code: "23505" }));
  });
  it("does not delete a category used by products", async () => {
    const response = await deleteCategory(request("DELETE", { id, permanent: true }), categoryContext);
    expect(response.status).toBe(409);
    expect(await response.json() as unknown).toMatchObject({ dependencies: { products: 1 } });
  });
});

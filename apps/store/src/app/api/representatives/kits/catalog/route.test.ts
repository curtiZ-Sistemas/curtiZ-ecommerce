import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ user: true, rpc: vi.fn(), configured: false, collector: "" }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: async () => ({
  auth: { getUser: async () => ({ data: { user: state.user ? { id: "synthetic-user" } : null }, error: null }) }, rpc: state.rpc
}) }));
vi.mock("@/lib/representative-commercial-payments", () => ({
  commercialKitCheckoutConfigured: () => state.configured
}));
vi.mock("@/lib/runtime-environment", () => ({ getStoreRuntimeEnvironment: () => ({
  REPRESENTATIVE_KIT_MP_COLLECTOR_ID: state.collector
}) }));
vi.mock("@/lib/unknown-data", () => import("../../../../../lib/unknown-data"));
vi.mock("@/lib/product-image-seo", () => import("../../../../../lib/product-image-seo"));
import { GET } from "./route";
const request = (offset = "0") => new NextRequest(`https://curtiz.com.br/api/representatives/kits/catalog?offset=${offset}`);
beforeEach(() => {
  state.user = true;
  state.configured = false;
  state.collector = "";
  state.rpc.mockReset();
  state.rpc.mockResolvedValue({ data: { items: [], total: 0, nextOffset: null }, error: null });
});
describe("representative existing catalog API", () => {
  it("reads a private page of products grouped by the server catalog RPC", async () => {
    const response = await GET(request("24")); expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(state.rpc).toHaveBeenCalledExactlyOnceWith("list_representative_catalog_kit_groups", {
      p_offset: 24, p_query: "", p_color: "", p_size: "", p_available: false
    });
  });
  it("forwards filters and never exposes SKU or storage paths to the representative", async () => {
    state.rpc.mockResolvedValueOnce({ data: { items: [{ productId: "p1", name: "Kit", variants: [
      { variantId: "v1", sku: "SHOPEE-X-37", color: "Bege", size: "37", imagePath: "", imageAlt: "Kit bege" }
    ] }], total: 1, nextOffset: null }, error: null });
    const response = await GET(new NextRequest(
      "https://curtiz.com.br/api/representatives/kits/catalog?q=kit&color=Bege&size=37&available=true"));
    expect(state.rpc).toHaveBeenCalledExactlyOnceWith("list_representative_catalog_kit_groups", {
      p_offset: 0, p_query: "kit", p_color: "Bege", p_size: "37", p_available: true
    });
    const body = await response.json() as { items: { variants: Record<string, unknown>[] }[] };
    expect(body.items[0]?.variants[0]).not.toHaveProperty("sku");
    expect(body.items[0]?.variants[0]).not.toHaveProperty("imagePath");
    expect(body.items[0]?.variants[0]).toMatchObject({ variantId: "v1", color: "Bege", size: "37" });
  });
  it.each(["-1", "10001", "abc", "1.5"])("rejects invalid offset %s", async offset => {
    expect((await GET(request(offset))).status).toBe(400); expect(state.rpc).not.toHaveBeenCalled();
  });
  it("preserves access to past orders while new commercial checkout is disabled", async () => {
    state.collector = "123";
    await expect((await GET(request())).json()).resolves.toEqual({
      items: [], total: 0, nextOffset: null, orderHistoryAvailable: true, checkoutConfigured: false
    });
  });
  it("requires login, distinguishes denied role and database failure", async () => {
    state.user = false; expect((await GET(request())).status).toBe(401); expect(state.rpc).not.toHaveBeenCalled();
    state.user = true; state.rpc.mockResolvedValueOnce({ data: null, error: null }); expect((await GET(request())).status).toBe(403);
    state.rpc.mockResolvedValueOnce({ data: null, error: {} }); expect((await GET(request())).status).toBe(503);
  });
});

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ user: true, rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: async () => ({
  auth: { getUser: async () => ({ data: { user: state.user ? { id: "synthetic-user" } : null }, error: null }) }, rpc: state.rpc
}) }));
import { GET } from "./route";
const request = (offset = "0") => new NextRequest(`https://curtiz.com.br/api/representatives/kits/catalog?offset=${offset}`);
beforeEach(() => { state.user = true; state.rpc.mockReset(); state.rpc.mockResolvedValue({ data: { items: [], nextOffset: null }, error: null }); });
describe("representative existing catalog API", () => {
  it("reads a private page using only the server catalog RPC", async () => {
    const response = await GET(request("24")); expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(state.rpc).toHaveBeenCalledExactlyOnceWith("list_representative_catalog_kits", { p_offset: 24 });
  });
  it.each(["-1", "10001", "abc", "1.5"])("rejects invalid offset %s", async offset => {
    expect((await GET(request(offset))).status).toBe(400); expect(state.rpc).not.toHaveBeenCalled();
  });
  it("requires login, distinguishes denied role and database failure", async () => {
    state.user = false; expect((await GET(request())).status).toBe(401); expect(state.rpc).not.toHaveBeenCalled();
    state.user = true; state.rpc.mockResolvedValueOnce({ data: null, error: null }); expect((await GET(request())).status).toBe(403);
    state.rpc.mockResolvedValueOnce({ data: null, error: {} }); expect((await GET(request())).status).toBe(503);
  });
});

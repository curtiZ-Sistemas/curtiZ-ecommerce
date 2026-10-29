import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

type TestState = { origin: boolean; user: { id: string } | null; row: Record<string, unknown> | null; queryError: unknown;
  rpc: ReturnType<typeof vi.fn>; upload: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn>; sign: ReturnType<typeof vi.fn>; prepare: ReturnType<typeof vi.fn>; rate: ReturnType<typeof vi.fn> };
const state = vi.hoisted((): TestState => ({ origin: true, user: { id: "owner" },
  row: null, queryError: null, rpc: vi.fn(), upload: vi.fn(), remove: vi.fn(), sign: vi.fn(), prepare: vi.fn(), rate: vi.fn() }));
vi.mock("@/lib/http-origin", () => ({ isAllowedRequestOrigin: () => state.origin }));
vi.mock("@/lib/image-upload", () => ({ prepareUploadImage: state.prepare }));
vi.mock("@/lib/unknown-data", () => import("../../../../lib/unknown-data"));
vi.mock("@/lib/file-validation", () => ({ inspectUpload: () => ({ mime: "image/jpeg", extension: "jpg" }) }));
vi.mock("@/lib/private-request", () => ({ PrivateRequestError: class extends Error { constructor(readonly status: number) { super(); } }, readPrivateFormData: (request: Request) => request.formData(), requirePrivateRateLimit: state.rate }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => ({ auth: { getUser: async () => ({ data: { user: state.user }, error: null }) }, rpc: state.rpc,
    from: () => { const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: state.row, error: state.queryError }) }; return query; },
    storage: { from: () => ({ createSignedUrl: state.sign }) } }),
  createServiceSupabaseClient: () => ({ storage: { from: () => ({ upload: state.upload, remove: state.remove }) } })
}));
const id = "11111111-1111-4111-8111-111111111111";
const request = (type = "image/jpeg") => {
  const body = new FormData(); body.set("file", new File(["test photo"], "photo.jpg", { type })); body.set("returnId", id);
  return new Request("https://store.example/api/customer/return-media", { method: "POST", body });
};
beforeEach(() => {
  vi.clearAllMocks(); state.origin = true; state.user = { id: "owner" }; state.queryError = null;
  state.row = { id, status: "requested", return_media: [] };
  state.rate.mockResolvedValue(undefined); state.prepare.mockResolvedValue(new Uint8Array([1, 2, 3]));
  state.upload.mockResolvedValue({ error: null }); state.rpc.mockResolvedValue({ data: id, error: null });
});
describe("private return photo boundary", () => {
  it("rejects cross-origin and anonymous uploads before storing files", async () => {
    state.origin = false; expect((await POST(request())).status).toBe(403);
    state.origin = true; state.user = null; expect((await POST(request())).status).toBe(401);
    expect(state.upload).not.toHaveBeenCalled();
  });
  it("rejects unsupported types and inaccessible returns", async () => {
    expect((await POST(request("image/svg+xml"))).status).toBe(422);
    state.row = null; expect((await POST(request())).status).toBe(409);
    expect(state.upload).not.toHaveBeenCalled();
  });
  it("does not confuse a database failure with an inaccessible return", async () => {
    state.queryError = { message: "unavailable" }; expect((await POST(request())).status).toBe(503);
    expect(state.upload).not.toHaveBeenCalled();
  });
  it("blocks more photos once the return already has three", async () => {
    state.row = { id, status: "requested", return_media: [{}, {}, {}] };
    expect((await POST(request())).status).toBe(409); expect(state.prepare).not.toHaveBeenCalled();
  });
  it("removes an uploaded object if the concurrent database cap rejects attachment", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "23514" } });
    expect((await POST(request())).status).toBe(409);
    expect(state.upload).toHaveBeenCalledTimes(1); expect(state.remove).toHaveBeenCalledTimes(1);
  });
  it("reencodes and stores privately, returning only the attached media ID", async () => {
    expect((await POST(request())).status).toBe(201);
    expect(state.upload).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^owner/${id}/.*\\.webp$`)), new Uint8Array([1, 2, 3]), { contentType: "image/webp", upsert: false });
    expect(state.rpc).toHaveBeenCalledWith("attach_customer_return_photo", expect.objectContaining({ p_return_id: id }));
  });
  it("does not sign a photo hidden by RLS", async () => {
    state.row = null; expect((await GET(new Request(`https://store.example/api/customer/return-media?id=${id}`))).status).toBe(404);
    expect(state.sign).not.toHaveBeenCalled();
  });
  it("returns a short-lived authenticated redirect without caching", async () => {
    state.row = { storage_path: "private/photo.webp" }; state.sign.mockResolvedValue({ data: { signedUrl: "https://example.supabase.co/signed/photo" }, error: null });
    const response = await GET(new Request(`https://store.example/api/customer/return-media?id=${id}`));
    expect(response.status).toBe(302); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(state.sign).toHaveBeenCalledWith("private/photo.webp", 60);
  });
});

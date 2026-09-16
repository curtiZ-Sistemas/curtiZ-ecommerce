import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
type SupportTestState = { user: string | null; role: string; denied: number;
  download: ReturnType<typeof vi.fn>; query: ReturnType<typeof vi.fn>; attachment: Record<string, unknown> | null };
const state = vi.hoisted((): SupportTestState => ({
  user: "first-user", role: "customer", denied: 0,
  download: vi.fn(), query: vi.fn(), attachment: null
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/private-request", () => import("./private-request"));
vi.mock("@/lib/http-origin", () => import("./http-origin"));
vi.mock("@/lib/unknown-data", () => import("./unknown-data"));
vi.mock("@/lib/file-validation", () => import("./file-validation"));
vi.mock("@/lib/image-upload", () => ({ prepareUploadImage: async (bytes: Uint8Array) => bytes }));
vi.mock("@/lib/demo-support-store", () => ({ DemoSupportError: class extends Error {} }));
vi.mock("@/lib/support-actor", async () => {
  const { PrivateRequestError } = await import("./private-request");
  return { getSupportActor: async () => {
    if (state.denied) throw new PrivateRequestError(state.denied);
    if (!state.user) return null;
    const query = {
      select: () => query, eq: state.query, order: () => query,
      limit: async () => ({ data: [], error: null }),
      maybeSingle: async () => ({ data: state.attachment, error: null })
    };
    state.query.mockImplementation(() => query);
    return { kind: "supabase", email: "user@example.invalid", fullName: "User", userId: state.user, role: state.role,
      supabase: { from: () => query, storage: { from: () => ({ download: state.download }) } } };
  } };
});
import { GET, POST } from "../app/api/support/route";
import { GET as download, POST as upload } from "../app/api/support/attachments/route";
const url = "https://store.example.invalid/api/support";
beforeEach(() => {
  state.user = "first-user"; state.role = "customer"; state.denied = 0; state.attachment = null;
  state.query.mockReset(); state.download.mockReset().mockResolvedValue({ data: new Blob(["test"]), error: null });
});
describe("support first-party boundary", () => {
  it("checks authentication and authorization again before accepting an ETag", async () => {
    const first = await GET(new NextRequest(url));
    const etag = first.headers.get("etag") ?? "";
    expect(etag).not.toBe("");
    const request = () => new NextRequest(url, { headers: { "if-none-match": etag } });
    expect((await GET(request())).status).toBe(304);
    state.user = "second-user";
    expect((await GET(request())).status).toBe(200);
    state.user = null;
    expect((await GET(request())).status).toBe(401);
    state.denied = 403;
    expect((await GET(request())).status).toBe(403);
  });
  it("exposes ETag to the authorized panel but rejects foreign origins and internal customer notes", async () => {
    const request = new NextRequest(url, { headers: { origin: "http://localhost:3001" } });
    vi.stubEnv("APP_ENV", "development");
    expect((await GET(request)).headers.get("access-control-expose-headers")).toBe("etag");
    vi.unstubAllEnvs();
    expect((await GET(new NextRequest(url, { headers: { origin: "https://evil.invalid" } }))).status).toBe(403);
    expect((await POST(new NextRequest(url, { method: "POST", headers: { origin: new URL(url).origin, "content-type": "application/json" },
      body: JSON.stringify({ action: "message", conversationId: "da000000-0000-4000-8000-000000000001", message: "private note", internal: true }) }))).status).toBe(403);
  });
  it("rejects unauthenticated uploads before consuming their body", async () => {
    state.user = null;
    const request = new NextRequest(`${url}/attachments`, { method: "POST", headers: { origin: new URL(url).origin }, body: "unparsed-body" });
    expect((await upload(request)).status).toBe(401);
    expect(request.bodyUsed).toBe(false);
  });
  it("downloads only metadata visible through RLS and clean objects, without returning storage URLs", async () => {
    const request = () => new NextRequest(`${url}/attachments?id=da000000-0000-4000-8000-000000000001`);
    expect((await download(request())).status).toBe(404);
    expect(state.download).not.toHaveBeenCalled();
    state.attachment = { storage_path: "own/support/file.png", original_name_sanitized: "file.png", mime_type: "image/png", scan_status: "clean" };
    const result = await download(request());
    expect(result.status).toBe(200);
    expect(state.query).toHaveBeenCalledWith("scan_status", "clean");
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(result.headers.get("content-disposition")).toBe('attachment; filename="file.png"');
    expect(result.headers.get("location")).toBeNull();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  user: true, active: true, rate: true, providerError: false,
  factors: [] as Array<{ id: string; factor_type: string; status: string }>,
  verify: vi.fn(), enroll: vi.fn(), unenroll: vi.fn()
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/http-origin", () => import("./http-origin"));
vi.mock("@/lib/private-request", () => import("./private-request"));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: async () => ({
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { status: state.active ? "active" : "suspended" }, error: null }) }) }) }),
  rpc: async () => ({ data: state.rate, error: null }),
  auth: {
    getUser: async () => ({ data: { user: state.user ? { id: "own-user" } : null }, error: null }),
    mfa: {
      listFactors: async () => ({ data: { totp: state.factors.filter((f) => f.status === "verified"), all: state.factors }, error: state.providerError ? { message: "internal_sql_secret" } : null }),
      enroll: state.enroll, unenroll: state.unenroll, challengeAndVerify: state.verify
    }
  }
}) }));
import { GET, POST } from "../app/api/auth/mfa/route";
const factorId = "d0000000-0000-4000-8000-000000000001";
const request = (body?: unknown, origin = "https://store.example.invalid") => new Request("https://store.example.invalid/api/auth/mfa", {
  method: body ? "POST" : "GET", headers: { origin, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {})
});
beforeEach(() => {
  state.user = true; state.active = true; state.rate = true; state.providerError = false; state.factors = [];
  state.enroll.mockReset().mockResolvedValue({ data: { id: factorId, totp: { qr_code: "data:image/svg+xml,test", secret: "test-only-totp" }, internal: "hidden" }, error: null });
  state.verify.mockReset().mockResolvedValue({ data: { access_token: "test-session", refresh_token: "test-refresh" }, error: null });
  state.unenroll.mockReset().mockResolvedValue({ error: null });
});
describe("MFA first-party", () => {
  it("requires origin, valid session, active profile and a remaining rate budget", async () => {
    expect((await POST(request({ action: "enroll" }, "https://evil.invalid"))).status).toBe(403);
    state.user = false;
    expect((await GET(request())).status).toBe(401);
    state.user = true; state.active = false;
    expect((await GET(request())).status).toBe(403);
    state.active = true; state.rate = false;
    expect((await POST(request({ action: "enroll" }))).status).toBe(429);
    expect(state.enroll).not.toHaveBeenCalled();
  });
  it("returns minimal enrollment data with no-store and removes only unfinished own TOTP factors", async () => {
    state.factors = [{ id: factorId, factor_type: "totp", status: "unverified" }];
    const result = await POST(request({ action: "enroll" }));
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(await result.json()).toEqual({ ok: true, factorId, enrollment: { qrCode: "data:image/svg+xml,test", secret: "test-only-totp" } });
    expect(state.unenroll).toHaveBeenCalledWith({ factorId });
  });
  it("rejects other users' factor IDs and preserves verified factors", async () => {
    expect((await POST(request({ action: "verify", factorId, code: "123456" }))).status).toBe(403);
    expect(state.verify).not.toHaveBeenCalled();
    state.factors = [{ id: factorId, factor_type: "totp", status: "verified" }];
    expect((await POST(request({ action: "cancel", factorId }))).status).toBe(403);
    expect(await (await POST(request({ action: "enroll" }))).json()).toEqual({ ok: true, factorId });
    expect(state.unenroll).not.toHaveBeenCalled();
    expect(state.enroll).not.toHaveBeenCalled();
  });
  it("verifies unfinished enrollment but never serializes refreshed session tokens", async () => {
    state.factors = [{ id: factorId, factor_type: "totp", status: "unverified" }];
    expect(await (await POST(request({ action: "verify", factorId, code: "123456" }))).json()).toEqual({ ok: true });
    expect(state.verify).toHaveBeenCalledWith({ factorId, code: "123456" });
    state.providerError = true;
    const failed = await GET(request());
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain("internal_sql_secret");
  });
});

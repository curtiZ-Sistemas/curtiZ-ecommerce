import { NextRequest } from "next/server";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ verify: vi.fn(), signOut: vi.fn(), budget: vi.fn(), status: "active",
  identities: [{ provider: "email" }], updatedAt: "2026-10-22T12:00:00Z" }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/http-origin", () => import("../../../../../lib/http-origin"));
vi.mock("@/lib/private-request", () => import("../../../../../lib/private-request"));
vi.mock("@/lib/password-recovery", () => import("../../../../../lib/password-recovery"));
vi.mock("@/lib/recovery-proof", () => import("../../../../../lib/recovery-proof"));
vi.mock("@/lib/auth-rate-limit", () => ({ enforceRecoveryVerificationRateLimit: state.budget }));
vi.mock("@/lib/supabase/server", () => ({
  createServiceSupabaseClient: () => ({}),
  createServerSupabaseClient: async () => ({ auth: { verifyOtp: state.verify, signOut: state.signOut },
    from: () => { const query = { select: () => query, eq: () => query,
      maybeSingle: async () => ({ data: { status: state.status }, error: null }) }; return query; } })
}));
import { POST } from "./route";
const tokenHash = "a".repeat(64);
const accessToken = `header.${Buffer.from(JSON.stringify({ sub: "owner", session_id: "fresh-session" })).toString("base64url")}.signature`;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("RATE_LIMIT_HMAC_KEY", "test-only-recovery-key-with-at-least-32-bytes");
  vi.stubEnv("ALLOWED_ORIGINS", "https://curtiz.com.br");
  vi.stubEnv("NODE_ENV", "production");
  state.status = "active"; state.identities = [{ provider: "email" }];
  state.budget.mockResolvedValue({ status: "allowed" });
  state.signOut.mockResolvedValue({ error: null });
  state.verify.mockImplementation(async () => ({ data: { user: { id: "owner", identities: state.identities, updated_at: state.updatedAt },
    session: { access_token: accessToken } }, error: null }));
});
afterEach(() => vi.unstubAllEnvs());
const send = (body: unknown = { tokenHash }, origin = "https://curtiz.com.br") => POST(new NextRequest(
  "https://curtiz.com.br/api/auth/recovery/verify", { method: "POST",
    headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) }));
describe("portable recovery verification", () => {
  it("verifies recovery once without an initiating browser cookie and issues only a protected proof", async () => {
    const response = await send();
    expect(response.status).toBe(200);
    expect(state.verify).toHaveBeenCalledExactlyOnceWith({ type: "recovery", token_hash: tokenHash });
    expect(await response.json()).toEqual({ ok: true });
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("HttpOnly"); expect(cookie).toContain("Secure"); expect(cookie).toContain("SameSite=strict");
    expect(cookie).toContain("Max-Age=900");
    expect(cookie).not.toContain(tokenHash); expect(cookie).not.toContain(accessToken);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });
  it("rejects cross-origin, malformed and extra input before contacting Auth", async () => {
    expect((await send({ tokenHash }, "https://attacker.invalid")).status).toBe(403);
    expect((await send({ tokenHash: "bad" })).status).toBe(400);
    expect((await send({ tokenHash, type: "magiclink" })).status).toBe(400);
    expect(state.verify).not.toHaveBeenCalled();
  });
  it("fails closed without signing configuration or abuse protection", async () => {
    vi.stubEnv("RATE_LIMIT_HMAC_KEY", "");
    expect((await send()).status).toBe(503); expect(state.verify).not.toHaveBeenCalled();
    vi.stubEnv("RATE_LIMIT_HMAC_KEY", "test-only-recovery-key-with-at-least-32-bytes");
    state.budget.mockResolvedValue({ status: "blocked", retryAfterSeconds: 37 });
    const blocked = await send(); expect(blocked.status).toBe(429); expect(blocked.headers.get("retry-after")).toBe("37");
    state.budget.mockResolvedValue({ status: "error" });
    expect((await send()).status).toBe(503); expect(state.verify).not.toHaveBeenCalled();
  });
  it("does not retry invalid, reused, expired or uncertain token verification and exposes no provider data", async () => {
    state.verify.mockResolvedValue({ data: { user: null, session: null }, error: { message: tokenHash, code: "otp_expired" } });
    const invalid = await send(); expect(invalid.status).toBe(422);
    expect(JSON.stringify(await invalid.json())).not.toMatch(/otp_expired|aaaaaa/u);
    expect(invalid.headers.get("set-cookie")).toBeNull();
    state.verify.mockRejectedValue(new Error(tokenHash));
    expect((await send()).status).toBe(422);
    expect(state.verify).toHaveBeenCalledTimes(2);
  });
  it("preserves Google-only and inactive account guards", async () => {
    state.identities = [{ provider: "google" }];
    const google = await send(); expect(google.status).toBe(403);
    expect(await google.json()).toEqual({ redirectTo: "/login?reason=google_account" });
    expect(google.headers.get("set-cookie")).toBeNull();
    state.identities = [{ provider: "email" }]; state.status = "blocked";
    expect((await send()).status).toBe(403);
    expect(state.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
});

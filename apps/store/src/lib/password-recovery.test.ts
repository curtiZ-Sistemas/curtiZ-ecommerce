import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const state = vi.hoisted(() => ({ reset: vi.fn(), getUser: vi.fn(), update: vi.fn(), rate: vi.fn(), turnstile: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/http-origin", () => import("./http-origin"));
vi.mock("@/lib/private-request", () => import("./private-request"));
vi.mock("@/lib/auth-rate-limit", () => ({ enforceAuthRateLimit: state.rate }));
vi.mock("@/lib/turnstile", () => ({ verifyTurnstile: state.turnstile }));
vi.mock("@/lib/supabase/server", () => ({ createServiceSupabaseClient: () => ({}), createServerSupabaseClient: async () => ({
  auth: { resetPasswordForEmail: state.reset, getUser: state.getUser, updateUser: state.update }
}) }));
import { POST } from "../app/api/auth/password/route";
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ALLOWED_ORIGINS", "https://curtiz.com.br");
  vi.stubEnv("NEXT_PUBLIC_STORE_URL", "https://curtiz-ecommerce.sistemas-curtiz.workers.dev");
  state.rate.mockResolvedValue({ status: "allowed" }); state.turnstile.mockResolvedValue(true);
  state.reset.mockResolvedValue({ error: null }); state.update.mockResolvedValue({ error: null });
  state.getUser.mockResolvedValue({ data: { user: { id: "owner" } }, error: null });
});
afterEach(() => vi.unstubAllEnvs());
const send = (data: unknown, origin = "https://curtiz.com.br") => POST(new NextRequest("https://curtiz.com.br/api/auth/password", {
  method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(data)
}));
describe("access recovery", () => {
  it("uses the central official callback without disclosing whether an account exists", async () => {
    const first = await send({ action: "request", email: "fixture@example.invalid" });
    expect(state.reset).toHaveBeenCalledWith("fixture@example.invalid", { redirectTo: "https://curtiz.com.br/auth/callback?next=/redefinir-senha" });
    state.reset.mockResolvedValue({ error: { code: "not_found" } });
    const second = await send({ action: "request", email: "absent@example.invalid" });
    expect(first.status).toBe(200); expect(await first.json()).toEqual(await second.json());
  });
  it("requires a verified session before changing a password", async () => {
    state.getUser.mockResolvedValue({ data: { user: { id: "untrusted" } }, error: { status: 401 } });
    expect((await send({ action: "update", password: "test-password-only", confirmPassword: "test-password-only" })).status).toBe(401);
    expect(state.update).not.toHaveBeenCalled();
  });
  it("changes only the authenticated account and returns to the customer area", async () => {
    const result = await send({ action: "update", password: "test-password-only", confirmPassword: "test-password-only" });
    expect(state.update).toHaveBeenCalledExactlyOnceWith({ password: "test-password-only" });
    expect(await result.json()).toMatchObject({ redirectTo: "/minha-conta" });
  });
  it("rejects cross-origin requests and password mismatch", async () => {
    expect((await send({ action: "request", email: "fixture@example.invalid" }, "https://attacker.invalid")).status).toBe(403);
    expect((await send({ action: "update", password: "test-password-only", confirmPassword: "mismatch" })).status).toBe(400);
    expect(state.reset).not.toHaveBeenCalled(); expect(state.update).not.toHaveBeenCalled();
  });
  it("retains Turnstile and rate limiting before requesting a recovery message", async () => {
    state.rate.mockResolvedValue({ status: "blocked", retryAfterSeconds: 60 });
    expect((await send({ action: "request", email: "fixture@example.invalid" })).status).toBe(429);
    state.rate.mockResolvedValue({ status: "allowed" }); state.turnstile.mockResolvedValue(false);
    expect((await send({ action: "request", email: "fixture@example.invalid" })).status).toBe(403);
    expect(state.reset).not.toHaveBeenCalled();
  });
});

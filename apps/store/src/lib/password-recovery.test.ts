import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const state = vi.hoisted(() => ({
  reset: vi.fn(), getUser: vi.fn(), getSession: vi.fn(), update: vi.fn(), signOut: vi.fn(),
  rate: vi.fn(), turnstile: vi.fn(), status: "active"
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/http-origin", () => import("./http-origin"));
vi.mock("@/lib/private-request", () => import("./private-request"));
vi.mock("@/lib/password-recovery", () => import("./password-recovery"));
vi.mock("@/lib/recovery-proof", () => import("./recovery-proof"));
vi.mock("@/lib/auth-rate-limit", () => ({ enforceAuthRateLimit: state.rate }));
vi.mock("@/lib/turnstile", () => ({ verifyTurnstile: state.turnstile }));
vi.mock("@/lib/supabase/server", () => ({ createServiceSupabaseClient: () => ({}), createServerSupabaseClient: async () => ({
  auth: {
    resetPasswordForEmail: state.reset, getUser: state.getUser, getSession: state.getSession,
    updateUser: state.update, signOut: state.signOut
  },
  from: () => {
    const query = { select: () => query, eq: () => query,
      maybeSingle: async () => ({ data: state.status ? { status: state.status } : null, error: null }) };
    return query;
  }
}) }));
import { POST } from "../app/api/auth/password/route";
import {
  classifyResetError, recoveryAuthenticatedAt, recoveryFreshness, RECOVERY_WINDOW_SECONDS
} from "./password-recovery";
import { issueRecoveryProof, RECOVERY_PROOF_COOKIE } from "./recovery-proof";

const now = () => Math.floor(Date.now() / 1_000);
const token = (amr: Array<{ method: string; timestamp: number }> | undefined) => {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode({ sub: "owner", ...(amr ? { amr } : {}) })}.signature`;
};
const recoverySession = (age = 5) => ({ data: { session: { access_token: token([{ method: "recovery", timestamp: now() - age }]) } } });
const emailUser = { id: "owner", identities: [{ provider: "email" }] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.stubEnv("ALLOWED_ORIGINS", "https://curtiz.com.br");
  vi.stubEnv("NEXT_PUBLIC_STORE_URL", "https://curtiz-ecommerce.sistemas-curtiz.workers.dev");
  state.status = "active";
  state.rate.mockResolvedValue({ status: "allowed" }); state.turnstile.mockResolvedValue(true);
  state.reset.mockResolvedValue({ error: null }); state.update.mockResolvedValue({ error: null });
  state.signOut.mockResolvedValue({ error: null });
  state.getUser.mockResolvedValue({ data: { user: emailUser }, error: null });
  state.getSession.mockResolvedValue(recoverySession());
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
const send = (data: unknown, origin = "https://curtiz.com.br", proof?: string) => POST(new NextRequest("https://curtiz.com.br/api/auth/password", {
  method: "POST", headers: { origin, "content-type": "application/json", ...(proof ? { cookie: `${RECOVERY_PROOF_COOKIE}=${proof}` } : {}) }, body: JSON.stringify(data)
}));
const change = { action: "update", password: "test-password-only", confirmPassword: "test-password-only" };
const ask = { action: "request", email: "fixture@example.invalid" };

describe("recovery request", () => {
  it("uses the central official callback without disclosing whether an account exists", async () => {
    const first = await send(ask);
    expect(state.reset).toHaveBeenCalledWith("fixture@example.invalid", { redirectTo: "https://curtiz.com.br/auth/callback?next=/redefinir-senha" });
    state.reset.mockResolvedValue({ error: { status: 400, code: "validation_failed" } });
    const second = await send({ action: "request", email: "absent@example.invalid" });
    expect(first.status).toBe(200); expect(second.status).toBe(200);
    expect(await first.json()).toEqual(await second.json());
  });
  it("uses the public wording for the neutral response", async () => {
    expect(((await (await send(ask)).json()) as { message: string }).message)
      .toBe("Solicitação recebida. Confira seu e-mail e a pasta de spam para continuar.");
  });
  it("returns to login without an account-existence signal and explains invalid email syntax", async () => {
    expect(await (await send(ask)).json()).toMatchObject({ redirectTo: "/login?recovery=requested" });
    state.reset.mockClear();
    const invalid = await send({ action: "request", email: "invalid" });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ message: "Informe um e-mail válido." });
    expect(state.reset).not.toHaveBeenCalled();
  });
  it.each([
    ["SMTP failure", { name: "AuthApiError", status: 500, code: "unexpected_failure", message: "Error sending recovery email" }],
    ["unreachable Auth", { name: "AuthRetryableFetchError", status: 0, message: "fetch failed" }],
    ["project e-mail limit", { name: "AuthApiError", status: 429, code: "over_email_send_rate_limit", message: "email rate limit exceeded" }]
  ])("reports %s as generic unavailability, without provider details or the address", async (_label, error) => {
    state.reset.mockResolvedValue({ error });
    const response = await send(ask);
    const text = JSON.stringify(await response.json());
    expect(response.status).toBe(503);
    expect(text).toContain("Não foi possível processar sua solicitação agora");
    expect(text).not.toMatch(/smtp|unexpected_failure|rate limit|fixture@example/iu);
    expect(JSON.stringify((console.error as unknown as { mock: { calls: unknown[] } }).mock.calls)).not.toContain("fixture@example");
  });
  it("keeps the per-account cooldown neutral because only existing accounts reach it", async () => {
    state.reset.mockResolvedValue({ error: { status: 429, code: "over_email_send_rate_limit", message: "For security purposes, you can only request this after 60 seconds." } });
    const response = await send(ask);
    expect(response.status).toBe(200);
  });
  it("treats a thrown network failure as unavailability", async () => {
    state.reset.mockRejectedValue(new Error("network"));
    expect((await send(ask)).status).toBe(503);
  });
  it("rejects cross-origin requests and password mismatch", async () => {
    expect((await send(ask, "https://attacker.invalid")).status).toBe(403);
    expect((await send({ ...change, confirmPassword: "mismatch" })).status).toBe(400);
    expect(state.reset).not.toHaveBeenCalled(); expect(state.update).not.toHaveBeenCalled();
  });
  it("checks Turnstile before spending the rate-limit budget and keeps both enforced", async () => {
    state.turnstile.mockResolvedValue(false);
    expect((await send(ask)).status).toBe(403);
    expect(state.rate).not.toHaveBeenCalled();
    state.turnstile.mockResolvedValue(true);
    state.rate.mockResolvedValue({ status: "blocked", retryAfterSeconds: 60 });
    const blocked = await send(ask);
    expect(blocked.status).toBe(429); expect(blocked.headers.get("retry-after")).toBe("60");
    state.rate.mockResolvedValue({ status: "error" });
    expect((await send(ask)).status).toBe(503);
    expect(state.reset).not.toHaveBeenCalled();
  });
});

describe("password update authorization", () => {
  it("accepts a recovery-only signed OTP session but rejects changed session or user versions", async () => {
    const key = "test-only-recovery-signing-key-with-at-least-32-bytes";
    vi.stubEnv("RATE_LIMIT_HMAC_KEY", key);
    const updatedAt = "2026-10-22T12:00:00Z";
    state.getUser.mockResolvedValue({ data: { user: { ...emailUser, updated_at: updatedAt } }, error: null });
    const claims = { sub: "owner", session_id: "verified-session", amr: [{ method: "otp", timestamp: now() }] };
    const access = `header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;
    state.getSession.mockResolvedValue({ data: { session: { access_token: access } } });
    expect((await send(change)).status).toBe(403);
    const proof = issueRecoveryProof(access, "owner", updatedAt, key)!;
    expect((await send(change, "https://curtiz.com.br", proof)).status).toBe(200);
    state.update.mockClear();
    state.getUser.mockResolvedValue({ data: { user: { ...emailUser, updated_at: "changed" } }, error: null });
    expect((await send(change, "https://curtiz.com.br", proof)).status).toBe(403);
    expect(state.update).not.toHaveBeenCalled();
  });
  it("rejects a request without any session", async () => {
    state.getUser.mockResolvedValue({ data: { user: null }, error: { status: 401 } });
    expect((await send(change)).status).toBe(401);
    expect(state.update).not.toHaveBeenCalled();
  });
  it("rejects an ordinary logged-in session that never used a recovery link", async () => {
    state.getSession.mockResolvedValue({ data: { session: { access_token: token([{ method: "password", timestamp: now() }]) } } });
    expect((await send(change)).status).toBe(403);
    state.getSession.mockResolvedValue({ data: { session: { access_token: token(undefined) } } });
    expect((await send(change)).status).toBe(403);
    expect(state.update).not.toHaveBeenCalled();
  });
  it("rejects a Google login session even when the account also has a password identity", async () => {
    state.getSession.mockResolvedValue({ data: { session: { access_token: token([{ method: "oauth", timestamp: now() }]) } } });
    expect((await send(change)).status).toBe(403);
    expect(state.update).not.toHaveBeenCalled();
  });
  it("expires the recovery proof after the allowed window", async () => {
    state.getSession.mockResolvedValue(recoverySession(RECOVERY_WINDOW_SECONDS + 30));
    expect((await send(change)).status).toBe(401);
    expect(state.update).not.toHaveBeenCalled();
  });
  it("does not give a Google-only account a password", async () => {
    state.getUser.mockResolvedValue({ data: { user: { id: "owner", identities: [{ provider: "google" }] } }, error: null });
    const response = await send(change);
    expect(response.status).toBe(403);
    expect(JSON.stringify(await response.json())).toContain("Google");
    expect(state.update).not.toHaveBeenCalled();
  });
  it("refuses inactive profiles", async () => {
    state.status = "blocked";
    expect((await send(change)).status).toBe(403);
    expect(state.update).not.toHaveBeenCalled();
  });
  it("changes the password once, then ends every session and returns to the login", async () => {
    const response = await send(change);
    expect(state.update).toHaveBeenCalledExactlyOnceWith({ password: "test-password-only" });
    expect(state.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "global" });
    expect(await response.json()).toMatchObject({ redirectTo: "/login?senha=atualizada" });
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
  it("sends accounts with a second factor to the verification step", async () => {
    state.update.mockResolvedValue({ error: { code: "insufficient_aal" } });
    const response = await send(change);
    expect(response.status).toBe(403);
    expect(((await response.json()) as { redirectTo: string }).redirectTo).toMatch(/^\/mfa\?next=https%3A%2F%2F.+%2Fredefinir-senha$/u);
    expect(state.signOut).not.toHaveBeenCalled();
  });
  it("explains same or weak passwords without ending the recovery session", async () => {
    state.update.mockResolvedValue({ error: { code: "same_password" } });
    expect((await send(change)).status).toBe(422);
    expect(state.signOut).not.toHaveBeenCalled();
  });
});

describe("recovery proof helpers", () => {
  it("reads only recovery entries and ignores malformed tokens", () => {
    expect(recoveryAuthenticatedAt(undefined)).toBeNull();
    expect(recoveryAuthenticatedAt("not-a-token")).toBeNull();
    expect(recoveryAuthenticatedAt(token([{ method: "otp", timestamp: 10 }, { method: "recovery", timestamp: 7 }]))).toBe(7);
  });
  it("rejects timestamps from the future", () => {
    expect(recoveryFreshness(token([{ method: "recovery", timestamp: 5_000 }]), 1_000)).toBe("expired");
    expect(recoveryFreshness(token([{ method: "recovery", timestamp: 990 }]), 1_000)).toBe("ok");
  });
  it("classifies provider responses", () => {
    expect(classifyResetError(null).outcome).toBe("neutral");
    expect(classifyResetError({ status: 400 }).outcome).toBe("neutral");
    expect(classifyResetError({ status: 503 }).outcome).toBe("unavailable");
    expect(classifyResetError({ message: "x" }).outcome).toBe("unavailable");
  });
});

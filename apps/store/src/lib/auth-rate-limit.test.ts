import { afterEach, describe, expect, it, vi } from "vitest";
import { enforceAuthRateLimit } from "./auth-rate-limit";

afterEach(() => vi.unstubAllEnvs());

describe("shared authentication budgets", () => {
  it("uses one normalized, HMAC-only account key regardless of IP", async () => {
    vi.stubEnv("RATE_LIMIT_HMAC_KEY", "test-only-rate-limit-key-at-least-32-bytes");
    const rpc = vi.fn<(name: string, args: Record<string, string | number>) => Promise<{
      data: { status: string; remaining: number };
      error: null;
    }>>(async () => ({ data: { status: "allowed", remaining: 9 }, error: null }));
    const attempt = (ip: string, email: string) => enforceAuthRateLimit({
      request: new Request("https://store.example/api/auth/login", { headers: { "cf-connecting-ip": ip } }),
      email, scope: "login", supabase: { rpc }
    });
    await attempt("192.0.2.1", " USER@EXAMPLE.TEST ");
    await attempt("192.0.2.2", "user@example.test");
    await attempt("192.0.2.1", "other@example.test");
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(rpc.mock.calls[0]?.[1]).toEqual(rpc.mock.calls[1]?.[1]);
    expect(rpc.mock.calls[2]?.[1]).not.toEqual(rpc.mock.calls[0]?.[1]);
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("example.test");
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("192.0.2");
  });

  it("distinguishes a real block from RPC, transport, and contract failures", async () => {
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("RATE_LIMIT_HMAC_KEY", "test-only-rate-limit-key-at-least-32-bytes");
    const input = { request: new Request("https://store.example"), email: "user@example.test", scope: "login" as const };
    expect(await enforceAuthRateLimit({ ...input, supabase: {
      rpc: async () => ({ data: { status: "blocked", retryAfterSeconds: 37 }, error: null })
    } })).toEqual({ status: "blocked", retryAfterSeconds: 37 });
    expect(await enforceAuthRateLimit({ ...input, supabase: {
      rpc: async () => ({ data: null, error: { message: "unavailable" } })
    } })).toEqual({ status: "error" });
    expect(await enforceAuthRateLimit({ ...input, supabase: {
      rpc: async () => { throw new Error("unavailable"); }
    } })).toEqual({ status: "error" });
    expect(await enforceAuthRateLimit({ ...input, supabase: {
      rpc: async () => ({ data: false, error: null })
    } })).toEqual({ status: "error" });
  });

  it("fails as an internal error in production without storage or an independent key", async () => {
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("RATE_LIMIT_HMAC_KEY", "test-only-rate-limit-key-at-least-32-bytes");
    const input = { request: new Request("https://store.example"), email: "user@example.test", scope: "login" as const };
    expect(await enforceAuthRateLimit({ ...input, supabase: null })).toEqual({ status: "error" });
    vi.stubEnv("RATE_LIMIT_HMAC_KEY", "");
    const rpc = vi.fn();
    expect(await enforceAuthRateLimit({ ...input, supabase: { rpc } })).toEqual({ status: "error" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("blocks only the exhausted account in the local development fallback", async () => {
    vi.stubEnv("APP_ENV", "development");
    vi.stubEnv("RATE_LIMIT_HMAC_KEY", "test-only-rate-limit-key-at-least-32-bytes");
    const attempt = (email: string) => enforceAuthRateLimit({
      request: new Request("https://store.example/api/auth/login"), email, scope: "login", supabase: null
    });
    for (let count = 0; count < 10; count += 1) {
      expect((await attempt("exhausted@example.test")).status).toBe("allowed");
    }
    expect((await attempt("exhausted@example.test")).status).toBe("blocked");
    expect((await attempt("independent@example.test")).status).toBe("allowed");
  });
});

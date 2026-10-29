import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyTurnstile } from "./turnstile";

const transport = vi.fn();
const request = (host = "curtiz.com.br") => new Request(`https://${host}/api/auth/login`);
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
beforeEach(() => {
  vi.stubEnv("TURNSTILE_ENABLED", "true");
  vi.stubEnv("TURNSTILE_SECRET_KEY", "test-secret");
  vi.stubEnv("TURNSTILE_HOSTNAMES", "curtiz.com.br,curtiz-ecommerce.sistemas-curtiz.workers.dev");
  vi.stubEnv("APP_ENV", "production");
  vi.stubGlobal("fetch", transport);
  transport.mockReset().mockResolvedValue(response({ success: true, hostname: "curtiz.com.br", action: "login" }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Turnstile server verification", () => {
  it("requires a successful response matching the exact frontend and action", async () => {
    expect(await verifyTurnstile(request(), "token", "login")).toBe(true);
    const [url, options] = transport.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(options.method).toBe("POST");
    expect((options.body as URLSearchParams).get("response")).toBe("token");
  });
  it.each([
    { success: false, hostname: "curtiz.com.br", action: "login" },
    { success: true, hostname: "attacker.invalid", action: "login" },
    { success: true, hostname: "curtiz.com.br", action: "signup" },
    { success: true }, null, "success"
  ])("rejects a mismatched or malformed provider response: %j", async value => {
    transport.mockResolvedValue(response(value));
    expect(await verifyTurnstile(request(), "token", "login")).toBe(false);
  });
  it.each([undefined, "", "x".repeat(2049)])("rejects missing or oversized tokens before network access", async token => {
    expect(await verifyTurnstile(request(), token, "login")).toBe(false);
    expect(transport).not.toHaveBeenCalled();
  });
  it("fails closed without a secret or hostname configuration", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    expect(await verifyTurnstile(request(), "token", "login")).toBe(false);
    vi.stubEnv("TURNSTILE_SECRET_KEY", "test-secret");
    vi.stubEnv("TURNSTILE_HOSTNAMES", "");
    expect(await verifyTurnstile(request(), "token", "login")).toBe(false);
    expect(transport).not.toHaveBeenCalled();
  });
  it("does not allow localhost in production even if configured", async () => {
    vi.stubEnv("TURNSTILE_HOSTNAMES", "localhost");
    expect(await verifyTurnstile(request("localhost"), "token", "login")).toBe(false);
    expect(transport).not.toHaveBeenCalled();
  });
  it("does not accept a configured alias token on the canonical host", async () => {
    transport.mockResolvedValue(response({ success: true, hostname: "curtiz-ecommerce.sistemas-curtiz.workers.dev", action: "login" }));
    expect(await verifyTurnstile(request(), "token", "login")).toBe(false);
  });
  it("accepts the official alias only with its own hostname", async () => {
    transport.mockResolvedValue(response({ success: true, hostname: "curtiz-ecommerce.sistemas-curtiz.workers.dev", action: "login" }));
    expect(await verifyTurnstile(request("curtiz-ecommerce.sistemas-curtiz.workers.dev"), "token", "login")).toBe(true);
  });
  it("fails closed on provider HTTP, JSON and network errors", async () => {
    transport.mockResolvedValue(response({}, 500));
    expect(await verifyTurnstile(request(), "token", "login")).toBe(false);
    transport.mockResolvedValue(new Response("not json"));
    expect(await verifyTurnstile(request(), "token", "login")).toBe(false);
    transport.mockRejectedValue(new Error("network"));
    expect(await verifyTurnstile(request(), "token", "login")).toBe(false);
  });
  it("leaves the disabled integration inactive", async () => {
    vi.stubEnv("TURNSTILE_ENABLED", "false");
    expect(await verifyTurnstile(request(), undefined, "login")).toBe(true);
    expect(transport).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { publicBudgetResponse } from "./public-request";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServiceSupabaseClient: vi.fn() }));
beforeEach(() => {
  vi.stubEnv("APP_ENV", "production");
  vi.stubEnv("RATE_LIMIT_HMAC_KEY", "test-only-public-request-key-at-least-32-bytes");
  vi.mocked(createServiceSupabaseClient).mockReset();
});
afterEach(() => vi.unstubAllEnvs());
describe("public expensive API budgets", () => {
  it("gives Google OAuth an independent distributed write budget, without a local fallback", async () => {
    const rpc = vi.fn(async () => ({ data: true, error: null }));
    vi.mocked(createServiceSupabaseClient).mockReturnValue({ rpc } as never);
    await publicBudgetResponse(new Request("https://store.test"), "google_oauth");
    expect(rpc).toHaveBeenCalledWith("consume_public_api_rate_limit", { p_operation: "help_write", p_key_hash: expect.stringMatching(/^[a-f0-9]{64}$/u) as unknown });
    vi.mocked(createServiceSupabaseClient).mockReturnValue(null);
    expect((await publicBudgetResponse(new Request("https://store.test"), "google_oauth", { RATE_LIMIT_HMAC_KEY: "test-only-signing-key-at-least-thirty-two-bytes" }))?.status).toBe(503);
  });
  it("reuses the installed distributed budget with an independent shipping identity and runtime key", async () => {
    const rpc = vi.fn(async () => ({ data: true, error: null }));
    vi.mocked(createServiceSupabaseClient).mockReturnValue({ rpc } as never);
    const request = new Request("https://store.test", { headers: { "cf-connecting-ip": "192.0.2.1" } });
    await publicBudgetResponse(request, "availability");
    await publicBudgetResponse(request, "shipping_preview", { RATE_LIMIT_HMAC_KEY: "runtime-key-longer-than-thirty-two-characters" });
    expect(rpc.mock.calls[0]).not.toEqual(rpc.mock.calls[1]);
    expect(rpc).toHaveBeenLastCalledWith("consume_public_api_rate_limit", { p_operation: "availability", p_key_hash: expect.stringMatching(/^[a-f0-9]{64}$/u) as unknown });
    rpc.mockRejectedValue(new Error("offline"));
    expect((await publicBudgetResponse(request, "shipping_preview", { RATE_LIMIT_HMAC_KEY: "runtime-key-longer-than-thirty-two-characters" }))?.status).toBe(503);
  });
  it("fails closed without trusted shared storage or an independent key", async () => {
    vi.mocked(createServiceSupabaseClient).mockReturnValue(null);
    expect((await publicBudgetResponse(new Request("https://store.test"), "help_read"))?.status).toBe(503);
    vi.stubEnv("RATE_LIMIT_HMAC_KEY", "");
    expect((await publicBudgetResponse(new Request("https://store.test"), "help_read"))?.status).toBe(503);
  });
  it.each([[true, null, undefined], [false, null, 429], [null, {}, 503]])("handles shared budget %s", async (data, error, status) => {
    const rpc = vi.fn(async () => ({ data, error }));
    vi.mocked(createServiceSupabaseClient).mockReturnValue({ rpc } as never);
    const request = new Request("https://store.test", { headers: { "cf-connecting-ip": "192.0.2.1" } });
    expect((await publicBudgetResponse(request,"intelligence"))?.status).toBe(status);
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("192.0.2.1");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { runExpirationHousekeeping } from "./housekeeping";

const environment = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SECRET_KEY: "server-secret"
};

describe("checkout expiration housekeeping", () => {
  afterEach(() => vi.restoreAllMocks());

  it("fails closed without the server-side Supabase secret", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetcher = vi.fn();
    await expect(runExpirationHousekeeping({
      SUPABASE_URL: environment.SUPABASE_URL
    }, "request-id", fetcher)).resolves.toEqual({ ok: false, expired: 0, attempts: 0 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("calls the bounded idempotent RPC without logging or returning the secret", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fetcher = vi.fn().mockResolvedValue(new Response("3", {
      status: 200,
      headers: { "content-type": "application/json" }
    }));
    await expect(runExpirationHousekeeping(environment, "request-id", fetcher)).resolves.toEqual({
      ok: true, expired: 3, attempts: 1
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://project.supabase.co/rest/v1/rpc/expire_stale_mercadopago_orders",
      expect.objectContaining({ body: JSON.stringify({ p_limit: 50 }) })
    );
  });

  it("retries one transient 5xx and then stops", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: "temporary" }), { status: 503 }))
      .mockResolvedValueOnce(new Response("0", { status: 200 }));
    await expect(runExpirationHousekeeping(environment, "request-id", fetcher)).resolves.toEqual({
      ok: true, expired: 0, attempts: 2
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("sends new secret API keys only in apikey, not as a Bearer JWT", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fetcher = vi.fn().mockResolvedValue(new Response("0", { status: 200 }));
    await runExpirationHousekeeping({ ...environment, SUPABASE_SECRET_KEY: "sb_secret_test" }, "request-id", fetcher);
    const options = fetcher.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(options.headers);
    expect(headers.get("apikey")).toBe("sb_secret_test");
    expect(headers.has("authorization")).toBe(false);
    expect(options.redirect).toBe("error");
  });

  it("does not retry an authorization failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetcher = vi.fn().mockResolvedValue(new Response("{}", { status: 403 }));
    await expect(runExpirationHousekeeping(environment, "request-id", fetcher)).resolves.toEqual({
      ok: false, expired: 0, attempts: 1
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("reports only a known exception type without leaking error text", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetcher = vi.fn().mockRejectedValue(new TypeError("test-only credential detail"));
    await expect(runExpirationHousekeeping(environment, "request-id", fetcher)).resolves.toMatchObject({ ok: false, attempts: 2 });
    expect(log).toHaveBeenCalledWith("checkout_housekeeping_runtime_failure", expect.objectContaining({ failureType: "TypeError" }));
    expect(JSON.stringify(log.mock.calls)).not.toContain("test-only credential detail");
  });

  it("classifies a header error without emitting header values or error text", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetcher = vi.fn().mockRejectedValue(new TypeError("Header ByteString: test-only private detail"));
    await runExpirationHousekeeping(environment, "request-id", fetcher);
    expect(log).toHaveBeenCalledWith("checkout_housekeeping_runtime_failure", expect.objectContaining({
      failureReason: "headers", failureStage: "request_fetch"
    }));
    expect(JSON.stringify(log.mock.calls)).not.toContain("test-only private detail");
  });

  it("distinguishes timeout setup failure before invoking transport", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(AbortSignal, "timeout").mockImplementation(() => { throw new TypeError("AbortSignal test-only detail"); });
    const fetcher = vi.fn();
    await runExpirationHousekeeping(environment, "request-id", fetcher);
    expect(fetcher).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("checkout_housekeeping_runtime_failure", expect.objectContaining({
      failureReason: "signal", failureStage: "request_timeout"
    }));
    expect(JSON.stringify(log.mock.calls)).not.toContain("test-only detail");
  });

  it("does not send secrets to malformed or credential-bearing URLs", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetcher = vi.fn();
    await runExpirationHousekeeping({ ...environment, SUPABASE_URL: "https://user:pass@project.supabase.co" }, "request-id", fetcher);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

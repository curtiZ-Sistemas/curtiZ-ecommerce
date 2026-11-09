import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { purgeApplicationAccessLogs, recordApplicationAccess } from "./application-access-log";

const environment = {
  APPLICATION_ACCESS_LOG_ENABLED: "true",
  PRIVACY_RETENTION_ENABLED: "true",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SECRET_KEY: "sb_secret_test_only"
};
const request = (ip = "192.0.2.1") => new Request("https://curtiz.com.br/checkout?token=private", {
  headers: { "cf-connecting-ip": ip, cookie: "session=private", authorization: "Bearer private", "user-agent": "private" }
});
function payloadOf(fetcher: ReturnType<typeof vi.fn<typeof fetch>>): Record<string, unknown> {
  const body = fetcher.mock.calls[0]?.[1]?.body;
  if (typeof body !== "string") throw new Error("Expected a JSON request body");
  const value: unknown = JSON.parse(body);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object");
  return value as Record<string, unknown>;
}

describe("protected application access records", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("sends only the minimum access fields without copying request credentials or URL", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    expect(await recordApplicationAccess(request(), environment, "store", fetcher)).toBe(true);
    const call = fetcher.mock.calls[0];
    if (!call) throw new Error("Expected a recorded request");
    const [url, init] = call;
    expect(url).toBe("https://example.supabase.co/rest/v1/rpc/record_application_access");
    const payload = payloadOf(fetcher);
    expect(Object.keys(payload).sort()).toEqual(["p_application", "p_ip_address", "p_occurred_at", "p_record_id"]);
    expect(payload).toMatchObject({ p_application: "store", p_ip_address: "192.0.2.1" });
    expect(payload.p_record_id).toEqual(expect.any(String));
    expect(payload.p_occurred_at).toEqual(expect.any(String));
    expect(JSON.stringify(init)).not.toContain("private");
    expect(init?.redirect).toBe("manual");
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
  });

  it("accepts an IPv6 platform address", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    await recordApplicationAccess(request("2001:db8::1"), environment, "panel", fetcher);
    expect(payloadOf(fetcher).p_ip_address).toBe("2001:db8::1");
  });

  it("does not use an untrusted forwarded address when the platform IP is absent or invalid", async () => {
    const fetcher = vi.fn<typeof fetch>();
    for (const ip of ["", "192.0.2.0/24", "unknown", "1.2.3.4,5.6.7.8"]) {
      const r = request(ip);
      r.headers.set("x-forwarded-for", "192.0.2.2");
      expect(await recordApplicationAccess(r, environment, "store", fetcher)).toBe(false);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("retries an ambiguous failure using exactly the same idempotency payload", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("private credentials"))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await recordApplicationAccess(request(), environment, "store", fetcher)).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[1]?.body).toBe(fetcher.mock.calls[1]?.[1]?.body);
  });

  it("bounds persistent failures and never writes an IP or provider error into diagnostics", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("192.0.2.1 sb_secret_test_only"));
    expect(await recordApplicationAccess(request(), environment, "store", fetcher)).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const diagnostics = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(diagnostics).not.toContain("192.0.2.1");
    expect(diagnostics).not.toContain("sb_secret_test_only");
  });

  it("does not repeat permanent authorization failures", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 403 }));
    expect(await recordApplicationAccess(request(), environment, "store", fetcher)).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("never forwards service credentials through an upstream redirect", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://untrusted.example.invalid" } }));
    expect(await recordApplicationAccess(request(), environment, "store", fetcher)).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[1]?.redirect).toBe("manual");
  });

  it("retries rate limiting once and preserves legacy service-key authorization", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await recordApplicationAccess(request(), { ...environment, SUPABASE_SECRET_KEY: "", SUPABASE_SERVICE_ROLE_KEY: "legacy_test_only" }, "store", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get("authorization")).toBe("Bearer legacy_test_only");
  });

  it("does not collect when disabled and refuses unsafe provider origins", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await recordApplicationAccess(request(), {}, "store", fetcher);
    for (const url of ["http://example.supabase.co", "https://user:password@example.supabase.co", "https://example.supabase.co/?redirect=1", "https://example.supabase.co/path"]) {
      expect(await recordApplicationAccess(request(), { ...environment, SUPABASE_URL: url }, "store", fetcher)).toBe(false);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("continues expiring records after collection is disabled using the existing retention control", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("0"));
    expect(await purgeApplicationAccessLogs({ ...environment, APPLICATION_ACCESS_LOG_ENABLED: "false" }, fetcher)).toBe(true);
    expect(fetcher.mock.calls[0]?.[0]).toContain("purge_expired_application_access_logs");
    expect(payloadOf(fetcher)).toEqual({ p_batch_size: 5000 });
    fetcher.mockClear();
    expect(await purgeApplicationAccessLogs({}, fetcher)).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

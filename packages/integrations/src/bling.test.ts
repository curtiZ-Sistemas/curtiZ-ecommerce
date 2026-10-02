import { createHmac } from "node:crypto";
vi.mock("server-only", () => ({}));
import { afterEach, describe, expect, it, vi } from "vitest";
import { BlingClient, type BlingTokens, type BlingTokenStore, blingAuthorizationUrl,
  decryptBlingToken, encryptBlingToken, verifyBlingSignature } from "./bling";

const tokens = (): BlingTokens => ({ accessToken: "test-access", refreshToken: "test-refresh",
  accessTokenExpiresAt: "2099-01-01T00:00:00Z", refreshTokenExpiresAt: "2099-02-01T00:00:00Z" });
const config = { clientId: "test-client", clientSecret: "test-secret" };
function storage(initial: BlingTokens | null = tokens()) {
  let value = initial;
  let lock: string | null = null;
  let status = "connected";
  const store: BlingTokenStore = {
    load: vi.fn(async (expired = false) => status === "connected" || expired ? value : null),
    saveConnected: vi.fn(async (next: BlingTokens) => { value = next; status = "connected"; }),
    claimRefresh: vi.fn(async (id: string) => { if (lock) return false; lock = id; return true; }),
    saveRefresh: vi.fn(async (next: BlingTokens, id: string) => { if (id !== lock || status !== "connected") return false; value = next; return true; }),
    releaseRefresh: vi.fn(async (id: string) => { if (id === lock) lock = null; }),
    markReconnectRequired: vi.fn(async () => { status = "refresh_required"; }),
    disconnect: vi.fn(async (id: string) => { if (id !== lock) return false; value = null; status = "disconnected"; return true; }),
    reserveRequest: vi.fn(async () => 0)
  };
  return store;
}
const json = (body: unknown, status = 200, headers?: HeadersInit) => new Response(JSON.stringify(body), { status, headers });
const formBody = (value: BodyInit | null | undefined) => value instanceof URLSearchParams ? value.toString() : "";
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("Bling credentials and raw signatures", () => {
  it("encrypts long JWT tokens with randomized authenticated ciphertext", async () => {
    const key = btoa("k".repeat(32));
    const token = "jwt".repeat(3000);
    const first = await encryptBlingToken(token, key);
    const second = await encryptBlingToken(token, key);
    expect(first).not.toBe(second);
    expect(first).not.toContain(token);
    expect(await decryptBlingToken(first, key)).toBe(token);
    await expect(decryptBlingToken(first, btoa("x".repeat(32)))).rejects.toMatchObject({ code: "invalid_token_store" });
    await expect(encryptBlingToken(token, "invalid")).rejects.toMatchObject({ code: "configuration" });
  });
  it("compares raw HMAC, rejecting mutations, absent and malformed signatures", async () => {
    const raw = new TextEncoder().encode('{ "eventId": "test" }');
    const sig = `sha256=${createHmac("sha256", "secret").update(raw).digest("hex")}`;
    expect(await verifyBlingSignature(raw, sig, "secret")).toBe(true);
    expect(await verifyBlingSignature(new TextEncoder().encode('{"eventId":"test"}'), sig, "secret")).toBe(false);
    expect(await verifyBlingSignature(raw, null, "secret")).toBe(false);
    expect(await verifyBlingSignature(raw, "sha256=abc", "secret")).toBe(false);
    expect(await verifyBlingSignature(raw, sig, "wrong")).toBe(false);
  });
  it("uses the official authorization host and does not invent query scopes", () => {
    const url = new URL(blingAuthorizationUrl("client", "s".repeat(43)));
    expect(url.origin).toBe("https://www.bling.com.br");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.has("scope")).toBe(false);
    expect(() => blingAuthorizationUrl("client", "short")).toThrow();
  });
});

describe("Bling OAuth and concurrent refresh", () => {
  it("holds new tokens in memory until account verification completes", async () => {
    const store = storage(null);
    const transport = vi.fn<typeof fetch>().mockResolvedValue(json({ access_token: "jwt", refresh_token: "refresh", expires_in: 3600 }));
    const provider = new BlingClient(config, store, transport);
    await provider.exchangeCode("code");
    expect(store.saveConnected).not.toHaveBeenCalled();
    expect(transport.mock.calls[0]?.[1]?.headers).toMatchObject({ "enable-jwt": "1" });
    expect(formBody(transport.mock.calls[0]?.[1]?.body)).toContain("grant_type=authorization_code");
    await expect(provider.request("/produtos", { method: "POST", body: {} })).rejects.toMatchObject({ code: "connection_not_verified" });
    await provider.completeConnection();
    expect(store.saveConnected).toHaveBeenCalledTimes(1);
  });
  it("serializes competing refreshes and uses the rotated token", async () => {
    vi.useFakeTimers();
    const store = storage({ ...tokens(), accessTokenExpiresAt: "2000-01-01T00:00:00Z" });
    let refreshes = 0;
    const transport = vi.fn<typeof fetch>(async (input, init) => {
      if ((typeof input === "string" ? input : input instanceof URL ? input.href : input.url).endsWith("/oauth/token")) {
        refreshes += 1;
        await new Promise((resolve) => setTimeout(resolve, 100));
        return json({ access_token: "rotated-jwt", refresh_token: "rotated-refresh", expires_in: 3600 });
      }
      expect(init?.headers).toMatchObject({ authorization: "Bearer rotated-jwt", "enable-jwt": "1" });
      return json({ data: [] });
    });
    const result = Promise.all([new BlingClient(config, store, transport).request("/produtos"),
      new BlingClient(config, store, transport).request("/produtos")]);
    await vi.runAllTimersAsync();
    await result;
    expect(refreshes).toBe(1);
    expect(store.saveRefresh).toHaveBeenCalledTimes(1);
  });
  it("requires reconnection after revoked refresh and releases its lock", async () => {
    const store = storage({ ...tokens(), accessTokenExpiresAt: "2000-01-01T00:00:00Z" });
    const provider = new BlingClient(config, store, vi.fn<typeof fetch>().mockResolvedValue(json({}, 400)));
    await expect(provider.request("/produtos")).rejects.toMatchObject({ code: "reconnect_required" });
    expect(store.markReconnectRequired).toHaveBeenCalledOnce();
    expect(store.releaseRefresh).toHaveBeenCalledOnce();
  });
  it("revokes both tokens and only clears storage after confirmed revocation", async () => {
    const store = storage();
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    await new BlingClient(config, store, transport).revoke();
    expect(transport).toHaveBeenCalledTimes(2);
    expect(formBody(transport.mock.calls[0]?.[1]?.body)).toContain("token_type_hint=access_token");
    expect(formBody(transport.mock.calls[1]?.[1]?.body)).toContain("token_type_hint=refresh_token");
    expect(await store.load(true)).toBeNull();
  });
  it("preserves encrypted credentials on unconfirmed revocation", async () => {
    const store = storage();
    await expect(new BlingClient(config, store, vi.fn<typeof fetch>().mockRejectedValue(new Error("network"))).revoke())
      .rejects.toMatchObject({ code: "revocation_unconfirmed" });
    expect(await store.load(true)).not.toBeNull();
    expect(store.disconnect).not.toHaveBeenCalled();
  });
});

describe("Bling HTTP reliability", () => {
  it.each(["POST", "PATCH"] as const)("never repeats an uncertain %s on 5xx or network loss", async (method) => {
    for (const failure of [async () => json({}, 502), async () => { throw new Error("timeout"); }]) {
      const transport = vi.fn<typeof fetch>(failure);
      await expect(new BlingClient(config, storage(), transport).request("/produtos", { method, body: {} }))
        .rejects.toMatchObject({ uncertainWrite: true, retryable: false });
      expect(transport).toHaveBeenCalledOnce();
    }
  });
  it("keeps invalid success responses uncertain for writes", async () => {
    await expect(new BlingClient(config, storage(), vi.fn<typeof fetch>().mockResolvedValue(new Response("invalid")))
      .request("/produtos", { method: "POST", body: {} })).rejects.toMatchObject({ uncertainWrite: true });
  });
  it("returns long Retry-After to the persistent queue without early retry", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(json({}, 429, { "retry-after": "120" }));
    await expect(new BlingClient(config, storage(), transport).request("/produtos"))
      .rejects.toMatchObject({ code: "rate_limited", retryAfterMs: 120000, retryable: true });
    expect(transport).toHaveBeenCalledOnce();
  });
  it("honors a short Retry-After and limits GET retries", async () => {
    vi.useFakeTimers();
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(json({}, 429, { "retry-after": "2" })).mockResolvedValue(json({ data: [] }));
    const promise = new BlingClient(config, storage(), transport).request("/produtos");
    await vi.advanceTimersByTimeAsync(1999);
    expect(transport).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await promise;
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("does not call the provider when daily budget is exhausted", async () => {
    const store = storage();
    store.reserveRequest = vi.fn(async () => 86400000);
    const transport = vi.fn<typeof fetch>();
    await expect(new BlingClient(config, store, transport).request("/produtos")).rejects.toMatchObject({ code: "rate_limited" });
    expect(transport).not.toHaveBeenCalled();
  });
  it.each([403, 422])("sanitizes %s errors and never includes provider payload", async (status) => {
    await expect(new BlingClient(config, storage(), vi.fn<typeof fetch>().mockResolvedValue(json({ secret: "do-not-expose" }, status)))
      .request("/produtos")).rejects.toMatchObject({ code: status === 403 ? "scope_denied" : "validation_error", retryable: false });
  });
  it("decodes the official gzip/base64 document envelope", async () => {
    const pdf = new TextEncoder().encode("%PDF-1.7\ntest-only");
    const compressed = await new Response(new Blob([pdf]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
    const content = btoa(String.fromCharCode(...new Uint8Array(compressed)));
    const provider = new BlingClient(config, storage(), vi.fn<typeof fetch>().mockResolvedValue(json({ data: [{ nome: "nota.pdf", conteudo: content }] })));
    expect(new TextDecoder().decode(await provider.invoiceDocument("1".repeat(44)))).toBe("%PDF-1.7\ntest-only");
  });
});

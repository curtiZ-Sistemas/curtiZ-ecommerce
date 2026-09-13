import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readBoundedBody, readPrivateJson, requirePrivateRateLimit } from "./private-request";
import { isAllowedRequestOrigin } from "./http-origin";

describe("private request boundary", () => {
  it("rejects missing or external mutation origins and accepts configured first-party origins", () => {
    const url = "https://store.example.invalid/api/support";
    expect(isAllowedRequestOrigin(new Request(url, { method: "POST" }))).toBe(false);
    expect(isAllowedRequestOrigin(new Request(url, { method: "POST", headers: { origin: "https://evil.invalid" } }))).toBe(false);
    expect(isAllowedRequestOrigin(new Request(url, { method: "POST", headers: { origin: "https://store.example.invalid" } }))).toBe(true);
    expect(isAllowedRequestOrigin(new Request(url, { headers: { "sec-fetch-site": "cross-site" } }))).toBe(false);
  });
  it("rejects non-JSON, invalid JSON and streamed oversized payloads without trusting Content-Length", async () => {
    const request = (body: string, contentType = "application/json") => new Request("https://example.invalid", {
      method: "POST", headers: { "content-type": contentType, "content-length": "1" }, body
    });
    await expect(readPrivateJson(request("{}", "text/plain"))).rejects.toMatchObject({ status: 415 });
    await expect(readPrivateJson(request("{"))).rejects.toMatchObject({ status: 400 });
    await expect(readBoundedBody(request("123456789"), 8)).rejects.toMatchObject({ status: 413 });
    await expect(readPrivateJson(request('{"ok":true}'))).resolves.toEqual({ ok: true });
  });
  it("fails closed on rate infrastructure failures or exhausted budgets", async () => {
    await expect(requirePrivateRateLimit({ rpc: async () => ({ data: null, error: {} }) }, "mfa_verify"))
      .rejects.toMatchObject({ status: 503 });
    await expect(requirePrivateRateLimit({ rpc: async () => ({ data: false, error: null }) }, "mfa_verify"))
      .rejects.toMatchObject({ status: 429 });
  });
});

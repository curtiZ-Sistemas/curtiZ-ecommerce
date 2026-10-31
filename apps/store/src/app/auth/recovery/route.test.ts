import { NextRequest } from "next/server";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { GET } from "./route";
const page = () => GET(new NextRequest("https://curtiz.com.br/auth/recovery"));
describe("isolated recovery document", () => {
  it("never consumes a token on GET and excludes cache, referrers, frames and third-party scripts", async () => {
    const response = page();
    const html = await response.text();
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(html).not.toMatch(/<script[^>]+src=|mercadopago|intelligence-bootstrap/iu);
    expect(html).toContain('img src="/images/logo-curtiz.png"');
  });
  it("erases the fragment before a single same-origin POST and uses a fixed destination", async () => {
    const html = await page().text();
    const script = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/u)?.[1];
    expect(script).toBeDefined();
    const calls: string[] = [];
    const location = { hash: "#token_hash=" + "a".repeat(64), replace: vi.fn() };
    const history = { replaceState: vi.fn(() => calls.push("erase")) };
    const nodes = { status: { textContent: "" }, retry: { hidden: true } };
    const fetchMock = vi.fn(async () => { calls.push("post"); return { ok: true }; });
    const execution: unknown = runInNewContext(script ?? "", { location, history,
      document: { getElementById: (id: keyof typeof nodes) => nodes[id] }, fetch: fetchMock, AbortController, setTimeout, clearTimeout,
      URLSearchParams }, { timeout: 1000 });
    await execution;
    expect(calls).toEqual(["erase", "post"]);
    expect(history.replaceState).toHaveBeenCalledWith(null, "", "/auth/recovery");
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/auth/recovery/verify", expect.objectContaining({
      method: "POST", credentials: "same-origin", body: JSON.stringify({ tokenHash: "a".repeat(64) })
    }));
    expect(location.replace).toHaveBeenCalledWith("/redefinir-senha");
  });
  it("does no verification for absent or malformed fragments", async () => {
    const html = await page().text();
    const script = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/u)?.[1];
    const fetchMock = vi.fn();
    const nodes = { status: { textContent: "" }, retry: { hidden: true } };
    const execution: unknown = runInNewContext(script ?? "", {
      location: { hash: "#token_hash=bad", replace: vi.fn() }, history: { replaceState: vi.fn() },
      document: { getElementById: (id: keyof typeof nodes) => nodes[id] }, fetch: fetchMock, AbortController, setTimeout, clearTimeout,
      URLSearchParams }, { timeout: 1000 });
    await execution;
    expect(fetchMock).not.toHaveBeenCalled(); expect(nodes.retry.hidden).toBe(false);
  });
});

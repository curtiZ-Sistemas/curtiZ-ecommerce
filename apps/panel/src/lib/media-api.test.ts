import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../app/api/media/route";

describe("public media proxy", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  const request = (bucket: string, path: string) => new Request(`https://panel.example.invalid/api/media?bucket=${bucket}&path=${encodeURIComponent(path)}`);
  it("rejects private buckets, traversal and arbitrary upstream origins", async () => {
    vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    for (const [bucket, path] of [["customer-private", "file.png"], ["catalog-public", "../file.png"],
      ["catalog-public", "https://evil.invalid/file.png"], ["catalog-public", "https://project.supabase.co/storage/v1/object/public/customer-private/file.png"]] as const) {
      expect((await GET(request(bucket, path))).status).toBe(400);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("streams only allowed media without forwarding cookies or provider headers", async () => {
    vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
    const fetcher = vi.fn().mockResolvedValue(new Response("image", {
      headers: { "content-type": "image/png", "set-cookie": "private", "x-upstream-internal": "hidden" }
    }));
    vi.stubGlobal("fetch", fetcher);
    const result = await GET(request("catalog-public", "banners/photo.png"));
    expect(result.status).toBe(200);
    expect(result.headers.get("set-cookie")).toBeNull();
    expect(result.headers.get("x-upstream-internal")).toBeNull();
    expect(fetcher).toHaveBeenCalledWith(new URL("https://project.supabase.co/storage/v1/object/public/catalog-public/banners/photo.png"), { redirect: "error" });
  });
  it("rejects active HTML and sanitizes upstream exceptions", async () => {
    vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
    const fetcher = vi.fn().mockResolvedValueOnce(new Response("<script>bad</script>", { headers: { "content-type": "text/html" } }))
      .mockRejectedValueOnce(new Error("private-upstream-details"));
    vi.stubGlobal("fetch", fetcher);
    expect((await GET(request("catalog-public", "file.html"))).status).toBe(404);
    const failed = await GET(request("catalog-public", "file.png"));
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain("private-upstream-details");
  });
  it("falls back only to a validated public banner image when the upstream fetch throws", async () => {
    vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("upstream unavailable")));
    const banner = await GET(request("catalog-public", "banners/photo.png"));
    expect(banner.status).toBe(307);
    expect(banner.headers.get("location")).toBe("https://project.supabase.co/storage/v1/object/public/catalog-public/banners/photo.png");
    expect(banner.headers.get("referrer-policy")).toBe("no-referrer");
    expect((await GET(request("homepage-public", "banners/photo.png"))).status).toBe(503);
    expect((await GET(request("catalog-public", "banners/page.html"))).status).toBe(503);
  });
});

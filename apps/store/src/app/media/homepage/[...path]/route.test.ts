import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

const homepageImagePath = [
  "home-section-images",
  "12345678-1234-4234-8234-123456789abc",
  "desktop-12345678-1234-4234-8234-123456789abc.webp"
];

describe("entrega pública controlada de mídia promocional", () => {
  beforeEach(() => {
    vi.stubEnv("SUPABASE_URL", "https://catalog.example.test");
    vi.stubEnv("APP_ENV", "production");
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("serve imagens do CMS com proteção de indexação e cache", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("webp", {
      status: 200,
      headers: { "content-type": "image/webp", "content-length": "4" }
    }));
    const response = await GET(new Request("https://curtiz.com.br/media/homepage"), {
      params: Promise.resolve({ path: homepageImagePath })
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-robots-tag")).toBe("noindex, noimageindex");
    expect(response.headers.get("cache-control")).toContain("s-maxage=31536000");
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "https://catalog.example.test/storage/v1/object/public/homepage-public/home-section-images/12345678-1234-4234-8234-123456789abc/desktop-12345678-1234-4234-8234-123456789abc.webp",
      { redirect: "manual" }
    );
  });

  it("não aceita produtos, vídeos, traversal nem destinos arbitrários", async () => {
    const fetchMock = vi.mocked(fetch);
    for (const path of [
      ["products", "user", "product.webp"],
      ["home-section-videos", "user", "clip.mp4"],
      ["home-section-images", "..", "hero.webp"],
      ["https:", "", "evil.example", "hero.webp"]
    ]) {
      const response = await GET(new Request("https://curtiz.com.br/media/homepage"), {
        params: Promise.resolve({ path })
      });
      expect(response.status).toBe(404);
      expect(response.headers.get("x-robots-tag")).toBeNull();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

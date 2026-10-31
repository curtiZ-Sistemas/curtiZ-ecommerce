import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

const bannerPath = [
  "banners",
  "12345678-1234-4234-8234-123456789abc",
  "desktop-12345678-1234-4234-8234-123456789abc.webp"
];

describe("entrega pública controlada de banners", () => {
  beforeEach(() => {
    vi.stubEnv("SUPABASE_URL", "https://catalog.example.test");
    vi.stubEnv("APP_ENV", "production");
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("serve somente o objeto de banner e envia diretiva anti-indexação com cache", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("webp", {
      status: 200,
      headers: { "content-type": "image/webp", "content-length": "4" }
    }));
    const response = await GET(new Request("https://curtiz.com.br/media/banner"), {
      params: Promise.resolve({ path: bannerPath })
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-robots-tag")).toBe("noindex, noimageindex");
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toContain("s-maxage=31536000");
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "https://catalog.example.test/storage/v1/object/public/catalog-public/banners/12345678-1234-4234-8234-123456789abc/desktop-12345678-1234-4234-8234-123456789abc.webp",
      { redirect: "manual" }
    );
  });

  it("não expõe products/, traversal nem destinos arbitrários", async () => {
    const fetchMock = vi.mocked(fetch);
    for (const path of [
      ["products", "user", "product.webp"],
      ["banners", "..", "secret.webp"],
      ["https:", "", "evil.example", "image.webp"]
    ]) {
      const response = await GET(new Request("https://curtiz.com.br/media/banner"), {
        params: Promise.resolve({ path })
      });
      expect(response.status).toBe(404);
      expect(response.headers.get("x-robots-tag")).toBeNull();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejeita redirecionamento e conteúdo que não seja imagem raster permitida", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location: "https://evil.example/image.webp" }
    }));
    const redirected = await GET(new Request("https://curtiz.com.br/media/banner"), {
      params: Promise.resolve({ path: bannerPath })
    });
    expect(redirected.status).toBe(502);

    vi.mocked(fetch).mockResolvedValue(new Response("text", {
      status: 200,
      headers: { "content-type": "text/html", "content-length": "4" }
    }));
    const invalidType = await GET(new Request("https://curtiz.com.br/media/banner"), {
      params: Promise.resolve({ path: bannerPath })
    });
    expect(invalidType.status).toBe(502);
  });

  it("aplica o limite de tamanho dos uploads de banner", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("x", {
      status: 200,
      headers: { "content-type": "image/webp", "content-length": String(10 * 1024 * 1024 + 1) }
    }));
    const response = await GET(new Request("https://curtiz.com.br/media/banner"), {
      params: Promise.resolve({ path: bannerPath })
    });
    expect(response.status).toBe(413);
    expect(response.headers.get("x-robots-tag")).toBe("noindex, noimageindex");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@curtiz/security", () => ({ logServerEvent: vi.fn() }));
vi.mock("./supabase/server", () => ({
  createPublicSupabaseClient: () => ({ rpc })
}));

import { getActiveProductImageSitemapEntries, getActiveProductSitemapEntries } from "./seo-data";

afterEach(() => vi.unstubAllEnvs());

describe("fonte de produtos do sitemap", () => {
  beforeEach(() => rpc.mockReset());

  it("usa a projeção comercial do banco e preserva updated_at real", async () => {
    rpc.mockResolvedValue({
      data: [
        { slug: "slide-ativo", updatedAt: "2026-09-12T10:00:00.000Z" },
        { slug: "sandalia-ativa", updatedAt: "2026-09-12T11:00:00.000Z" }
      ],
      error: null
    });

    await expect(getActiveProductSitemapEntries()).resolves.toEqual([
      { slug: "slide-ativo", updatedAt: "2026-09-12T10:00:00.000Z" },
      { slug: "sandalia-ativa", updatedAt: "2026-09-12T11:00:00.000Z" }
    ]);
    expect(rpc).toHaveBeenCalledWith("get_storefront_product_seo_entries", { p_limit: 50_000 });
  });

  it("não publica fallback hardcoded quando o banco falha", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "database_unavailable" } });
    await expect(getActiveProductSitemapEntries()).resolves.toEqual([]);
  });
});

describe("fonte do image sitemap", () => {
  beforeEach(() => {
    rpc.mockReset();
    vi.stubEnv("SUPABASE_URL", "https://catalog.example.test");
  });

  it("retorna somente imagens públicas válidas de produtos publicados, sem banners, vídeo ou registros incompletos", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          slug: "slide-ativo",
          name: "Slide Ativo",
          updatedAt: "2026-09-20T10:00:00.000Z",
          images: [
            { path: "products/user/product/main.webp", alt_text: "Slide preto", width: 1000, height: 1000, media_type: "image" },
            { path: "products/user/product/side.webp", alt_text: "Vista lateral do slide", width: 900, height: 900, media_type: "image" },
            { path: "banners/user/hero.webp", alt_text: "Campanha", width: 1000, height: 1000, media_type: "image" },
            { path: "products/user/product/video.mp4", alt_text: "Vídeo", width: 1000, height: 1000, media_type: "video" },
            { path: "products/user/product/missing.webp", alt_text: "Sem dimensões", width: 0, height: 0, media_type: "image" },
            { path: "", alt_text: "Sem caminho", width: 1000, height: 1000, media_type: "image" }
          ]
        },
        { slug: "produto-sem-imagem", name: "Sem foto", images: [] }
      ],
      error: null
    });

    await expect(getActiveProductImageSitemapEntries()).resolves.toEqual([
      {
        slug: "slide-ativo",
        updatedAt: "2026-09-20T10:00:00.000Z",
        images: [
          { url: "https://catalog.example.test/storage/v1/object/public/catalog-public/products/user/product/main.webp", alt: "Slide preto" },
          { url: "https://catalog.example.test/storage/v1/object/public/catalog-public/products/user/product/side.webp", alt: "Vista lateral do slide" }
        ]
      }
    ]);
    expect(rpc).toHaveBeenCalledWith("get_storefront_product_image_seo_entries", { p_limit: 50_000 });
  });

  it("sinaliza indisponibilidade quando a fonte pública falha", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "database_unavailable" } });
    await expect(getActiveProductImageSitemapEntries()).resolves.toBeNull();
  });
});

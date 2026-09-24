import { describe, expect, it } from "vitest";
import { bannerProxyUrl, isSafeBannerStoragePath } from "./banner-media";

const path = "banners/12345678-1234-4234-8234-123456789abc/mobile-12345678-1234-4234-8234-123456789abc.webp";

describe("URLs públicas de banners", () => {
  it("converte caminhos do bucket para a rota controlada", () => {
    expect(bannerProxyUrl(path, "https://catalog.example.test")).toBe(`/media/banner/${path}`);
    expect(bannerProxyUrl(`https://catalog.example.test/storage/v1/object/public/catalog-public/${path}`, "https://catalog.example.test"))
      .toBe(`/media/banner/${path}`);
  });

  it("mantém o acesso limitado ao prefixo banners e rejeita caminho externo ou traversal", () => {
    expect(isSafeBannerStoragePath("products/user/product.webp")).toBe(false);
    expect(isSafeBannerStoragePath("banners/user/../product.webp")).toBe(false);
    expect(isSafeBannerStoragePath("banners/user\\product.webp")).toBe(false);
    expect(bannerProxyUrl("https://other.example.test/storage/v1/object/public/catalog-public/" + path, "https://catalog.example.test"))
      .toBe("");
    expect(bannerProxyUrl("products/user/product.webp", "https://catalog.example.test")).toBe("");
  });
});

import { describe, expect, it } from "vitest";
import { buildProductImageSitemap } from "./image-sitemap";

describe("image sitemap de produtos", () => {
  it("inclui várias imagens de produto válidas e exclui banner e URL duplicada", () => {
    const xml = buildProductImageSitemap([{
      slug: "slide-wave",
      updatedAt: "2026-09-20T10:00:00.000Z",
      images: [
        { url: "https://catalog.example.test/storage/products/slide.webp", alt: "Slide & detalhe" },
        { url: "https://catalog.example.test/storage/products/slide.webp", alt: "Duplicada" },
        { url: "https://catalog.example.test/storage/catalog-public/banners/hero.webp", alt: "Banner" }
      ]
    }, {
      slug: "produto-sem-imagem",
      images: []
    }]);

    expect(xml).toContain("https://curtiz.com.br/produto/slide-wave");
    expect(xml).toContain("https://catalog.example.test/storage/products/slide.webp");
    expect(xml).toContain("Slide &amp; detalhe");
    expect(xml.match(/<image:loc>/gu)).toHaveLength(1);
    expect(xml).not.toContain("banners/");
    expect(xml).not.toContain("produto-sem-imagem");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isPublicProductImageUrl, productImageAlt, publicProductImageUrl } from "./product-image-seo";

beforeEach(() => vi.stubEnv("SUPABASE_URL", "https://catalog.example.test"));
afterEach(() => vi.unstubAllEnvs());

describe("SEO de imagem de produto", () => {
  it("prioriza alt salvo e usa fallback curto com a cor quando o valor está ausente ou genérico", () => {
    expect(productImageAlt("Slide Wave", "  Slide preto em uso  ")).toBe("Slide preto em uso");
    expect(productImageAlt("Slide Wave", "Imagem do produto", "Lilás")).toBe("Slide Wave Lilás da curti Z");
    expect(productImageAlt("Slide Wave", "", "Preto")).toBe("Slide Wave Preto da curti Z");
  });

  it("aceita somente paths públicos estáveis de produtos e exclui recursos conhecidos de campanha", () => {
    expect(publicProductImageUrl("products/user/product/slide.webp"))
      .toBe("https://catalog.example.test/storage/v1/object/public/catalog-public/products/user/product/slide.webp");
    expect(publicProductImageUrl("banners/user/hero.webp")).toBe("");
    expect(isPublicProductImageUrl("https://catalog.example.test/storage/catalog-public/products/slide.webp")).toBe(true);
    expect(isPublicProductImageUrl("https://catalog.example.test/storage/catalog-public/banners/hero.webp")).toBe(false);
  });
});

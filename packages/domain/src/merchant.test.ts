import { describe, expect, it } from "vitest";
import {
  evaluateMerchantEligibility,
  isValidGtin,
  merchantFeedXml,
  type MerchantCatalogItem
} from "./merchant";

const validItem: MerchantCatalogItem = {
  id: "variant-1",
  title: "Slide Wave - Preto - 37",
  description: "Slide leve e confortável.",
  link: "https://curtiz.com.br/produto/slide-wave?variant=variant-1",
  canonicalLink: "https://curtiz.com.br/produto/slide-wave",
  images: [
    { url: "https://images.example/slide.webp", width: 1000, height: 1000 },
    { url: "https://images.example/slide-lado.webp", width: 1000, height: 1000 }
  ],
  availability: "in_stock",
  priceInCents: 9990,
  salePriceInCents: 7990,
  condition: "new",
  brand: "curti Z",
  gtin: "7894900011517",
  identifierExists: true,
  googleProductCategory: "Apparel & Accessories > Shoes",
  productType: "Slides",
  color: "Preto",
  size: "37",
  gender: "unisex",
  ageGroup: "adult",
  itemGroupId: "product-1",
  itemGroupTitle: "Slide Wave"
};

describe("Google Merchant Center", () => {
  it("valida checksum e rejeita faixas restritas de GTIN", () => {
    expect(isValidGtin("7894900011517")).toBe(true);
    expect(isValidGtin("7894900011518")).toBe(false);
    expect(isValidGtin("0201234567892")).toBe(false);
  });

  it("marca produto completo como elegível", () => {
    expect(evaluateMerchantEligibility(validItem)).toEqual({
      eligible: true,
      reasons: [],
      warnings: []
    });
  });

  it("mantém produto incompleto fora do feed com motivos claros", () => {
    const result = evaluateMerchantEligibility({
      ...validItem,
      images: [],
      gender: undefined,
      gtin: undefined,
      identifierExists: true
    });

    expect(result.eligible).toBe(false);
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        "Produto sem imagem principal pública em HTTPS.",
        "Gênero do produto não informado.",
        "Produto marcado com identificador, mas sem GTIN ou MPN."
      ])
    );
  });

  it("gera XML por variante sem inventar frete ou avaliações", () => {
    const xml = merchantFeedXml([validItem], {
      title: "Produtos curti Z",
      description: "Catálogo público",
      link: "https://curtiz.com.br",
      generatedAt: new Date("2026-09-01T12:00:00.000Z")
    });

    expect(xml).toContain('xmlns:g="http://base.google.com/ns/1.0"');
    expect(xml).toContain("<g:item_group_id>product-1</g:item_group_id>");
    expect(xml).toContain("<g:price>99.90 BRL</g:price>");
    expect(xml).toContain("<g:sale_price>79.90 BRL</g:sale_price>");
    expect(xml).toContain("<g:additional_image_link>");
    expect(xml).not.toContain("shipping");
    expect(xml).not.toContain("review");
  });
});

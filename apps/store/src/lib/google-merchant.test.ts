import { describe, expect, it } from "vitest";
import { buildGoogleMerchantFeed } from "./google-merchant";

const row = {
  variant_id: "34c7651b-c829-4440-a411-419ddf0261a5",
  sku: "SLIDE-WAVE-PT-37",
  gtin: "7894900011517",
  mpn: null,
  product_id: "ba6cb2ea-ab48-47ef-b1bf-c22905865d6c",
  slug: "slide-wave",
  product_name: "Slide Wave",
  description: "Slide leve e confortável.",
  product_type: "Slides",
  color: "Preto",
  size: "37",
  effective_price_cents: 7990,
  original_price_cents: 9990,
  stock: 5,
  merchant_condition: "new",
  merchant_gender: "unisex",
  merchant_age_group: "adult",
  google_product_category: "Apparel & Accessories > Shoes",
  merchant_identifier_exists: true,
  images: [
    { path: "https://cdn.example/slide.webp", width: 1000, height: 1000 },
    { path: "https://cdn.example/slide-lado.webp", width: 1000, height: 1000 }
  ]
};

const build = (rows: unknown[]) =>
  buildGoogleMerchantFeed(rows, new Date("2026-09-01T12:00:00.000Z"));

describe("feed do Google Merchant", () => {
  it("publica produto simples com preço promocional e imagens", () => {
    const result = build([row]);
    expect(result.eligible).toBe(1);
    expect(result.xml).toContain("<g:price>99.90 BRL</g:price>");
    expect(result.xml).toContain("<g:sale_price>79.90 BRL</g:sale_price>");
    expect(result.xml).toContain("<g:additional_image_link>");
  });

  it("publica cores e tamanhos como variantes separadas do mesmo grupo", () => {
    const result = build([
      row,
      { ...row, variant_id: "b4ee8abb-123c-4714-ae58-5721769802ce", color: "Branco", size: "38" }
    ]);
    expect(result.eligible).toBe(2);
    expect(result.xml.match(/<g:item_group_id>/gu)).toHaveLength(2);
    expect(result.xml).toContain("<g:color>Branco</g:color>");
    expect(result.xml).toContain("<g:size>38</g:size>");
  });

  it("mantém indisponível no feed com estoque correto", () => {
    const result = build([{ ...row, stock: 0 }]);
    expect(result.eligible).toBe(1);
    expect(result.xml).toContain("<g:availability>out_of_stock</g:availability>");
  });

  it("exclui item sem imagem suficiente e informa motivo agregado", () => {
    const result = build([{ ...row, images: [{ path: "https://cdn.example/small.webp", width: 320, height: 320 }] }]);
    expect(result.eligible).toBe(0);
    expect(result.rejected).toBe(1);
    expect(result.rejectionCounts["Imagem principal menor que 500 x 500 pixels."]).toBe(1);
  });

  it("reflete atualização de preço e aceita catálogo vazio", () => {
    expect(build([{ ...row, effective_price_cents: 6990 }]).xml).toContain("69.90 BRL");
    const empty = build([]);
    expect(empty.eligible).toBe(0);
    expect(empty.xml).not.toContain("<item>");
  });
});

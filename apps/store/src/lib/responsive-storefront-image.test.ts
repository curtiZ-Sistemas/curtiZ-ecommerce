import { describe, expect, it } from "vitest";
import { bundledProductSrcSet, categoryImageSrcSet, productImageVariantUrl } from "./responsive-storefront-image";

const importedImage = `https://catalog.example.test/storage/v1/object/public/catalog-public/products/imports/20000000-0000-4000-8000-000000000001/${"a".repeat(64)}.webp`;

describe("imagens responsivas da vitrine", () => {
  it("gera candidatos responsivos para qualquer imagem pública de produto importado", () => {
    const srcSet = bundledProductSrcSet(importedImage);
    expect(srcSet).toContain("/media/product/products/imports/20000000-0000-4000-8000-000000000001/");
    expect(srcSet).toContain("?w=360 360w");
    expect(srcSet).toContain("?w=540 540w");
    expect(srcSet).toContain("?w=720 720w");
    expect(srcSet).toContain("?w=1080 1080w");
    expect(productImageVariantUrl(importedImage, 360)).toContain("?w=360");
  });

  it("não cria candidatos para URLs fora do bucket público de produtos", () => {
    expect(bundledProductSrcSet("https://images.example.test/products/item.webp")).toBeNull();
    expect(productImageVariantUrl(importedImage.replace("catalog-public", "homepage-public"), 360)).toBeNull();
    expect(productImageVariantUrl(importedImage, 999)).toBeNull();
  });

  it("dimensiona imagens armazenadas sob o namespace público de categorias", () => {
    const image = "https://catalog.example.test/storage/v1/object/public/catalog-public/categories/masculino.webp";
    expect(categoryImageSrcSet(image)).toContain("/media/category/categories/masculino.webp?w=360 360w");
    expect(categoryImageSrcSet(image.replace("catalog-public", "homepage-public"))).toBeNull();
  });
});

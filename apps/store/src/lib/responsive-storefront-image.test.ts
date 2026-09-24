import { describe, expect, it } from "vitest";
import { categoryImageSrcSet } from "./responsive-storefront-image";

describe("imagens responsivas da vitrine", () => {
  it("usa o endpoint responsivo correspondente ao namespace do objeto", () => {
    const base = "https://catalog.example.test/storage/v1/object/public/catalog-public/";
    expect(categoryImageSrcSet(base + "categories/masculino.webp"))
      .toContain("/media/category/categories/masculino.webp?w=360 360w");
    expect(categoryImageSrcSet(base + "products/imports/123e4567-e89b-12d3-a456-426614174000/image.webp"))
      .toContain("/media/product/products/imports/123e4567-e89b-12d3-a456-426614174000/image.webp?w=360 360w");
    expect(categoryImageSrcSet(base.replace("catalog-public", "homepage-public") + "categories/masculino.webp")).toBeNull();
    expect(categoryImageSrcSet(base + ["products", "..", "image.webp"].join("/"))).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { categoryImageSrcSet } from "./responsive-storefront-image";

describe("imagens responsivas da vitrine", () => {
  it("dimensiona somente imagens armazenadas sob o namespace público de categorias", () => {
    const image = "https://catalog.example.test/storage/v1/object/public/catalog-public/categories/masculino.webp";
    expect(categoryImageSrcSet(image)).toContain("/media/category/categories/masculino.webp?w=360 360w");
    expect(categoryImageSrcSet(image.replace("catalog-public", "homepage-public"))).toBeNull();
    expect(categoryImageSrcSet(image.replace("categories/masculino", "products/user/masculino"))).toBeNull();
  });
});

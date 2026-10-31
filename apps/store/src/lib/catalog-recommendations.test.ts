import { describe, expect, it } from "vitest";
import type { Product } from "@curtiz/domain";
import { availableCatalogRecommendations } from "./catalog-recommendations";

const product = (id: string, image: string, stock = 2): Product => ({
  id, slug: id, name: id, category: "Chinelos", description: "Produto real",
  priceInCents: 5990, rating: 0, reviews: 0, colors: [], sizes: [], image, stock
});

describe("catalog recommendations", () => {
  it("filters unavailable/demo media and deduplicates variants by product", () => {
    const result = availableCatalogRecommendations([
      product("out", "https://cdn.test/products/out.webp", 0),
      product("demo", "/images/demo.webp"),
      product("logo", "https://cdn.test/products/logo-placeholder.webp"),
      product("real", "https://cdn.test/products/real.webp"),
      product("real", "https://cdn.test/products/real-blue.webp"),
      product("other", "https://cdn.test/products/other.svg")
    ]);

    expect(result.map((item) => item.image)).toEqual(["https://cdn.test/products/real.webp"]);
  });

  it("limits suggestions to eight real products", () => {
    const result = availableCatalogRecommendations(
      Array.from({ length: 10 }, (_, index) => product(String(index), `https://cdn.test/${index}.webp`))
    );
    expect(result).toHaveLength(8);
  });
});

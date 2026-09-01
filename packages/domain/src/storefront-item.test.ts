import { describe, expect, it } from "vitest";
import {
  diversifyStorefrontItems,
  storefrontItemKey,
  storefrontProductHref
} from "./storefront-item";

describe("itens virtuais de vitrine", () => {
  it("preserva produto e variante na identidade e no link", () => {
    const item = { id: "produto-1", slug: "chinelo", variantId: "azul" };
    expect(storefrontItemKey(item)).toBe("produto-1:azul");
    expect(storefrontProductHref(item)).toBe("/produto/chinelo?variant=azul");
  });

  it("mantém o link canonical do produto quando não há variante", () => {
    expect(storefrontProductHref({ slug: "chinelo", variantId: undefined })).toBe(
      "/produto/chinelo"
    );
  });

  it("distribui variantes repetidas sem remover candidatos", () => {
    const input = [
      { id: "x", key: "x-azul" },
      { id: "x", key: "x-verde" },
      { id: "x", key: "x-preto" },
      { id: "y", key: "y" },
      { id: "z", key: "z" },
      { id: "w", key: "w" }
    ];
    const result = diversifyStorefrontItems(input, 2);
    expect(result.map((item) => item.key)).toEqual([
      "x-azul", "y", "z", "x-verde", "w", "x-preto"
    ]);
    expect(result).toHaveLength(input.length);
  });

  it("mantém custo limitado com milhares de candidatos", () => {
    const input = Array.from({ length: 5_000 }, (_, index) => ({
      id: `produto-${Math.floor(index / 5)}`,
      index
    }));
    expect(diversifyStorefrontItems(input)).toHaveLength(5_000);
  });
});

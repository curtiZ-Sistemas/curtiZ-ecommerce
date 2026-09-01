import { describe, expect, it } from "vitest";
import { parseCatalogRpcResult, parseRpcProductList } from "./catalog-result";

const variant = (overrides: Record<string, unknown> = {}) => ({
  id: "10000000-0000-4000-8000-000000000001",
  storefrontKey: "10000000-0000-4000-8000-000000000001:20000000-0000-4000-8000-000000000001",
  variantId: "20000000-0000-4000-8000-000000000001",
  sku: "ESS-AZ-37",
  variantColor: "Azul",
  variantSize: "37",
  slug: "chinelo-essential",
  name: "Chinelo Essential — Azul",
  category: "Masculino",
  description: "Chinelo confortável",
  priceInCents: 5990,
  compareAtPriceInCents: null,
  rating: 4.8,
  reviews: 12,
  colors: ["Azul"],
  sizes: ["37"],
  imagePath: "azul.webp",
  featured: false,
  stock: 3,
  ...overrides
});

describe("resultado virtual do catálogo", () => {
  it("mapeia imagem, preço e estoque específicos da variação", () => {
    const [product] = parseRpcProductList([variant()]) ?? [];
    expect(product).toMatchObject({
      id: "10000000-0000-4000-8000-000000000001",
      variantId: "20000000-0000-4000-8000-000000000001",
      name: "Chinelo Essential — Azul",
      priceInCents: 5990,
      stock: 3,
      colors: ["Azul"],
      sizes: ["37"]
    });
  });

  it("preserva total e paginação de StorefrontItems", () => {
    const result = parseCatalogRpcResult({
      products: [variant(), variant({
        storefrontKey: "10000000-0000-4000-8000-000000000001:20000000-0000-4000-8000-000000000002",
        variantId: "20000000-0000-4000-8000-000000000002",
        variantColor: "Verde",
        colors: ["Verde"],
        imagePath: "verde.webp",
        priceInCents: 6490,
        stock: 0
      })],
      total: 45,
      facets: {
        categories: [], collections: [], colors: [], sizes: [],
        price: { min: 5990, max: 6490 }, promotionCount: 0,
        inStockCount: 1, newestCount: 0
      }
    }, { page: 2, pageSize: 2 });
    expect(result).toMatchObject({ total: 45, page: 2, pageSize: 2 });
    expect(result?.products).toHaveLength(2);
    expect(result?.products[1]?.stock).toBe(0);
  });
});

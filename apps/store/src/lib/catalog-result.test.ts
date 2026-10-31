import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { parseCatalogRpcResult, parseRpcProductList, productCategory, publicCatalogImage } from "./catalog-result";

beforeEach(() => vi.stubEnv("SUPABASE_URL", "https://catalog.example.test"));
afterEach(() => vi.unstubAllEnvs());

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
  it("preserva categorias dinâmicas e não usa logo como foto", () => {
    expect(productCategory("Chinelos")).toBe("Chinelos");
    expect(productCategory("Categoria Nova")).not.toBe("Slides");
    expect(publicCatalogImage(null, "produto-real")).toBe("");
    expect(publicCatalogImage("/icon.svg", "produto-real")).toBe("");
    const [product] = parseRpcProductList([variant({ category: "Chinelos", categorySlug: "chinelos" })]) ?? [];
    expect(product).toMatchObject({ category: "Chinelos", categorySlug: "chinelos" });
  });
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

  it("mantém o nome base e mapeia o título visual separadamente", () => {
    const [product] = parseRpcProductList([variant({
      name: "Chinelo Essential",
      variantTitle: "Chinelo Essential Lilás — Leve e Confortável"
    })]) ?? [];
    expect(product).toMatchObject({
      name: "Chinelo Essential",
      variantTitle: "Chinelo Essential Lilás — Leve e Confortável"
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

  it("preserva o HEX real retornado pela facet de cor", () => {
    const result = parseCatalogRpcResult({
      products: [], total: 0,
      facets: {
        categories: [], collections: [],
        colors: [{
          value: "Bege Strass",
          label: "Bege Strass",
          count: 1,
          hex: "#C7A77B",
          secondaryHex: "#FFFFFF"
        }],
        sizes: [], price: { min: 0, max: 0 }, promotionCount: 0,
        inStockCount: 0, newestCount: 0
      }
    }, { page: 1, pageSize: 12 });

    expect(result?.facets.colors[0]?.hex).toBe("#C7A77B");
    expect(result?.facets.colors[0]?.secondaryHex).toBe("#FFFFFF");
  });
});

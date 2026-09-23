import { describe, expect, it } from "vitest";
import type { Product } from "@curtiz/domain";
import type { CatalogResult } from "./catalog-query";
import { appendCatalogPage, catalogFilterKey } from "./catalog-pagination";

const product = (id: string, storefrontKey: string) => ({ id, storefrontKey } as Product);
const result = (page: number, products: Product[], total = 3): CatalogResult => ({
  page, products, total, pageSize: 2, source: "supabase",
  facets: { categories: [], collections: [], colors: [], sizes: [],
    price: { min: 0, max: 0 }, promotionCount: 0, inStockCount: 0, newestCount: 0 }
});

describe("rolagem progressiva do catálogo", () => {
  it("acrescenta lotes e elimina cards repetidos", () => {
    const first = result(1, [product("a", "a:1"), product("b", "b:1")]);
    const second = result(2, [product("b", "b:1"), product("c", "c:1"), product("c", "c:1")]);
    expect(appendCatalogPage(first, second).products.map((item) => item.storefrontKey)).toEqual(["a:1", "b:1", "c:1"]);
  });
  it("substitui a lista na primeira página de um novo filtro", () => {
    expect(catalogFilterKey("categoria=chinelos&pagina=4")).toBe("categoria=chinelos");
    expect(appendCatalogPage(result(2, [product("a", "a:1")]), result(1, [product("b", "b:1")])).products)
      .toMatchObject([{ id: "b" }]);
  });
  it("keeps initial facets when a continuation page has no facet data", () => {
    const first = { ...result(1, [product("a", "a:1")]), facets: {
      ...result(1, []).facets, categories: [{ value: "chinelos", label: "Chinelos", count: 2 }]
    } };
    const next = result(2, [product("b", "b:1")]);
    expect(appendCatalogPage(first, next).facets).toEqual(first.facets);
  });
});

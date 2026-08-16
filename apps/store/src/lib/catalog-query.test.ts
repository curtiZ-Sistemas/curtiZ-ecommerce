import { describe, expect, it } from "vitest";
import { demoProducts } from "./catalog";
import { parseCatalogFilters, queryDemoCatalog } from "./catalog-query";

describe("catalog query", () => {
  it("restaura filtros previsíveis da URL", () => {
    const filters = parseCatalogFilters(
      new URLSearchParams(
        "cores=Preto,Marinho&tamanhos=39%2F40&preco_max=100&estoque=1&ordem=price_asc"
      )
    );
    expect(filters.colors).toEqual(["Preto", "Marinho"]);
    expect(filters.sizes).toEqual(["39/40"]);
    expect(filters.priceMax).toBe(10_000);
    expect(filters.inStock).toBe(true);
    expect(filters.sort).toBe("price_asc");
  });

  it("combina filtros no servidor demonstrativo", () => {
    const filters = parseCatalogFilters(
      new URLSearchParams("categoria=Masculino&cores=Preto&tamanhos=39%2F40&estoque=1")
    );
    const result = queryDemoCatalog(filters);
    expect(result.products.length).toBeGreaterThan(0);
    expect(result.products.every((product) => product.category === "Masculino")).toBe(true);
    expect(result.products.every((product) => product.colors.includes("Preto"))).toBe(true);
  });

  it("pagina e ordena sem carregar o catálogo inteiro no cliente", () => {
    const filters = parseCatalogFilters(new URLSearchParams("ordem=price_desc&pagina=1"));
    const result = queryDemoCatalog({ ...filters, pageSize: 3 });
    expect(result.products).toHaveLength(3);
    expect(result.products[0]!.priceInCents).toBeGreaterThanOrEqual(
      result.products[1]!.priceInCents
    );
  });

  it("aplica promoção e maior desconto no contrato compartilhado", () => {
    const filters = parseCatalogFilters(
      new URLSearchParams("promocao=1&ordem=discount")
    );
    const result = queryDemoCatalog(filters);
    expect(filters.promotion).toBe(true);
    expect(result.products.length).toBeGreaterThan(0);
    expect(result.products.every((product) => product.compareAtPriceInCents)).toBe(true);
  });

  it("mantém publicados sem saldo acessíveis e respeita o filtro de estoque", () => {
    const product = demoProducts[0]!;
    const originalStock = product.stock;
    product.stock = 0;
    try {
      const allProducts = queryDemoCatalog(parseCatalogFilters(new URLSearchParams()));
      const inStockProducts = queryDemoCatalog(
        parseCatalogFilters(new URLSearchParams("estoque=1"))
      );
      expect(allProducts.products.some((item) => item.id === product.id)).toBe(true);
      expect(inStockProducts.products.some((item) => item.id === product.id)).toBe(false);
    } finally {
      product.stock = originalStock;
    }
  });

  it("tolera acentos e erros curtos de digitação sem dependência adicional", () => {
    const typo = queryDemoCatalog(parseCatalogFilters(new URLSearchParams("q=sandlia")));
    const color = queryDemoCatalog(parseCatalogFilters(new URLSearchParams("q=marínho")));
    expect(typo.products.some((product) => product.category === "Sandálias")).toBe(true);
    expect(color.products.some((product) => product.colors.includes("Marinho"))).toBe(true);
  });
});

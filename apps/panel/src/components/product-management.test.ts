import { describe, expect, it } from "vitest";
import { filterManagedProducts, generateVariantCombinations } from "../lib/product-management";

const products = [
  {
    id: "1",
    name: "Produto disponível",
    slug: "produto-disponivel",
    status: "active",
    priceInCents: 1000,
    stock: 1,
    variants: [
      {
        id: "v1",
        sku: "SKU-1",
        color: "Preto",
        size: "40",
        active: true,
        available: 1,
        reserved: 0,
        sellable: 1
      }
    ]
  },
  {
    id: "2",
    name: "Produto sem saldo",
    slug: "produto-sem-saldo",
    status: "active",
    priceInCents: 2000,
    stock: 0,
    variants: []
  }
];

describe("product management", () => {
  it("mantém produtos sem estoque visíveis no filtro interno", () => {
    expect(filterManagedProducts(products, "out", "")).toEqual([products[1]]);
  });

  it("busca por nome ou SKU sem alterar a lista original", () => {
    expect(filterManagedProducts(products, "all", "sku-1")).toEqual([products[0]]);
    expect(products).toHaveLength(2);
  });

  it("gera combinações de cor e tamanho com SKU estável", () => {
    const variants = generateVariantCombinations("Azul, Preto", "35, 36", "Sandália 10");
    expect(variants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sku: "SANDALIA-10-AZUL-35", color: "Azul", size: "35" }),
        expect.objectContaining({ sku: "SANDALIA-10-PRETO-36", color: "Preto", size: "36" })
      ])
    );
    expect(variants).toHaveLength(4);
  });
});

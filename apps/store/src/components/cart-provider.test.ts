import { calculateSubtotal, type CartLine } from "@curtiz/domain";
import { describe, expect, it } from "vitest";
import { changeCartVariantState, type CartVariantSelection } from "../lib/cart-variant";

const line = (overrides: Partial<CartLine> = {}): CartLine => ({
  productId: "product-1",
  slug: "sandalia",
  variantId: "variant-35",
  name: "Sandália",
  image: "/35.webp",
  color: "Lilás Strass",
  size: "35",
  quantity: 2,
  maxQuantity: 10,
  unitPriceInCents: 10000,
  ...overrides
});

const size36: CartVariantSelection = {
  id: "variant-36",
  color: "Lilás Strass",
  size: "36",
  priceInCents: 12000,
  stock: 6,
  image: "/36.webp"
};

describe("changeCartVariantState", () => {
  it("troca a variante na mesma linha, preserva seleção e atualiza o subtotal", () => {
    const result = changeCartVariantState([line()], new Set(["variant-35"]), "variant-35", size36);

    expect(result.lines).toEqual([
      expect.objectContaining({
        variantId: "variant-36",
        size: "36",
        quantity: 2,
        unitPriceInCents: 12000,
        image: "/36.webp",
        maxQuantity: 6
      })
    ]);
    expect(result.selectedVariantIds).toEqual(new Set(["variant-36"]));
    expect(
      calculateSubtotal(
        result.lines.filter((item) => result.selectedVariantIds.has(item.variantId))
      )
    ).toBe(24000);
  });

  it("mescla com a variante já existente sem duplicar e respeita o estoque", () => {
    const result = changeCartVariantState(
      [line({ quantity: 4 }), line({ variantId: "variant-36", size: "36", quantity: 3 })],
      new Set(["variant-35"]),
      "variant-35",
      { ...size36, stock: 5 }
    );

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toEqual(expect.objectContaining({ variantId: "variant-36", quantity: 5, maxQuantity: 5 }));
    expect(result.selectedVariantIds).toEqual(new Set(["variant-36"]));
  });

  it("não permite trocar para uma variante sem estoque", () => {
    const original = [line()];
    const result = changeCartVariantState(original, new Set(["variant-35"]), "variant-35", {
      ...size36,
      stock: 0
    });

    expect(result.lines).toBe(original);
    expect(result.selectedVariantIds).toEqual(new Set(["variant-35"]));
  });
});

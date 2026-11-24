import { describe, expect, it } from "vitest";
import { isStrassProduct, kitDefaults, kitNameFor, kitSuggestedValues } from "./kit-defaults";

describe("preço e estoque sugeridos para kits", () => {
  it("usa R$ 204,00 por ficha para produtos strass/stress, sem acento e sem caixa", () => {
    for (const name of ["Chinelo Strass Dourado", "CHINELO STRASS", "Chinelo Stréss", "chinelo stress"]) {
      expect(isStrassProduct(name)).toBe(true);
      expect(kitSuggestedValues(name).grade_standard_price_cents).toBe(20_400);
    }
  });

  it("usa R$ 180,00 por ficha para o chinelo liso e 100 de estoque em cada ficha", () => {
    const values = kitSuggestedValues("Chinelo Liso Slide");
    expect(isStrassProduct("Chinelo Liso Slide")).toBe(false);
    expect([values.grade_standard_price_cents, values.grade_lower_restock_price_cents, values.grade_upper_restock_price_cents]).toEqual([18_000, 18_000, 18_000]);
    expect([values.grade_standard_stock, values.grade_lower_restock_stock, values.grade_upper_restock_stock]).toEqual([100, 100, 100]);
    expect(kitDefaults.stockPerSheet).toBe(100);
  });

  it("nomeia o kit com produto e cor", () => {
    expect(kitNameFor(" Chinelo Liso ", " Preto ")).toBe("Chinelo Liso – Preto");
  });
});

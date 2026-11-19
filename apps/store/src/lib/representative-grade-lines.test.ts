import { describe, expect, it, vi } from "vitest";
import { priceRepresentativeGradeItems } from "./representative-grade-lines";

vi.mock("server-only", () => ({}));

const grade = [1, 2, 3, 3, 2, 1].map((pairs, index) => ({
  variantId: `variant-${index}`, productId: "product", sku: `fixture-${index}`,
  name: "Fixture", size: String(34 + index), pairs, priceCents: 4_999
}));

describe("composição de uma ficha de revenda", () => {
  it("preserva tamanho, quantidade e centavos inclusive em devoluções parciais", () => {
    const one = priceRepresentativeGradeItems(grade, 30_001, 1);
    const three = priceRepresentativeGradeItems(grade, 30_001, 3);
    expect(one.reduce((sum, item) => sum + item.quantity, 0)).toBe(12);
    expect(three.reduce((sum, item) => sum + item.quantity * item.unitPriceInCents, 0)).toBe(90_003);
    expect(three).toEqual(one.map(item => ({ ...item, quantity: item.quantity * 3 })));
  });

  it("rejeita uma grade incompleta ou com variantes duplicadas", () => {
    expect(() => priceRepresentativeGradeItems(grade.slice(1), 30_001, 1)).toThrow();
    expect(() => priceRepresentativeGradeItems(grade.map(item => ({ ...item, variantId: "duplicate" })), 30_001, 1)).toThrow();
  });
});

import { describe, expect, it } from "vitest";
import {
  addDays,
  categoryPath,
  moneyToCents,
  selectableCategories,
  splitInstallments
} from "./financial-control";

describe("financial control helpers", () => {
  it("converte moeda brasileira para centavos sem float persistido", () => {
    expect(moneyToCents("R$ 1.500,00")).toBe(150_000);
    expect(moneyToCents("0,01")).toBe(1);
    expect(moneyToCents("inválido")).toBeNull();
  });

  it("distribui o arredondamento e preserva exatamente o total", () => {
    const parts = splitInstallments(10_000, 3);
    expect(parts).toEqual([3334, 3333, 3333]);
    expect(parts.reduce((total, part) => total + part, 0)).toBe(10_000);
    expect(() => splitInstallments(2, 3)).toThrow("installment below one cent");
  });

  it("calcula vencimentos em dias sem depender do fuso local", () => {
    expect(addDays("2026-01-31", 30)).toBe("2026-03-02");
  });

  it("não oferece contas totalizadoras como categoria de lançamento", () => {
    const categories = [
      { id: "group", name: "Administrativo", kind: "expense", active: true, is_group: true },
      {
        id: "child",
        name: "Internet",
        category_path: "Administrativo > Internet",
        kind: "expense",
        active: true,
        is_group: false
      },
      { id: "income", name: "Vendas", kind: "income", active: true, is_group: false }
    ];
    expect(selectableCategories(categories, "expense").map((item) => item.id)).toEqual(["child"]);
    expect(categoryPath(categories[1]!)).toBe("Administrativo > Internet");
  });
});

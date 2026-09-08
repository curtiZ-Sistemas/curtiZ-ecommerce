import { describe, expect, it } from "vitest";
import { parseProductDescription } from "./product-description";
import { commercialProductName } from "./catalog-result";

describe("product presentation", () => {
  it("preserves paragraphs and groups simple list lines safely", () => {
    expect(parseProductDescription("Título\n\n✔ Confortável\n- Leve\n\nFinal")).toEqual([
      { type: "paragraph", text: "Título" },
      { type: "list", items: ["Confortável", "Leve"] },
      { type: "paragraph", text: "Final" }
    ]);
  });

  it("uses the commercial product name instead of the generated variant title", () => {
    expect(commercialProductName({
      name: "Chinelo Slim — Marrom — 36",
      variantColor: "Marrom",
      variantSize: "36"
    })).toBe("Chinelo Slim");
  });
});

import { describe, expect, it } from "vitest";
import {
  normalizeProductColorHex,
  normalizeProductColorName,
  productColorSwatchColors
} from "./product-colors";

describe("product colors", () => {
  it("normalizes equivalent names and valid hex values", () => {
    expect(normalizeProductColorName("  PRÊTO   Strass ")).toBe("preto strass");
    expect(normalizeProductColorHex("#aabbcc")).toBe("#AABBCC");
    expect(normalizeProductColorHex("red")).toBe("");
  });

  it("renders a single color or an exact vertical 50/50 split", () => {
    expect(productColorSwatchColors("#000000")).toEqual({ primary: "#000000", secondary: undefined });
    expect(productColorSwatchColors("#000000", "#ffffff"))
      .toEqual({ primary: "#000000", secondary: "#FFFFFF" });
    expect(productColorSwatchColors("#000000", "#000000"))
      .toEqual({ primary: "#000000", secondary: undefined });
  });
});

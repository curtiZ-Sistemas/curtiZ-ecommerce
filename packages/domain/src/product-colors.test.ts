import { describe, expect, it } from "vitest";
import {
  normalizeProductColorHex,
  normalizeProductColorName,
  productColorSwatchBackground
} from "./product-colors";

describe("product colors", () => {
  it("normalizes equivalent names and valid hex values", () => {
    expect(normalizeProductColorName("  PRÊTO   Strass ")).toBe("preto strass");
    expect(normalizeProductColorHex("#aabbcc")).toBe("#AABBCC");
    expect(normalizeProductColorHex("red")).toBe("");
  });

  it("renders a single color or an exact vertical 50/50 split", () => {
    expect(productColorSwatchBackground("#000000")).toBe("#000000");
    expect(productColorSwatchBackground("#000000", "#ffffff"))
      .toBe("linear-gradient(to right, #000000 0 50%, #FFFFFF 50% 100%)");
  });
});

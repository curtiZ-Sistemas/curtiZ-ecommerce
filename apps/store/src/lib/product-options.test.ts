import { describe, expect, it } from "vitest";
import {
  galleryWindowStart,
  initialProductSelection,
  resolveProductColor
} from "./product-options";

describe("opções comerciais do produto", () => {
  it("usa color_hex válido e aplica fallback consistente aos produtos antigos", () => {
    expect(resolveProductColor("Azul", "#123ABC")).toBe("#123ABC");
    expect(resolveProductColor("Marinho")).toBe("#1e2a44");
    expect(resolveProductColor("Cor não mapeada")).toBe("#9b9b9b");
    expect(resolveProductColor("Preto", "url(https://example.com)")).toBe("#171717");
  });

  it("exige escolha quando uma cor tem mais de um tamanho disponível", () => {
    expect(
      initialProductSelection([
        { color: "Preto", size: "35/36", stock: 2 },
        { color: "Preto", size: "37/38", stock: 3 }
      ])
    ).toEqual({ color: "Preto", size: "" });
    expect(initialProductSelection([{ color: "Preto", size: "Único", stock: 1 }])).toEqual({
      color: "Preto",
      size: "Único"
    });
  });

  it("mantém a janela desktop limitada a três miniaturas", () => {
    expect(galleryWindowStart(1, 4)).toBe(0);
    expect(galleryWindowStart(3, 1)).toBe(0);
    expect(galleryWindowStart(6, 1)).toBe(1);
    expect(galleryWindowStart(6, 9)).toBe(3);
  });

  it("seleciona a variação indicada pelo link do feed", () => {
    expect(
      initialProductSelection(
        [
          { id: "variante-1", color: "Preto", size: "37", stock: 2 },
          { id: "variante-2", color: "Branco", size: "38", stock: 0 }
        ],
        "variante-2"
      )
    ).toEqual({ color: "Branco", size: "38" });
  });
});

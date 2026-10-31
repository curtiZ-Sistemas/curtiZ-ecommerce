import { describe, expect, it } from "vitest";
import {
  galleryWindowStart,
  gallerySwipeDirection,
  initialProductSelection,
  mediaForColor,
  preferredColorImage,
  productDisplayTitleForColor,
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

  it("distingue swipe horizontal de tap e rolagem vertical", () => {
    expect(gallerySwipeDirection(-60, 8)).toBe(1);
    expect(gallerySwipeDirection(60, 8)).toBe(-1);
    expect(gallerySwipeDirection(10, 2)).toBe(0);
    expect(gallerySwipeDirection(60, 90)).toBe(0);
  });

  it("mantém cor e imagem da apresentação quando há vários tamanhos", () => {
    const variants = [
      { id: "branco-34", color: "Branco", size: "34", stock: 2 },
      { id: "branco-39", color: "Branco", size: "39", stock: 2 },
      { id: "preto-34", color: "Preto", size: "34", stock: 2 }
    ];
    expect(initialProductSelection(variants, "branco-39", "Branco")).toEqual({ color: "Branco", size: "" });
    expect(initialProductSelection(variants, "removed", "Branco")).toEqual({ color: "Branco", size: "" });
    expect(initialProductSelection(variants, "preto-34", "Branco")).toEqual({ color: "Preto", size: "34" });
    const media = [
      { src: "branco-34.webp", color: "Branco", variantId: "branco-34" },
      { src: "preto.webp", color: "Preto", variantId: "preto-34" },
      { src: "branco-39.webp", color: "Branco", variantId: "branco-39" }
    ];
    expect(preferredColorImage(media, "Branco", "branco-39", "branco-39.webp", "fallback.webp")).toBe("branco-39.webp");
    expect(mediaForColor(media, "Branco", "branco-39")[0]?.src).toBe("branco-39.webp");
  });

  it("abre a apresentação Lilás com seis tamanhos sem escolher numeração", () => {
    const variants = ["Lilás", "Bege", "Preto", "Azul"].flatMap((color) =>
      ["34", "35", "36", "37", "38", "39"].map((size) => ({
        id: `${color}-${size}`, color, size, stock: size === "34" ? 0 : 3,
        displayTitle: `Chinelo Feminino Slim Liso ${color} — Leve e Confortável`
      }))
    );
    const media = [
      { src: "lilas.webp", variantId: "Lilás-34", color: "Lilás" },
      { src: "bege.webp", variantId: "Bege-34", color: "Bege" },
      { src: "preto.webp", variantId: "Preto-34", color: "Preto" },
      { src: "azul.webp", variantId: "Azul-34", color: "Azul" }
    ];
    expect(initialProductSelection(variants, "Lilás-35", "Lilás")).toEqual({ color: "Lilás", size: "" });
    expect(initialProductSelection(variants, "removed", "Lilás")).toEqual({ color: "Lilás", size: "" });
    expect(preferredColorImage(media, "Lilás", "Lilás-35", "lilas.webp", "bege.webp"))
      .toBe("lilas.webp");
    expect(productDisplayTitleForColor(variants, "Lilás", "Chinelo Feminino Slim Liso"))
      .toBe("Chinelo Feminino Slim Liso Lilás — Leve e Confortável");
    expect(productDisplayTitleForColor(variants, "Preto", "Chinelo Feminino Slim Liso"))
      .toBe("Chinelo Feminino Slim Liso Preto — Leve e Confortável");
    expect(productDisplayTitleForColor(variants, "Lilás", "Chinelo Feminino Slim Liso"))
      .toBe(productDisplayTitleForColor(variants.filter((variant) => variant.size !== "34"), "Lilás", "Chinelo Feminino Slim Liso"));
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

  it("usa a mídia da cor em todos os tamanhos e mantém a cor ao mudar numeração", () => {
    const media = [
      { src: "preto.webp", variantId: "preto-34", color: "Preto" },
      { src: "branco.webp", variantId: "branco-34", color: "Branco" },
      { src: "generica.webp" }
    ];
    expect(mediaForColor(media, "Branco", "branco-34").map((item) => item.src)).toEqual(["branco.webp", "generica.webp"]);
    expect(mediaForColor(media, "Branco", "branco-39")[0]?.src).toBe("branco.webp");
    expect(mediaForColor(media, "Preto", "preto-39")[0]?.src).toBe("preto.webp");
    expect(preferredColorImage(media, "Branco", "branco-39", "variante-branca.webp", "fallback.webp")).toBe("variante-branca.webp");
    expect(preferredColorImage([{ src: "generica.webp" }], "Branco", "branco-39", "variante-branca.webp", "fallback.webp")).toBe("variante-branca.webp");
    expect(mediaForColor([{ src: "generica.webp" }], "Branco", "branco-39", { src: "variante-branca.webp" }).map((item) => item.src)).toEqual(["variante-branca.webp", "generica.webp"]);
  });
});

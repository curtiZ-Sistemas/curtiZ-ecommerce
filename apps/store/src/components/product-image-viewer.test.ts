import { describe, expect, it } from "vitest";
import { clampImageTransform } from "./product-image-viewer";

describe("zoom da galeria de produto", () => {
  it("limita a escala entre 1x e 4x", () => {
    expect(clampImageTransform({ scale: 0.4, x: 20, y: 20 }, { width: 300, height: 200 })).toEqual({
      scale: 1,
      x: 0,
      y: 0
    });
    expect(clampImageTransform({ scale: 8, x: 0, y: 0 }, { width: 300, height: 200 }).scale).toBe(
      4
    );
  });

  it("impede que a imagem ampliada seja arrastada para fora dos limites", () => {
    expect(clampImageTransform({ scale: 2, x: 500, y: -500 }, { width: 320, height: 240 })).toEqual(
      { scale: 2, x: 160, y: -120 }
    );
  });
});

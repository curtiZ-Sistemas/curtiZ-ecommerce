import { describe, expect, it } from "vitest";
import { applyProductImageFallback } from "./product-image-fallback";

describe("fallback de imagem de produto", () => {
  it("troca para a imagem indisponível uma única vez e limpa srcset", () => {
    let removedAttributes = 0;
    const image = {
      dataset: {} as DOMStringMap,
      src: "https://catalog.example.test/product.webp",
      removeAttribute: () => { removedAttributes += 1; }
    } as unknown as HTMLImageElement;

    applyProductImageFallback(image);
    applyProductImageFallback(image);

    expect(image.src).toBe("/images/product-unavailable.svg");
    expect(image.dataset.fallbackApplied).toBe("true");
    expect(removedAttributes).toBe(1);
  });
});

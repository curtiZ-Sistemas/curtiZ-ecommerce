import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ColorSwatch } from "./color-swatch";

vi.stubGlobal("React", React);

describe("ColorSwatch", () => {
  it("renders one color and exposes its accessible name", () => {
    const html = renderToStaticMarkup(
      <ColorSwatch name="Preto" primaryColor="#000000" />
    );
    expect(html).toContain("aria-label=\"Cor Preto\"");
    expect(html).toContain('class="product-color-swatch-primary" style="background-color:#000000"');
    expect(html).not.toContain("product-color-swatch-secondary");
  });

  it("renders two colors with an exact vertical split", () => {
    const html = renderToStaticMarkup(
      <ColorSwatch
        name="Preto e Branco"
        primaryColor="#000000"
        secondaryColor="#FFFFFF"
      />
    );
    expect(html).toContain('class="product-color-swatch-primary" style="background-color:#000000"');
    expect(html).toContain('class="product-color-swatch-secondary" style="background-color:#FFFFFF"');
    expect(html).not.toContain("linear-gradient");
  });
});

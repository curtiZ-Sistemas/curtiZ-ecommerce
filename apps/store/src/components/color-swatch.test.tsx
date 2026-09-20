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
    expect(html).toContain("background:#000000");
  });

  it("renders two colors with an exact vertical split", () => {
    const html = renderToStaticMarkup(
      <ColorSwatch
        name="Preto e Branco"
        primaryColor="#000000"
        secondaryColor="#FFFFFF"
      />
    );
    expect(html).toContain("linear-gradient(to right, #000000 0 50%, #FFFFFF 50% 100%)");
  });
});

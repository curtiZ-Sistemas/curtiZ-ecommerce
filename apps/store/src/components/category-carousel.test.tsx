import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CategoryCarousel } from "./category-carousel";

vi.stubGlobal("React", React);

describe("category circles", () => {
  const html = renderToStaticMarkup(React.createElement(CategoryCarousel, {
    categories: [
      { name: "Dia a Dia", href: "/produtos?categoria=dia-a-dia", image: "/dia-a-dia.webp" },
      { name: "Estampados", href: "/produtos?categoria=estampados", image: "/estampados.webp" }
    ]
  }));

  it("renders one link per category with the image circle and only the name", () => {
    expect(html.match(/class="category-circles-item"/gu) ?? []).toHaveLength(2);
    expect(html.match(/class="category-circles-link"/gu) ?? []).toHaveLength(2);
    expect(html).toContain('href="/produtos?categoria=estampados"');
    expect(html).toContain('<span class="category-circles-name">Dia a Dia</span>');
    expect(html).not.toContain("Ver produtos");
  });

  it("keeps decorative images hidden from assistive tech since the name labels the link", () => {
    expect(html.match(/alt=""/gu) ?? []).toHaveLength(2);
  });
});

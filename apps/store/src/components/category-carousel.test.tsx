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

  it("renders three copies for the endless loop, keeping only the middle one accessible", () => {
    expect(html.match(/class="category-circles-item"/gu) ?? []).toHaveLength(6);
    expect(html.match(/class="category-circles-item" aria-hidden="true"/gu) ?? []).toHaveLength(4);
    expect(html.match(/tabindex="-1"/gu) ?? []).toHaveLength(4);
  });

  it("shows the image circle and only the category name in each link", () => {
    expect(html).toContain('href="/produtos?categoria=estampados"');
    expect(html).toContain('<span class="category-circles-name">Dia a Dia</span>');
    expect(html).not.toContain("Ver produtos");
    expect(html.match(/alt=""/gu) ?? []).toHaveLength(6);
  });
});

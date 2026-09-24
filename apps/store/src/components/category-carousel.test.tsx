import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CategoryCarousel } from "./category-carousel";

vi.stubGlobal("React", React);

describe("category carousel loop", () => {
  it("renders three seamless copies while keeping only the center copy keyboard-accessible", () => {
    const html = renderToStaticMarkup(React.createElement(CategoryCarousel, {
      categories: [
        { name: "Dia a Dia", href: "/produtos?categoria=dia-a-dia", image: "/dia-a-dia.webp" },
        { name: "Estampados", href: "/produtos?categoria=estampados", image: "/estampados.webp" }
      ]
    }));

    expect((html.match(/class="category-carousel-slide"/gu) ?? [])).toHaveLength(6);
    expect((html.match(/class="category-carousel-slide" aria-hidden="true"/gu) ?? [])).toHaveLength(4);
    expect((html.match(/tabindex="-1"/gu) ?? [])).toHaveLength(4);
    expect(html).toContain('href="/produtos?categoria=estampados"');
  });
});

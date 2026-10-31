import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { HomepageSection, Product } from "@curtiz/domain";
import type { HomepageData } from "@/lib/storefront-data";
import { HomepageSectionRenderer } from "./homepage-section-renderer";

vi.mock("./product-card", () => ({ ProductCard: () => null }));
vi.stubGlobal("React", React);

const product: Product = {
  id: "new-product",
  slug: "new-product",
  name: "Novo modelo",
  category: "Chinelos",
  description: "Modelo atual",
  priceInCents: 5990,
  rating: 0,
  reviews: 0,
  colors: ["Preto"],
  sizes: ["37"],
  image: "/images/products/new-product.webp",
  stock: 4
};

const section: HomepageSection = {
  id: "home-novidades",
  sectionType: "launches",
  title: "Novidades",
  subtitle: "Confira as ofertas imperdíveis desta semana",
  layout: "grid",
  visibility: "all",
  style: {},
  content: { href: "/lancamentos" },
  settings: {},
  items: [],
  active: true,
  sortOrder: 1
};

const data: HomepageData = {
  sections: [section],
  banners: [],
  products: [],
  categories: [],
  productsBySection: { [section.id]: [product] },
  testimonials: [],
  source: "demo"
};

describe("homepage product shelf heading", () => {
  it("shows only the title and Ver todos action", () => {
    const html = renderToStaticMarkup(
      <HomepageSectionRenderer data={data} section={section} priority={false} />
    );

    expect(html).toContain('<h2 id="home-novidades-title">Novidades</h2>');
    expect(html).toContain('href="/lancamentos"');
    expect(html).toContain("Ver todos");
    expect(html).not.toContain("eyebrow");
    expect(html).not.toContain("imperdíveis");
  });
});

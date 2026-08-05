import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HomepageHero } from "./homepage-hero";
import { ProductCard } from "./product-card";
import { SearchAutocomplete } from "./search-autocomplete";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() })
}));
vi.mock("./favorites-provider", () => ({
  useFavorites: () => ({ hydrated: true, has: () => false, toggle: vi.fn() })
}));
vi.stubGlobal("React", React);

const banners = [
  {
    id: "hero-1",
    title: "Coleção Curtiz",
    desktopImage: "/images/hero-curtiz-desktop.png",
    mobileImage: "/images/hero-curtiz-mobile.png",
    href: "/lancamentos",
    position: "hero"
  },
  {
    id: "hero-2",
    title: "Seleção de produtos",
    desktopImage: "/images/hero-curtiz-desktop.png",
    mobileImage: "/images/hero-curtiz-mobile.png",
    href: "/produtos",
    position: "hero"
  }
];

describe("public storefront components", () => {
  it("renderiza imagens distintas do hero para desktop e celular", () => {
    const html = renderToStaticMarkup(<HomepageHero banners={banners} />);

    expect(html).toContain("hero-media-desktop");
    expect(html).toContain("hero-media-mobile");
    expect(html).toContain('aria-label="Controles dos banners"');
    expect(html).toContain('href="/lancamentos"');
  });

  it("expõe uma busca acessível com autocomplete", () => {
    const html = renderToStaticMarkup(<SearchAutocomplete idPrefix="test" />);

    expect(html).toContain('role="search"');
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-autocomplete="list"');
    expect(html).toContain('action="/busca"');
  });

  it("mostra produto disponível sem revelar quantidade ou texto de estoque", () => {
    const html = renderToStaticMarkup(
      <ProductCard
        product={{
          id: "produto-1",
          slug: "produto-disponivel",
          name: "Produto disponível",
          category: "Masculino",
          description: "Produto",
          priceInCents: 5990,
          rating: 4.8,
          reviews: 10,
          colors: ["Preto"],
          sizes: ["40"],
          image: "/images/products/wave-preto.png",
          stock: 1
        }}
      />
    );

    expect(html).toContain("Produto disponível");
    expect(html.toLocaleLowerCase("pt-BR")).not.toContain("em estoque");
    expect(html.toLocaleLowerCase("pt-BR")).not.toContain("unidade");
  });
});

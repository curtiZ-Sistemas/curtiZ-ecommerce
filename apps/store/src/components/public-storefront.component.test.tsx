import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HomepageHero } from "./homepage-hero";
import { SearchAutocomplete } from "./search-autocomplete";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() })
}));

const banners = [
  {
    id: "hero-1",
    title: "Coleção Curtiz",
    desktopImage: "/images/hero-curtiz-desktop.webp",
    mobileImage: "/images/hero-curtiz-mobile.webp",
    href: "/lancamentos",
    position: "hero"
  },
  {
    id: "hero-2",
    title: "Seleção de produtos",
    desktopImage: "/images/hero-curtiz-desktop.webp",
    mobileImage: "/images/hero-curtiz-mobile.webp",
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
});

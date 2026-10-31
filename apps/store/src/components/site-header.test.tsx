import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/produtos", useSearchParams: () => new URLSearchParams("categoria=feminino") }));
vi.mock("./cart-provider", () => ({ useCart: () => ({ hydrated: true, lines: [] }) }));
vi.mock("./search-autocomplete", () => ({ SearchAutocomplete: () => <form role="search" /> }));
vi.mock("@/lib/auth-session-client", () => ({ fetchPublicAuthSession: vi.fn() }));
vi.stubGlobal("React", React);

import { HeaderNavigationLinks, SiteHeader } from "./site-header";
import { activeNavigationItemId, type StoreNavigationItem } from "../lib/store-navigation-core";

describe("cabeçalho configurável", () => {
  it("usa a mesma seleção e aria-current no desktop e no drawer mobile", () => {
    const navigation: StoreNavigationItem[] = [
      { id: "products", label: "Produtos", href: "/produtos", placement: "main" },
      { id: "female", label: "Feminino", href: "/produtos?categoria=feminino", placement: "main" }
    ];
    const activeId = activeNavigationItemId(navigation, "/produtos", new URLSearchParams("categoria=feminino&cor=preto"));
    const html = renderToStaticMarkup(<>
      <nav className="desktop-nav"><HeaderNavigationLinks navigation={navigation} activeId={activeId} /></nav>
      <nav className="mobile-drawer"><HeaderNavigationLinks navigation={navigation} activeId={activeId} /></nav>
    </>);
    expect(html.match(/aria-current="page"/gu)).toHaveLength(2);
    const femaleLinks = [...html.matchAll(/<a\b[^>]*>Feminino<\/a>/gu)].map(([link]) => link);
    const productLinks = [...html.matchAll(/<a\b[^>]*>Produtos<\/a>/gu)].map(([link]) => link);
    expect(femaleLinks).toHaveLength(2);
    expect(femaleLinks.every((link) => link.includes('class="active"') && link.includes('aria-current="page"'))).toBe(true);
    expect(productLinks.every((link) => !link.includes('aria-current="page"'))).toBe(true);
  });
  it("respeita visibilidade e ordenação recebidas do servidor no desktop e no celular", () => {
    const html = renderToStaticMarkup(<SiteHeader navigation={[
      { id: "home", label: "Início", href: "/", placement: "main" },
      { id: "female", label: "Feminino", href: "/produtos?categoria=feminino", placement: "main" },
      { id: "help", label: "Atendimento", href: "/ajuda", placement: "utility" }
    ]} />);
    expect(html.indexOf("Início")).toBeLessThan(html.indexOf("Feminino"));
    expect(html.indexOf("Feminino")).toBeLessThan(html.indexOf("Atendimento"));
    expect(html).not.toContain("Masculino");
    expect(html.match(/Feminino/gu)).toHaveLength(1);
  });
});

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/produtos" }));
vi.mock("./cart-provider", () => ({ useCart: () => ({ hydrated: true, lines: [] }) }));
vi.mock("./search-autocomplete", () => ({ SearchAutocomplete: () => <form role="search" /> }));
vi.mock("@/lib/auth-session-client", () => ({ fetchPublicAuthSession: vi.fn() }));
vi.stubGlobal("React", React);

import { SiteHeader } from "./site-header";

describe("cabeçalho configurável", () => {
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

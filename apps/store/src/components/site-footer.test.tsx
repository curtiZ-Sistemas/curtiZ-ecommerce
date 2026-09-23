import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SiteFooter, footerShoppingLinks } from "./site-footer";

vi.mock("./brand-logo", () => ({ BrandLogo: () => null }));
vi.mock("./cookie-preferences", () => ({ CookieSettingsButton: () => null }));
vi.stubGlobal("React", React);

const category = (id: string, label: string) => ({
  id, label, href: `/produtos?categoria=${id}`, placement: "main" as const
});

describe("rodapé da loja", () => {
  it("usa categorias expostas da navegação, remove duplicatas e acompanha adições e ocultações", () => {
    const visible = [category("feminino", "Feminino"), category("chinelos", "Chinelos")];
    expect(footerShoppingLinks([...visible, category("feminino", "Feminino")])).toEqual([
      ["Todos os produtos", "/produtos"],
      ["Feminino", "/produtos?categoria=feminino"],
      ["Chinelos", "/produtos?categoria=chinelos"]
    ]);
    expect(footerShoppingLinks([...visible, category("novidades", "Novidades")]))
      .toContainEqual(["Novidades", "/produtos?categoria=novidades"]);
    expect(footerShoppingLinks(visible.filter((item) => item.id !== "chinelos")))
      .not.toContainEqual(["Chinelos", "/produtos?categoria=chinelos"]);
  });

  it("não mostra categorias antigas nem lançamentos quando não estão expostos e usa o ano atual", () => {
    const html = renderToStaticMarkup(<SiteFooter navigation={[
      category("feminino", "Feminino"), category("chinelos", "Chinelos")
    ]} />);
    expect(html).toContain("Feminino");
    expect(html).toContain("Chinelos");
    expect(html).not.toContain("masculinos");
    expect(html).not.toContain("infantis");
    expect(html).not.toContain("Lançamentos");
    expect(html).toContain(`© ${new Date().getFullYear()} curti Z`);
  });
});

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

  it("inclui categorias da mesma navegação do header em ordem, deduplica slug e ignora páginas comuns", () => {
    expect(footerShoppingLinks([
      { ...category("branco", "Branco"), placement: "utility" },
      category("preto", "Preto"),
      { ...category("BRANCO", "Outra etiqueta"), href: "/produtos?categoria=BRANCO" },
      { id: "products", label: "Produtos", href: "/produtos", placement: "main" },
      { id: "help", label: "Ajuda", href: "/ajuda", placement: "main" }
    ])).toEqual([
      ["Todos os produtos", "/produtos"],
      ["Branco", "/produtos?categoria=branco"],
      ["Preto", "/produtos?categoria=preto"]
    ]);
  });

  it("mostra a identificação do fornecedor quando os dados legais estão completos", () => {
    const html = renderToStaticMarkup(<SiteFooter navigation={[]} company={{
      legalName: "Empresa Exemplo Ltda",
      tradeName: null,
      taxId: "11222333000181",
      address: "Rua Exemplo, 100, Centro",
      email: "contato@example.test",
      phone: null,
      supportChannel: null
    }} />);
    expect(html).toContain("Identificação do fornecedor");
    expect(html).toContain("Empresa Exemplo Ltda");
    expect(html).toContain("11.222.333/0001-81");
    expect(html).toContain("Rua Exemplo, 100, Centro");
    expect(html).toContain("mailto:contato@example.test");
  });

  it("não mostra o bloco de identificação nem quebra o rodapé sem dados legais", () => {
    const html = renderToStaticMarkup(<SiteFooter navigation={[]} />);
    expect(html).not.toContain("Identificação do fornecedor");
    expect(html).not.toContain("CNPJ");
    expect(html).toContain("Todos os direitos reservados");
  });
});

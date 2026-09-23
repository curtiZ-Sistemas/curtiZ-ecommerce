import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Product } from "@curtiz/domain";
import { describe, expect, it, vi } from "vitest";

vi.stubGlobal("React", React);
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) =>
  <a href={href}>{children}</a> }));
vi.mock("./product-card", () => ({ ProductCard: ({ product }: { product: Product }) =>
  <article data-product-id={product.id}>{product.name}</article> }));

import { SearchNoResults, shouldHideEmptyCatalogFilters } from "./search-no-results";

const suggestion = { id: "product-1", name: "Sandália de praia" } as Product;

describe("busca sem resultados", () => {
  it("oculta filtros sem utilidade somente após confirmar zero resultados", () => {
    expect(shouldHideEmptyCatalogFilters(0, 0, false)).toBe(true);
    expect(shouldHideEmptyCatalogFilters(0, 1, false)).toBe(false);
    expect(shouldHideEmptyCatalogFilters(0, 0, true)).toBe(false);
    expect(shouldHideEmptyCatalogFilters(undefined, 0, false)).toBe(false);
  });

  it("mostra introdução compacta e recomendações fora do estado vazio", () => {
    const html = renderToStaticMarkup(<SearchNoResults searchTerm="praia" suggestions={[suggestion]}
      loading={false} loaded />);
    expect(html).toContain("Não encontramos “praia”");
    expect(html).toContain('href="/produtos"');
    expect(html).toContain('class="search-no-results-recommendations"');
    expect(html).toContain('data-product-id="product-1"');
    expect(html).not.toContain("empty-state");
    expect(html).not.toContain("Limpar filtros");
    expect(html).not.toContain(">Voltar<");
  });

  it("reserva seis cards enquanto carrega", () => {
    const html = renderToStaticMarkup(<SearchNoResults searchTerm="praia" suggestions={[]}
      loading loaded={false} />);
    expect(html).toContain('class="search-recommendation-skeleton"');
    expect((html.match(/aria-hidden="true"/gu) ?? [])).toHaveLength(6);
  });
});

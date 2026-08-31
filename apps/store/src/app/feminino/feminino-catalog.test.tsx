import { renderToStaticMarkup } from "react-dom/server";
import React, { type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const dynamicConfiguration = vi.hoisted(() => ({ ssr: true }));

vi.stubGlobal("React", React);

vi.mock("next/dynamic", () => ({
  default: (
    _loader: unknown,
    options: { ssr: boolean; loading: () => ReactNode }
  ) => {
    dynamicConfiguration.ssr = options.ssr;
    return options.loading;
  }
}));

import { FemininoCatalog } from "./feminino-catalog";

describe("feminino catalog", () => {
  it("mantém SEO e skeleton leve sem renderizar o catálogo completo no Worker", () => {
    const html = renderToStaticMarkup(
      <FemininoCatalog description="Descrição da categoria feminina curti Z." />
    );

    expect(dynamicConfiguration.ssr).toBe(false);
    expect(html).toContain("<h1>Chinelos e sandálias femininas</h1>");
    expect(html).toContain("curti Z");
    expect(html).toContain('aria-label="Carregando produtos"');
    expect(html).not.toContain("Filtros");
  });
});

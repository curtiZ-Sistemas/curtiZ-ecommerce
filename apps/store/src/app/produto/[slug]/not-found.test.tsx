import { renderToStaticMarkup } from "react-dom/server";
import React, { type AnchorHTMLAttributes } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>{children}</a>
  )
}));
vi.mock("@/components/error-recommendations", () => ({
  ErrorRecommendations: ({ title = "Talvez você goste" }: { title?: string }) => <section><h2>{title}</h2></section>
}));

import ProductNotFound from "./not-found";

vi.stubGlobal("React", React);

describe("página de produto removido", () => {
  it("é compacta, oferece recuperação útil e não gera Product JSON-LD", () => {
    const html = renderToStaticMarkup(<ProductNotFound />);

    expect(html.match(/<h1/gu)).toHaveLength(1);
    expect(html).toContain("Este modelo não está mais disponível");
    expect(html).toContain("Ver produtos");
    expect(html).toContain("Buscar na loja");
    expect(html).toContain("Voltar ao início");
    expect(html).toContain("Outros modelos para você");
    expect(html).not.toContain("ITEM NÃO ENCONTRADO");
    expect(html).not.toContain("application/ld+json");
  });
});

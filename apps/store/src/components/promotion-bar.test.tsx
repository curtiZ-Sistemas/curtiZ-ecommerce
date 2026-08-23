import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PromotionBar } from "./promotion-bar";

describe("barra promocional da loja", () => {
  it("não ocupa espaço quando não há mensagens", () => {
    expect(renderToStaticMarkup(<PromotionBar messages={[]} />)).toBe("");
  });

  it("mostra uma mensagem estática sem controles", () => {
    const markup = renderToStaticMarkup(
      <PromotionBar
        messages={[{ id: "1", text: "Condições especiais", active: true, sortOrder: 0 }]}
      />
    );
    expect(markup).toContain("Condições especiais");
    expect(markup).not.toContain("Comunicado anterior");
    expect(markup).not.toContain("Próximo comunicado");
  });

  it("oferece navegação discreta e CTA para múltiplas mensagens", () => {
    const markup = renderToStaticMarkup(
      <PromotionBar
        messages={[
          { id: "1", text: "Primeira campanha", active: true, sortOrder: 0, href: "/ofertas", cta: "Ver ofertas" },
          { id: "2", text: "Segunda campanha", active: true, sortOrder: 1 },
          { id: "3", text: "Terceira campanha", active: true, sortOrder: 2 }
        ]}
      />
    );
    expect(markup).toContain('href="/ofertas"');
    expect(markup).toContain("Ver ofertas");
    expect(markup).toContain("Comunicado anterior");
    expect(markup).toContain("Próximo comunicado");
  });
});

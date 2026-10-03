import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LegalContent } from "./legal-content";
describe("conteúdo público seguro e compatível", () => {
  it("preserva destaques, listas e referências com links seguros", () => {
    const html = renderToStaticMarkup(
      <LegalContent
        format="markdown"
        content={
          "**7 dias corridos**\n\n- Primeiro\n- Segundo\n\n[Referência](https://example.invalid/lei)"
        }
      />
    );
    expect(html).toContain("<strong>7 dias corridos</strong>");
    expect(html).toContain("<ul>");
    expect(html).toContain('rel="noopener noreferrer"');
  });
  it("escapa HTML ativo e bloqueia protocolo javascript", () => {
    const html = renderToStaticMarkup(
      <LegalContent
        format="markdown"
        content={"<script>alert(1)</script>\n\n[Ativo](javascript:alert)"}
      />
    );
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain('href="javascript:');
  });
  it("mantém interpretação literal dos documentos antigos", () => {
    expect(
      renderToStaticMarkup(<LegalContent content={"Texto **literal**\nSegunda linha"} />)
    ).toBe("<p>Texto **literal**</p><p>Segunda linha</p>");
  });
});

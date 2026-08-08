import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PanelShell } from "./panel-shell";

describe("PanelShell multipainel", () => {
  it("mostra a troca no cabeçalho e no menu quando há múltiplos painéis", () => {
    const markup = renderToStaticMarkup(<PanelShell role="administracao" section="" canSwitchPanel><p>Conteúdo</p></PanelShell>);
    expect(markup.match(/Trocar painel/g)).toHaveLength(2);
    expect(markup.match(/href="\/selecionar-painel"/g)).toHaveLength(2);
  });

  it("não mostra troca de painel para uma única função", () => {
    const markup = renderToStaticMarkup(<PanelShell role="operacional" section=""><p>Conteúdo</p></PanelShell>);
    expect(markup).not.toContain("Trocar painel");
  });

  it("usa a logo original e inclui o acesso jurídico operacional", () => {
    const markup = renderToStaticMarkup(<PanelShell role="operacional" section=""><p>Conteúdo</p></PanelShell>);
    expect(markup).toContain("logo-curtiz.png");
    expect(markup).toContain("Políticas oficiais");
  });
});

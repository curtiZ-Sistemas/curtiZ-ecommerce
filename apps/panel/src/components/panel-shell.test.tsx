import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PanelShell, panelSearchRoute, panelSectionLabel } from "./panel-shell";

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
    expect(markup).toContain("Central de Ajuda");
  });

  it("mostra o nome real e direciona buscas para uma rota existente do perfil", () => {
    const manager = renderToStaticMarkup(
      <PanelShell role="gerencia" section="" userName="Maria Silva">
        <p>Conteúdo</p>
      </PanelShell>
    );
    const technical = renderToStaticMarkup(
      <PanelShell role="tecnico" section="">
        <p>Conteúdo</p>
      </PanelShell>
    );
    expect(manager).toContain("Maria Silva");
    expect(panelSearchRoute("operacional")).toBe("/operacional/pedidos");
    expect(panelSearchRoute("administracao")).toBe("/administracao/produtos");
    expect(panelSearchRoute("gerencia")).toBe("/gerencia/pedidos-vendas");
    expect(panelSearchRoute("tecnico")).toBe("/tecnico/logs");
    expect(panelSectionLabel("administracao", "colecoes")).toBe("Coleções");
    expect(technical).toContain("Técnico");
  });

  it("expõe contexto, prioridade e estado ativo sem criar ações decorativas", () => {
    const markup = renderToStaticMarkup(
      <PanelShell role="operacional" section="pedidos">
        <p>Conteúdo</p>
      </PanelShell>
    );

    expect(markup).toContain("Prioridade do painel");
    expect(markup).toContain('href="/operacional/pedidos"');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('aria-label="Navegação estrutural"');
  });
});

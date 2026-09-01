import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PanelShell, panelSearchRoute, panelSectionLabel } from "./panel-shell";

describe("PanelShell multipainel", () => {
  it("mostra a troca no cabeçalho e no menu quando há múltiplos painéis", () => {
    const markup = renderToStaticMarkup(
      <PanelShell role="administracao" section="" canSwitchPanel>
        <p>Conteúdo</p>
      </PanelShell>
    );
    expect(markup.match(/Trocar painel/g)).toHaveLength(2);
    expect(markup.match(/href="\/selecionar-painel"/g)).toHaveLength(2);
  });

  it("não mostra troca de painel para uma única função", () => {
    const markup = renderToStaticMarkup(
      <PanelShell role="operacional" section="">
        <p>Conteúdo</p>
      </PanelShell>
    );
    expect(markup).not.toContain("Trocar painel");
  });

  it("usa a logo original e inclui o acesso jurídico operacional", () => {
    const markup = renderToStaticMarkup(
      <PanelShell role="operacional" section="">
        <p>Conteúdo</p>
      </PanelShell>
    );
    expect(markup).toContain("logo-curtiz.webp");
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

  it("mostra o avatar único e oferece acesso ao perfil autenticado", () => {
    const storeUrl = process.env.NEXT_PUBLIC_STORE_URL ?? "http://localhost:3000";
    const markup = renderToStaticMarkup(
      <PanelShell
        role="administracao"
        section=""
        userName="Maria Silva"
        avatarUrl="https://example.supabase.co/storage/avatar-assinado"
      >
        <p>Conteúdo</p>
      </PanelShell>
    );

    expect(markup).toContain(`href="${storeUrl}/perfil"`);
    expect(markup).toContain("avatar-assinado");
    expect(markup).toContain("Abrir meu perfil");
  });

  it("expõe contexto e estado ativo sem o bloco explicativo de prioridade", () => {
    const markup = renderToStaticMarkup(
      <PanelShell role="operacional" section="pedidos">
        <p>Conteúdo</p>
      </PanelShell>
    );

    expect(markup).not.toContain("Prioridade do painel");
    expect(markup).toContain('href="/operacional/pedidos"');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('aria-label="Navegação estrutural"');
    expect(markup).toContain('href="#panel-content"');
    expect(markup).toContain('aria-label="Recolher menu lateral"');
    expect(markup).toContain('id="panel-content"');
  });

  it("concentra o catálogo em Produtos e não expõe configuração técnica na administração", () => {
    const markup = renderToStaticMarkup(
      <PanelShell role="administracao" section="produtos">
        <p>Conteúdo</p>
      </PanelShell>
    );

    expect(markup).toContain('href="/administracao/produtos"');
    expect(markup).toContain('href="/administracao/categorias"');
    expect(markup).toContain('href="/administracao/colecoes"');
    expect(markup).not.toContain('href="/administracao/variacoes"');
    expect(markup).not.toContain('href="/administracao/midias"');
    expect(markup).not.toContain('href="/administracao/estoque"');
    expect(markup).not.toContain('href="/administracao/modelos"');
    expect(markup).not.toContain('href="/administracao/configuracoes"');
    expect(markup).not.toContain("<details");
    expect(markup).not.toContain("<summary");
    expect(markup).toContain('<section class="side-nav-section">');
  });
});

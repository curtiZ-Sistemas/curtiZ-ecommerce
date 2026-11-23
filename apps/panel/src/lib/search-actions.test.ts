import { describe, expect, it } from "vitest";
import { actionsForPanel, SEARCH_ACTIONS, searchActions, suggestedActions } from "./search-actions";
import { editDistance, highlightSegments, normalizeText, rankSearch, tokenize } from "./search-engine";
import type { PanelRouteRole } from "./panel-roles";

const panels = Object.keys(SEARCH_ACTIONS) as PanelRouteRole[];
const top = (query: string, panel: PanelRouteRole, caps?: Record<string, boolean>) =>
  searchActions(query, panel, caps)[0]?.item;
const hrefs = (query: string, panel: PanelRouteRole, caps?: Record<string, boolean>) =>
  searchActions(query, panel, caps).map(({ item }) => item.href);

describe("motor de busca", () => {
  it("normaliza acentos, caixa e pontuação", () => {
    expect(normalizeText("  Solicitações  de NF-e! ")).toBe("solicitacoes de nf e");
    expect(tokenize("solicitações de representantes")).toEqual(["solicitacao", "representante"]);
  });

  it("calcula distância de edição com transposição e corte", () => {
    expect(editDistance("reprezentante", "representante", 2)).toBe(1);
    expect(editDistance("pedio", "pedido", 2)).toBe(1);
    expect(editDistance("cupom", "cuopm", 2)).toBe(1);
    expect(editDistance("abc", "xyzxyz", 1)).toBeGreaterThan(1);
  });

  it("ranqueia título exato > prefixo > sinônimo > descrição", () => {
    const items = [
      { id: "descricao", title: "Outra tela", description: "Mostra cupom ao final" },
      { id: "sinonimo", title: "Outra tela dois", keywords: ["cupom"] },
      { id: "prefixo", title: "Cupom de desconto" },
      { id: "exato", title: "Cupom" }
    ];
    expect(rankSearch("cupom", items).map(({ item }) => item.id)).toEqual(["exato", "prefixo", "sinonimo", "descricao"]);
  });

  it("exige todos os termos e destaca sem se importar com acento", () => {
    expect(rankSearch("cupom inexistente", [{ id: "a", title: "Cupom" }])).toEqual([]);
    const segments = highlightSegments("Solicitações pendentes", "solicitacao");
    expect(segments[0]).toEqual({ text: "Solicitações", match: true });
    expect(segments.map((segment) => segment.text).join("")).toBe("Solicitações pendentes");
    expect(highlightSegments("Aprovar", "apro")[0]).toEqual({ text: "Apro", match: true });
  });
});

describe("registro de ações do painel", () => {
  it("cobre os quatro painéis com ids únicos e rotas no formato real", () => {
    const total = panels.reduce((sum, panel) => sum + SEARCH_ACTIONS[panel].length, 0);
    expect(total).toBeGreaterThanOrEqual(130);
    for (const panel of panels) {
      const ids = SEARCH_ACTIONS[panel].map((action) => action.id);
      expect(new Set(ids).size).toBe(ids.length);
      const shape = new RegExp("^/" + panel + "(/[a-z0-9-]+)?([?][a-z_]+=[a-z_]+)?$");
      for (const action of SEARCH_ACTIONS[panel]) {
        expect(action.href).toMatch(shape);
        expect(action.keywords.length).toBeGreaterThan(2);
        expect(action.description.length).toBeGreaterThan(10);
      }
    }
  });

  it("'ativar representante' leva às solicitações pendentes em primeiro lugar", () => {
    expect(top("ativar representante", "administracao")?.href).toBe("/administracao/representantes?status=pendentes");
    expect(top("ativar representante", "gerencia")?.href).toBe("/gerencia/solicitacoes-representantes?status=pendentes");
    for (const query of ["liberar conta", "aprovar representante", "solicitação de representante", "habilitar representante", "representante pendente"]) {
      expect(top(query, "administracao")?.href, query).toBe("/administracao/representantes?status=pendentes");
      expect(top(query, "gerencia")?.href, query).toBe("/gerencia/solicitacoes-representantes?status=pendentes");
    }
  });

  it("no operacional, liberar conta de representante leva à habilitação MG02", () => {
    expect(top("ativar representante", "operacional")?.title).toBe("Habilitar conta para kits MG02");
  });

  it("'pedido reembolso' e variações levam aos reembolsos", () => {
    expect(top("pedido reembolso", "administracao")?.href).toBe("/administracao/devolucoes?status=refund_requested");
    expect(top("pedido reembolso", "gerencia")?.href).toBe("/gerencia/devolucoes?status=refund_requested");
    expect(top("estornar", "administracao")?.href).toBe("/administracao/devolucoes?status=refund_requested");
    expect(top("reembolsar", "operacional")?.href).toBe("/operacional/devolucoes?status=refund_requested");
  });

  it("tolera erros de digitação e acentos", () => {
    expect(top("reprezentante", "administracao")?.area).toBe("Representantes");
    expect(top("aprovar reprezentante", "administracao")?.href).toBe("/administracao/representantes?status=pendentes");
    expect(top("cuppom", "administracao")?.title).toBe("Cupons de desconto");
    expect(top("notas fiscias", "operacional")?.title).toMatch(/Notas fiscais/);
    expect(top("SOLICITACAO DE REPRESENTANTE", "gerencia")?.href).toContain("solicitacoes-representantes");
  });

  it("encontra ações de cada área principal", () => {
    expect(top("cadastrar produto", "administracao")?.href).toBe("/administracao/produtos");
    expect(top("produtos arquivados", "administracao")?.href).toBe("/administracao/produtos-arquivados");
    expect(top("nfe manual", "operacional")?.title).toBe("Enviar NF-e emitida manualmente (kits MG)");
    expect(top("enviar pedido", "operacional")?.href).toBe("/operacional/pedidos?status=ready_to_ship");
    expect(top("fluxo de caixa", "gerencia")?.href).toBe("/gerencia/financeiro");
    expect(top("lgpd", "administracao")?.href).toBe("/administracao/politicas");
    expect(top("quem alterou", "gerencia")?.href).toBe("/gerencia/auditoria");
    expect(top("reprocessar webhook", "tecnico")?.href).toBe("/tecnico/webhooks");
    expect(top("entrega de kit", "operacional")?.href).toBe("/operacional/kits");
  });

  it("não mistura ações de outro painel e esconde as sem permissão conhecida", () => {
    expect(SEARCH_ACTIONS.tecnico.every((action) => action.href.startsWith("/tecnico"))).toBe(true);
    expect(top("ativar representante", "tecnico")).toBeUndefined();
    const denied = { "representatives.manage": false };
    expect(actionsForPanel("administracao", denied).some((action) => action.permission === "representatives.manage")).toBe(false);
    expect(hrefs("ativar representante", "administracao", denied)).not.toContain("/administracao/representantes?status=pendentes");
    expect(hrefs("ativar representante", "administracao", { "representatives.manage": true })[0]).toBe(
      "/administracao/representantes?status=pendentes"
    );
  });

  it("oferece sugestões existentes para cada painel e vazio sem resultado", () => {
    for (const panel of panels) expect(suggestedActions(panel).length).toBeGreaterThanOrEqual(4);
    expect(searchActions("xqzwv", "administracao")).toEqual([]);
  });
});

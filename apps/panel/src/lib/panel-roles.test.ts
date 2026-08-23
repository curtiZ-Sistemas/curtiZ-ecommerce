import { describe, expect, it } from "vitest";
import {
  authorizedSelectablePanels,
  databaseRoleToPanelPath,
  hasMultipleSelectablePanels,
  hasPanelRouteAccess,
  panelRoleToDatabaseRole
} from "./panel-roles";

describe("papéis do painel", () => {
  it("mapeia cada rota ao papel persistido", () => {
    expect(panelRoleToDatabaseRole).toEqual({
      operacional: "operational",
      administracao: "admin",
      gerencia: "manager",
      tecnico: "technical"
    });
  });

  it("direciona contas multipainel para a Central", () => {
    expect(databaseRoleToPanelPath(["customer", "representative", "manager"])).toBe("/gerencia");
    expect(databaseRoleToPanelPath(["operational", "admin"])).toBe("/selecionar-painel");
    expect(hasMultipleSelectablePanels(["admin", "manager", "operational"])).toBe(true);
  });

  it("exibe somente painéis efetivamente atribuídos, incluindo o técnico", () => {
    expect(authorizedSelectablePanels(["admin", "technical"]).map((panel) => panel.databaseRole)).toEqual(["admin", "technical"]);
    expect(authorizedSelectablePanels(["manager", "operational"]).map((panel) => panel.databaseRole)).toEqual(["operational", "manager"]);
  });

  it("nega acesso direto quando a função correspondente não foi atribuída", () => {
    expect(hasPanelRouteAccess(["manager"], "gerencia")).toBe(true);
    expect(hasPanelRouteAccess(["manager"], "administracao")).toBe(false);
    expect(hasPanelRouteAccess(["admin"], "operacional")).toBe(false);
  });
});

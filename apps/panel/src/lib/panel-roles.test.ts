import { describe, expect, it } from "vitest";
import { databaseRoleToPanelPath, panelRoleToDatabaseRole } from "./panel-roles";

describe("papéis do painel", () => {
  it("mapeia cada rota ao papel persistido", () => {
    expect(panelRoleToDatabaseRole).toEqual({
      operacional: "operational",
      administracao: "admin",
      gerencia: "manager",
      tecnico: "technical"
    });
  });

  it("prioriza contexto interno privilegiado em contas com mais de um papel", () => {
    expect(databaseRoleToPanelPath(["customer", "representative", "manager"])).toBe("/gerencia");
    expect(databaseRoleToPanelPath(["operational", "admin"])).toBe("/administracao");
  });
});


import { describe, expect, it } from "vitest";
import { loginDestinations, resolveLoginDestination, resolveLoginRole } from "./auth-routing";

describe("login routing", () => {
  it.each([
    ["customer", "/minha-conta"],
    ["representative", "/representante"],
    ["operational", "/operacional"],
    ["admin", "/administracao"],
    ["manager", "/gerencia"],
    ["technical", "/tecnico"]
  ])("direciona %s para %s", (role, destination) => {
    const resolved = resolveLoginRole([role]);
    expect(resolved).toBe(role);
    expect(loginDestinations[resolved!]).toBe(destination);
  });

  it("não concede papel padrão quando a associação está ausente", () => {
    expect(resolveLoginRole([])).toBeNull();
    expect(resolveLoginRole(["unknown"])).toBeNull();
  });

  it("direciona múltiplos painéis selecionáveis para a Central", () => {
    expect(resolveLoginDestination(["admin", "manager", "operational"])).toBe("/selecionar-painel");
    expect(resolveLoginDestination(["admin", "manager"])).toBe("/selecionar-painel");
  });

  it.each([
    [["admin"], "/administracao"],
    [["manager"], "/gerencia"],
    [["operational"], "/operacional"],
    [["customer"], "/minha-conta"],
    [["representative"], "/representante"],
    [["technical"], "/tecnico"]
  ])("preserva o destino de %j", (roles, destination) => {
    expect(resolveLoginDestination(roles)).toBe(destination);
  });
});

import { describe, expect, it } from "vitest";
import {
  loginDestinations,
  resolveLoginDestination,
  resolveLoginRole,
  resolveLoginReturn,
  hasInternalPanelRole,
  resolvePostLoginDestination
} from "./auth-routing";

describe("login routing", () => {
  it.each(["admin", "manager", "technical", "operational"])("preserva cliente com papel %s", role => {
    expect(resolveLoginDestination(["customer", role])).toBe("/minha-conta");
    expect(hasInternalPanelRole(["customer", role])).toBe(true);
  });
  it("preserva o destino explícito e escolhe a origem do painel", () => {
    expect(resolveLoginReturn("/minha-conta/pedidos", "https://painel.curtiz.com.br")).toBe("/minha-conta/pedidos");
    expect(resolveLoginReturn("/operacional/pedidos", "https://painel.curtiz.com.br")).toBe("https://painel.curtiz.com.br/operacional/pedidos");
    expect(hasInternalPanelRole(["customer", "representative"])).toBe(false);
  });
  it.each([
    ["customer", "/minha-conta"],
    ["representative", "/minha-conta"],
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
    expect(resolveLoginDestination(["admin", "technical"])).toBe("/selecionar-painel");
    expect(resolveLoginDestination(["operational", "technical"])).toBe("/selecionar-painel");
  });

  it.each([
    [["admin"], "/administracao"],
    [["manager"], "/gerencia"],
    [["operational"], "/operacional"],
    [["customer"], "/minha-conta"],
    [["representative"], "/minha-conta"],
    [["technical"], "/tecnico"]
  ])("preserva o destino de %j", (roles, destination) => {
    expect(resolveLoginDestination(roles)).toBe(destination);
  });

  it.each([
    "/representante",
    "/representante/vendas",
    "/representante?origem=login",
    "/representante#resumo"
  ])("leva o login do portal %s primeiro para a conta do cliente", (destination) => {
    expect(resolvePostLoginDestination(destination)).toBe("/minha-conta");
  });

  it.each(["/checkout", "/carrinho", "/minha-conta/pedidos"])(
    "preserva o retorno legítimo para %s",
    (destination) => {
      expect(resolvePostLoginDestination(destination)).toBe(destination);
    }
  );
});

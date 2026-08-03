import { describe, expect, it } from "vitest";
import { loginDestinations, resolveLoginRole } from "./auth-routing";

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
});

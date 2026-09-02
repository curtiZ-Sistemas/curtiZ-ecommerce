import { describe, expect, it } from "vitest";
import { isManagerResource, managerResources } from "./manager-resources";

describe("manager resources", () => {
  it("expõe somente recursos persistidos da Gerência", () => {
    expect(isManagerResource("financeiro")).toBe(false);
    expect(isManagerResource("fechamentos")).toBe(true);
    expect(isManagerResource("auditoria")).toBe(true);
    expect(isManagerResource("usuarios")).toBe(false);
    expect(isManagerResource("integracoes")).toBe(false);
  });

  it("mantém consultas e filtros em colunas declaradas", () => {
    for (const definition of Object.values(managerResources)) {
      expect(definition.table).toMatch(/^[a-z_]+$/);
      expect(definition.select).not.toContain("*");
      expect(definition.select.split(",")).toContain(definition.orderColumn);
      expect(new Set(definition.columns.map((column) => column.key)).size).toBe(
        definition.columns.length
      );
      for (const column of definition.searchColumns) {
        expect(column).toMatch(/^[a-z_]+$/);
      }
    }
  });

  it("limita exportação às áreas gerenciais explicitamente autorizadas", () => {
    expect(managerResources.auditoria.exportAllowed).toBe(true);
    expect(managerResources.clientes.exportAllowed).not.toBe(true);
    expect(managerResources["configuracoes-estrategicas"].exportAllowed).not.toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { adminResources, isAdminResource } from "./admin-resources";

describe("admin resources", () => {
  it("expõe as áreas administrativas persistidas sem recursos desconhecidos", () => {
    expect(isAdminResource("categorias")).toBe(true);
    expect(isAdminResource("modelos")).toBe(true);
    expect(isAdminResource("pagina-inicial")).toBe(true);
    expect(isAdminResource("criativos")).toBe(false);
    expect(isAdminResource("representantes")).toBe(false);
    expect(isAdminResource("inexistente")).toBe(false);
  });

  it("mantém paginação e mutações limitadas a campos declarados", () => {
    for (const definition of Object.values(adminResources)) {
      expect(definition.table).toMatch(/^[a-z_]+$/);
      expect(definition.select).toContain(definition.table === "system_settings" ? "key" : "id");
      expect(new Set(definition.fields.map((field) => field.key)).size).toBe(
        definition.fields.length
      );
      if (definition.allowArchive) {
        expect(definition.archiveField).toBeTruthy();
        expect(definition.restoreValue).not.toBeUndefined();
      }
    }
  });

  it("não permite criação genérica de pedidos, clientes ou contratos aceitos", () => {
    expect(adminResources.pedidos.allowCreate).toBe(false);
    expect(adminResources.clientes.allowCreate).toBe(false);
    expect(adminResources.contratos.allowCreate).toBe(false);
  });

  it("mantém arquivamento reversível sem excluir o histórico", () => {
    expect(adminResources.banners).toMatchObject({
      archiveValue: "archived",
      restoreValue: "draft"
    });
    expect(adminResources.categorias).toMatchObject({
      archiveValue: false,
      restoreValue: true
    });
  });
});

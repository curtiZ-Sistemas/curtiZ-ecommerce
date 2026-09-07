import { describe, expect, it } from "vitest";
import { categoryDeletionMessage } from "./category-management";

describe("integridade das categorias", () => {
  it("permite excluir categoria vazia", () => {
    expect(categoryDeletionMessage(0, 0)).toBeNull();
  });

  it("explica quantos produtos impedem a exclusão", () => {
    expect(categoryDeletionMessage(2, 0)).toBe(
      "Esta categoria está sendo usada por 2 produtos. Mova os produtos para outra categoria antes de excluí-la."
    );
  });

  it("explica subcategorias sem mascarar o conflito", () => {
    expect(categoryDeletionMessage(0, 1)).toContain("1 subcategoria vinculada");
  });
});

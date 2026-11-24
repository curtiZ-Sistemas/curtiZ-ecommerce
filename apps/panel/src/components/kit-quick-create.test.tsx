import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { groupKitSources, isKitBulkComplete, KitBulkResult, KitQuickCreateModal, KitQuickPreview, suggestedSheetValues } from "./kit-quick-create";

const sources = [
  { productId: "p1", name: "Chinelo Strass", color: "Preto" },
  { productId: "p1", name: "Chinelo Strass", color: "Rosa" },
  { productId: "p2", name: "Chinelo Liso", color: "Branco" }
];

describe("cadastro rápido de kits", () => {
  it("agrupa as cores por produto", () => {
    expect(groupKitSources(sources)).toEqual([
      { productId: "p1", name: "Chinelo Strass", colors: ["Preto", "Rosa"] },
      { productId: "p2", name: "Chinelo Liso", colors: ["Branco"] }
    ]);
  });

  it("sugere preço de strass e de liso e estoque 100", () => {
    expect(suggestedSheetValues("Chinelo Strass")).toMatchObject({ grade_standard_price_cents: "204,00", grade_standard_stock: "100" });
    expect(suggestedSheetValues("Chinelo Liso")).toMatchObject({ grade_upper_restock_price_cents: "180,00", grade_lower_restock_stock: "100" });
  });

  it("pré-visualiza um kit por cor e marca a que já existe", () => {
    const group = groupKitSources(sources)[0]!;
    const html = renderToStaticMarkup(
      <KitQuickPreview group={group} existing={new Set(["p1|Preto"])} values={suggestedSheetValues(group.name)} />
    );
    expect(html).toContain("Chinelo Strass – Preto");
    expect(html).toContain("já existe");
    expect(html).toContain("Chinelo Strass – Rosa");
    expect(html).toContain("1 de 2 cores");
    expect(html).toContain("× 100");
  });

  it("mostra criados, pulados e erros", () => {
    const html = renderToStaticMarkup(<KitBulkResult outcomes={[
      { name: "A", status: "created" }, { name: "B", status: "skipped" }, { name: "C", status: "error", message: "falhou" }
    ]} />);
    expect(html).toContain("1 criado(s)");
    expect(html).toContain("1 pulado(s)");
    expect(html).toContain("C: falhou");
  });

  it("fecha automaticamente somente quando todos os kits foram criados ou já existiam", () => {
    expect(isKitBulkComplete([{ name: "A", status: "created" }, { name: "B", status: "created" }], 2)).toBe(true);
    expect(isKitBulkComplete([{ name: "A", status: "created" }, { name: "B", status: "skipped" }], 2)).toBe(true);
    expect(isKitBulkComplete([{ name: "A", status: "skipped" }], 1)).toBe(true);
    expect(isKitBulkComplete([{ name: "A", status: "created" }, { name: "B", status: "error" }], 2)).toBe(false);
    expect(isKitBulkComplete([{ name: "A", status: "created" }], 2)).toBe(false);
    expect(isKitBulkComplete([], 1)).toBe(false);
    expect(isKitBulkComplete([], 0)).toBe(false);
  });

  it("abre o modal com o seletor de produto e o botão de criar desabilitado", () => {
    const html = renderToStaticMarkup(<KitQuickCreateModal onClose={() => undefined} onCreated={() => undefined} />);
    expect(html).toContain("Cadastro rápido de kits");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Criar kits/u);
  });
});

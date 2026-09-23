import { describe, expect, it, vi } from "vitest";
import { Workbook } from "exceljs";

vi.mock("server-only", () => ({}));

import { parseStoreConfigWorkbook } from "./store-config-import";
import { buildStoreConfigSections } from "./store-config-sections";

async function workbookBytes(change?: (workbook: Workbook) => void) {
  const workbook = new Workbook();
  workbook.addWorksheet("Loja_Config").addRows([
    ["chave", "valor"], ["schema_version", "curtiz_store_config_v1"],
    ["sincronizar_menu_categorias", "SIM"], ["organizar_home_automaticamente", "SIM"],
    ["mostrar_categorias_home", "SIM"], ["mostrar_mais_vendidos", "SIM"],
    ["mostrar_faq", "SIM"], ["mostrar_storytelling", "SIM"]
  ]);
  workbook.addWorksheet("Categorias").addRows([
    ["categoria_chave", "nome", "slug", "ativa", "mostrar_menu", "mostrar_home", "ordem", "descricao"],
    ["chinelos", "Chinelos", "chinelos", "SIM", "SIM", "SIM", 1, "Modelos reais"]
  ]);
  workbook.addWorksheet("Navegacao").addRows([
    ["chave", "label", "tipo", "destino", "ordem", "visivel"],
    ["inicio", "Início", "page", "/", 10, "SIM"],
    ["chinelos", "Chinelos", "category", "chinelos", 30, "SIM"]
  ]);
  workbook.addWorksheet("Home_Ordem").addRows([
    ["ordem", "chave", "tipo", "titulo", "subtitulo", "ativo", "fonte", "limite"],
    [10, "categorias", "categories_grid", "Compre por categoria", "Real", "SIM", "categorias_reais", 8],
    [20, "mais-vendidos", "best_sellers", "Mais vendidos", "Reais", "SIM", "vendas_pagas", 8],
    [30, "faq", "faq", "Dúvidas frequentes", "Ajuda", "SIM", "FAQ", 8],
    [40, "story", "institutional", "Seu estilo", "Leve", "SIM", "Storytelling", 1]
  ]);
  workbook.addWorksheet("Storytelling").addRows([
    ["chave", "titulo", "subtitulo", "texto", "cta_texto", "cta_destino", "ordem", "ativo"],
    ["marca", "Seu estilo", "Leve", "Texto informado na planilha.", "Ver produtos", "/produtos", 1, "SIM"]
  ]);
  workbook.addWorksheet("FAQ").addRows([
    ["chave", "pergunta", "resposta", "ordem", "ativo"],
    ["tamanho", "Como escolher?", "Consulte o guia de tamanhos.", 1, "SIM"]
  ]);
  change?.(workbook);
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

describe("configuração XLSX da loja", () => {
  it("lê categorias, navegação, storytelling e FAQ sem criar conteúdo não fornecido", async () => {
    const plan = await parseStoreConfigWorkbook(await workbookBytes());
    expect(plan?.categories).toMatchObject([{ name: "Chinelos", slug: "chinelos", showMenu: true }]);
    expect(plan?.sheets).toEqual({ categories: true, navigation: true });
    expect(plan?.navigation).toHaveLength(2);
    expect(plan?.faq[0]?.answer).toBe("Consulte o guia de tamanhos.");
    expect(plan?.stories[0]?.text).toBe("Texto informado na planilha.");
  });

  it("omite mais vendidos sem vendas reais e produz chaves/hash estáveis", async () => {
    const plan = (await parseStoreConfigWorkbook(await workbookBytes()))!;
    const available = { hasSales: false, hasProducts: true, hasFeatured: false, hasCategories: true, existingBenefits: false };
    const first = buildStoreConfigSections(plan, available);
    const second = buildStoreConfigSections(plan, available);
    expect(first).toEqual(second);
    expect(first.map((section) => section.payload.sectionType)).toEqual(["categories_grid", "faq", "institutional"]);
    expect(first.find((section) => section.key === "faq")?.payload.items).toMatchObject([
      { title: "Como escolher?", description: "Consulte o guia de tamanhos." }
    ]);
  });

  it("distingue uma aba de navegação ausente de uma aba vazia", async () => {
    const absent = await parseStoreConfigWorkbook(await workbookBytes((workbook) => {
      workbook.removeWorksheet(workbook.getWorksheet("Navegacao")!.id);
    }));
    expect(absent?.sheets.navigation).toBe(false);
    expect(absent?.navigation).toEqual([]);
    const empty = await parseStoreConfigWorkbook(await workbookBytes((workbook) => {
      workbook.removeWorksheet(workbook.getWorksheet("Navegacao")!.id);
      workbook.addWorksheet("Navegacao").addRow(["chave", "label", "tipo", "destino", "ordem", "visivel"]);
    }));
    expect(empty?.sheets.navigation).toBe(true);
    expect(empty?.navigation).toEqual([]);
  });

  it("rejeita HTML, fórmulas e destinos externos", async () => {
    await expect(parseStoreConfigWorkbook(await workbookBytes((workbook) => {
      workbook.getWorksheet("FAQ")!.getCell("C2").value = "<script>alert(1)</script>";
    }))).rejects.toThrow(/marcação/u);
    await expect(parseStoreConfigWorkbook(await workbookBytes((workbook) => {
      workbook.getWorksheet("FAQ")!.getCell("C2").value = { formula: "1+1", result: 2 };
    }))).rejects.toThrow(/Fórmulas/u);
    await expect(parseStoreConfigWorkbook(await workbookBytes((workbook) => {
      workbook.getWorksheet("Navegacao")!.getCell("D2").value = "https://outside.test";
    }))).rejects.toThrow(/rota interna/u);
  });
});

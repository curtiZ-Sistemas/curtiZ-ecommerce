import { describe, expect, it, vi } from "vitest";
import { Workbook } from "exceljs";

vi.mock("server-only", () => ({}));

import { parseStoreConfigWorkbook } from "./store-config-import";
import { buildStoreConfigSections, planStoreConfigSectionChanges, type ExistingManagedHomeSection } from "./store-config-sections";

const v4Questions = [
  ["tamanho", "Como escolher o tamanho certo?", "Abra o Guia de Tamanhos na página do produto e compare a medida indicada com um chinelo que você já usa. Depois escolha uma numeração disponível para a cor desejada."],
  ["cores", "A foto muda quando escolho outra cor?", "Quando uma cor possui imagem própria, a galeria acompanha a variação selecionada. Trocar apenas o tamanho deve manter a mesma cor na imagem."],
  ["categorias", "Como encontro um modelo para cada ocasião?", "Use as categorias Dia a Dia, Praia e Piscina, Com Brilho, Kits e Estampados para encontrar opções organizadas por estilo e momento de uso."],
  ["pedido", "Como acompanho meu pedido?", "Entre em Minha Conta e acesse a área de pedidos para consultar as informações disponíveis sobre suas compras."],
  ["trocas", "Como funcionam trocas e devoluções?", "Consulte o Centro de Políticas da curti Z para ver as regras e condições de trocas e devoluções antes de solicitar atendimento."],
  ["atendimento", "Ainda preciso de ajuda?", "Acesse Atendimento para enviar sua dúvida e consultar os canais de suporte disponíveis na loja."]
] as const;

async function workbookBytes(change?: (workbook: Workbook) => void) {
  const workbook = new Workbook();
  workbook.addWorksheet("Loja_Config").addRows([
    ["chave", "valor"], ["schema_version", "curtiz_store_config_v1"],
    ["sincronizar_menu_categorias", "SIM"], ["organizar_home_automaticamente", "SIM"],
    ["publicar_home_automaticamente", "NAO"], ["mostrar_categorias_home", "SIM"],
    ["mostrar_mais_vendidos", "SIM"], ["mostrar_destaques", "SIM"], ["mostrar_novidades", "SIM"],
    ["mostrar_recomendados", "SIM"], ["mostrar_faq", "SIM"], ["mostrar_storytelling", "NAO"],
    ["mostrar_beneficios", "SIM"]
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
    ["ordem", "chave", "tipo", "titulo", "subtitulo", "ativo", "fonte", "limite", "regra"],
    [10, "categorias", "categories_grid", "Escolha seu momento", "Encontre o estilo certo para cada ocasião.", "SIM", "categorias_reais", 5, "Mostrar somente categorias temáticas com imagens diferentes."],
    [20, "destaques", "featured_products", "Destaques da curti Z", "Modelos escolhidos para você descobrir estilos diferentes.", "SIM", "featured", 5, "Diversificar produtos e não repetir imagem idêntica."],
    [30, "recomendados", "recommended_products", "Escolhas para você", "Sugestões com base no sistema de recomendações da curti Z.", "SIM", "personalized", 8, "Usar o sistema de recomendações existente."],
    [40, "novidades", "launches", "Novidades", "Os modelos mais recentes que chegaram ao catálogo.", "SIM", "newest", 8, "Somente produtos ativos, com imagem comercial e estoque."],
    [50, "mais-vendidos", "best_sellers", "Mais vendidos", "Os favoritos dos clientes, com base em vendas pagas reais.", "SIM", "automatic", 8, "Ocultar sem vendas pagas reais suficientes."],
    [70, "beneficios", "benefits", "Comprar na curti Z é simples", "Uma experiência organizada do carrinho ao acompanhamento do pedido.", "SIM", "existente", 4, "Reutilizar a seção de benefícios já existente no builder."],
    [80, "faq", "faq", "Dúvidas frequentes", "Ajuda rápida antes de finalizar sua compra.", "SIM", "FAQ", 6, "Exibir no final da home em accordion profissional e responsivo."]
  ]);
  workbook.addWorksheet("Storytelling").addRows([
    ["chave", "titulo", "subtitulo", "texto", "cta_texto", "cta_destino", "ordem", "ativo"]
  ]);
  workbook.addWorksheet("FAQ").addRows([
    ["chave", "pergunta", "resposta", "ordem", "ativo"],
    ...v4Questions.map(([key, question, answer], index) => [key, question, answer, index + 1, "SIM"])
  ]);
  change?.(workbook);
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

describe("configuração XLSX da loja", () => {
  it("lê a planilha V4, mantém FAQ vindo da aba e não cria storytelling", async () => {
    const plan = await parseStoreConfigWorkbook(await workbookBytes());
    expect(plan?.categories).toMatchObject([{ name: "Chinelos", slug: "chinelos", showMenu: true }]);
    expect(plan?.sheets).toEqual({ categories: true, navigation: true });
    expect(plan?.navigation).toHaveLength(2);
    expect(plan?.faq[0]?.answer).toBe(v4Questions[0][2]);
    expect(plan?.faq).toHaveLength(6);
    expect(plan?.stories).toEqual([]);
    expect(plan?.options.mostrar_storytelling).toBe(false);
  });

  it("produz a ordem V4 sem storytelling nem espaço para mais vendidos sem vendas", async () => {
    const plan = (await parseStoreConfigWorkbook(await workbookBytes()))!;
    const available = { hasSales: false, hasProducts: true, hasFeatured: true, hasCategories: true, existingBenefits: true };
    const first = buildStoreConfigSections(plan, available);
    const second = buildStoreConfigSections(plan, available);
    expect(first).toEqual(second);
    expect(first.map((section) => section.payload.internalName)).toEqual([
      "xlsx:categorias", "xlsx:destaques", "xlsx:recomendados", "xlsx:novidades", "xlsx:faq"
    ]);
    expect(first.some((section) => section.payload.sectionType === "best_sellers")).toBe(false);
    expect(first.some((section) => section.payload.internalName === "xlsx:storytelling")).toBe(false);
    expect(first.find((section) => section.key === "faq")?.payload.items).toMatchObject(
      v4Questions.map(([, question, answer]) => ({ title: question, description: answer }))
    );
  });

  it("inclui Mais vendidos só com vendas reais", async () => {
    const plan = (await parseStoreConfigWorkbook(await workbookBytes()))!;
    const sections = buildStoreConfigSections(plan, {
      hasSales: true, hasProducts: true, hasFeatured: true, hasCategories: true, existingBenefits: true
    });
    expect(sections.map((section) => section.payload.internalName)).toEqual([
      "xlsx:categorias", "xlsx:destaques", "xlsx:recomendados", "xlsx:novidades",
      "xlsx:mais-vendidos", "xlsx:faq"
    ]);
  });

  it("arquiva chaves XLSX antigas, preserva seções manuais e restaura sem duplicar", async () => {
    const plan = (await parseStoreConfigWorkbook(await workbookBytes()))!;
    const desired = buildStoreConfigSections(plan, {
      hasSales: false, hasProducts: true, hasFeatured: true, hasCategories: true, existingBenefits: true
    });
    const current: ExistingManagedHomeSection[] = [
      { id: "old-story", internal_name: "xlsx:storytelling", section_type: "institutional", revision: 4,
        content_config: {}, status: "published" },
      { id: "manual-benefits", internal_name: "manual:benefits", section_type: "benefits", revision: 2,
        content_config: {}, status: "published" },
      { id: "archived-faq", internal_name: "xlsx:faq", section_type: "faq", revision: 5,
        content_config: {}, status: "archived" }
    ];
    const changes = planStoreConfigSectionChanges(desired, current);
    expect(changes.find((change) => change.key === "storytelling")?.action).toBe("archive");
    expect(changes.find((change) => change.key === "faq")?.action).toBe("restore");
    expect(changes.some((change) => change.key === "benefits" && change.action === "archive")).toBe(false);

    const restoredCurrent = [
      ...current.filter((section) => section.id !== "archived-faq" && section.id !== "old-story"),
      { id: "old-story", internal_name: "xlsx:storytelling", section_type: "institutional", revision: 4,
        content_config: {}, status: "archived" },
      ...desired.map((section, index): ExistingManagedHomeSection => ({
        id: `managed-${index}`, internal_name: String(section.payload.internalName),
        section_type: String(section.payload.sectionType), revision: 1,
        content_config: section.payload.content, status: "draft"
      }))
    ];
    const secondPass = planStoreConfigSectionChanges(desired, restoredCurrent);
    expect(secondPass.every((change) => change.action === "unchanged")).toBe(true);
    expect(secondPass.some((change) => change.key === "storytelling")).toBe(false);
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

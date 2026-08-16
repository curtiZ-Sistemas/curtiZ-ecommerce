import { describe, expect, it } from "vitest";
import { builtInHelpContents, helpCategories, searchBuiltInHelp } from "./help-content";

describe("built-in help content", () => {
  it("tolera acentos e pequenas variações de palavra", () => {
    expect(searchBuiltInHelp("seguranca senha").map((item) => item.slug)).toContain(
      "proteger-conta"
    );
    expect(searchBuiltInHelp("rastre").map((item) => item.slug)).toContain("acompanhar-pedido");
  });

  it("aplica categoria sem expor conteúdo de outra área", () => {
    const results = searchBuiltInHelp("", "atendimento");
    expect(results).toHaveLength(1);
    expect(results[0]?.categorySlug).toBe("atendimento");
  });

  it("cobre os temas essenciais sem prometer integrações externas", () => {
    const requiredCategories = [
      "compras",
      "conta-cadastro",
      "pedidos",
      "pagamentos",
      "entregas-rastreamento",
      "produtos-tamanhos",
      "trocas-devolucoes",
      "representante-curtiz",
      "seguranca-privacidade",
      "atendimento"
    ];
    const coveredCategories = new Set(builtInHelpContents.map((item) => item.categorySlug));
    expect(requiredCategories.every((category) => coveredCategories.has(category))).toBe(true);
    expect(helpCategories.some((category) => category.slug === "compras")).toBe(true);

    const visibleText = builtInHelpContents
      .map((item) => `${item.title} ${item.summary} ${item.body}`)
      .join(" ");
    expect(visibleText).not.toMatch(/Mercado Pago|Melhor Envio|Resend|ambiente de (teste|demo)/iu);
  });
});

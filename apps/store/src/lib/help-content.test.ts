import { describe, expect, it } from "vitest";
import { searchDemoHelp } from "./help-content";

describe("help content demo search", () => {
  it("tolera acentos e pequenas variações de palavra", () => {
    expect(searchDemoHelp("seguranca senha").map((item) => item.slug)).toContain("proteger-conta");
    expect(searchDemoHelp("rastre").map((item) => item.slug)).toContain("acompanhar-pedido");
  });

  it("aplica categoria sem expor conteúdo de outra área", () => {
    const results = searchDemoHelp("", "atendimento");
    expect(results).toHaveLength(1);
    expect(results[0]?.categorySlug).toBe("atendimento");
  });
});

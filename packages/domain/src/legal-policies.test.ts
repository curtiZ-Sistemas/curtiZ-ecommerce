import { describe, expect, it } from "vitest";
import {
  legalPolicies,
  recognizeLegalPolicy,
  legalSectionsFromText,
  legalSectionsToText,
  legalContentKey,
  legalPlaceholders,
  legalCompanyReplacements,
  legalCompanyProblems,
  replaceLegalMarkers
} from "./legal-policies";
import { legalInlineTokens, legalMarkdownBlocks } from "./legal-markdown";
describe("políticas canônicas e conteúdo jurídico", () => {
  it.each(legalPolicies)("reconhece $slug sem criar rotas novas", (policy) => {
    expect(recognizeLegalPolicy(`08-${policy.title.toUpperCase().replaceAll(" ", "_")}`)).toBe(
      policy.slug
    );
    expect(recognizeLegalPolicy(`/politicas/${policy.slug}`)).toBe(policy.slug);
  });
  it("não inventa destino ambíguo", () => {
    expect(recognizeLegalPolicy("privacidade e cookies")).toBeUndefined();
  });
  it("retém introdução, numeração, referências e destaques no roundtrip", () => {
    const source =
      "# Termos de Uso\n\nIntrodução com **direitos** e acentos.\n\n## 1 Compra\n\n7 dias corridos.\n\n## 1.1 Garantia\n\nNão perde direitos.\n\nReferências normativas\n\nBRASIL. Referência completa.";
    const sections = legalSectionsFromText(source, "markdown");
    expect(sections.map((section) => section.section_number)).toEqual(["0", "1", "1.1", "2"]);
    expect(legalContentKey(legalSectionsFromText(legalSectionsToText(sections), "markdown"))).toBe(
      legalContentKey(sections)
    );
    expect(sections[0]?.content).toContain("**direitos**");
    expect(sections.at(-1)?.content).toContain("BRASIL.");
  });
  it("deduplica espaços e formatação sem remover diferenças jurídicas", () => {
    const base = legalSectionsFromText(
      "Termos de Uso\n1 Compra\nDireito de **7 dias**.",
      "markdown"
    );
    const plain = legalSectionsFromText("Termos de Uso\n1 Compra\nDireito de 7 dias.");
    expect(legalContentKey(base)).toBe(legalContentKey(plain));
    expect(legalContentKey(base)).not.toBe(
      legalContentKey(legalSectionsFromText("Termos de Uso\n1 Compra\nDireito de 5 dias."))
    );
  });
  it("valida os campos mesmo com uma flag completa", () => {
    expect(
      legalCompanyProblems({ completeness_status: "complete", tax_id: "00000000000000" })
    ).toContain("CNPJ");
    expect(legalCompanyProblems({ completeness_status: "complete" })).toContain("Razão social");
  });
  it("substitui somente dados existentes e conferidos", () => {
    expect(
      legalCompanyReplacements({ completeness_status: "review", legal_name: "Empresa de teste" })
    ).toEqual({});
    const replacements = legalCompanyReplacements({
      completeness_status: "complete",
      legal_name: "Empresa de teste",
      email: "[EMAIL_ATENDIMENTO]"
    });
    expect(replacements).toEqual({ "[RAZAO_SOCIAL]": "Empresa de teste" });
    expect(
      replaceLegalMarkers(
        legalSectionsFromText("[RAZAO_SOCIAL] [REGRA_DE_REMUNERACAO]"),
        replacements
      )[0]?.content
    ).toBe("Empresa de teste [REGRA_DE_REMUNERACAO]");
    expect(legalPlaceholders("[CNPJ] [PREENCHER APÓS VALIDAÇÃO] [CNPJ]")).toEqual([
      "[CNPJ]",
      "[PREENCHER APÓS VALIDAÇÃO]"
    ]);
  });
  it("renderiza listas e bloqueia protocolos ativos", () => {
    expect(legalMarkdownBlocks("- item\n- outro")[0]?.type).toBe("ul");
    expect(legalMarkdownBlocks("3. terceiro\n4. quarto")[0]?.start).toBe(3);
    const tokens = legalInlineTokens(
      "**7 dias** [link](javascript:alert) https://example.invalid/fonte."
    );
    expect(tokens.find((token) => token.text === "7 dias")?.bold).toBe(true);
    expect(tokens.find((token) => token.text === "link")?.href).toBeUndefined();
    expect(tokens.find((token) => token.text === "https://example.invalid/fonte")?.href).toBe(
      "https://example.invalid/fonte"
    );
  });
  it("conserva asteriscos literais no inventário de cookies e destaque combinado", () => {
    expect(
      legalContentKey(
        legalSectionsFromText("Cookies\n1 Autenticação\nO padrão sb-*-auth-token* mantém a sessão.")
      )
    ).toBe(
      legalContentKey(
        legalSectionsFromText(
          "Cookies\n## 1 Autenticação\nO padrão sb-\\*-auth-token\\* mantém a sessão.",
          "markdown"
        )
      )
    );
    expect(legalInlineTokens("***90 dias***")).toEqual([
      { text: "90 dias", bold: true, italic: true }
    ]);
  });
  it("mantém itens de lista como conteúdo, sem transformá-los em seções", () => {
    const sections = legalSectionsFromText("## 1 Direitos\n\n1. Primeiro direito\n2. Segundo direito", "markdown");
    expect(sections).toHaveLength(1); expect(sections[0]?.content).toContain("1. Primeiro direito");
  });
});

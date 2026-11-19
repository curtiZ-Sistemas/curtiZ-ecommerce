import { describe, expect, it } from "vitest";
import { cashChangeInCents, formatBRLInput, parseBRLToCents } from "./money";

describe("valores monetários brasileiros", () => {
  it("converte a entrada administrativa em reais para centavos", () => {
    expect(parseBRLToCents("20,00")).toBe(2_000);
    expect(parseBRLToCents("R$ 1.299,99")).toBe(129_999);
    expect(parseBRLToCents("49.90")).toBe(4_990);
  });

  it("formata centavos para edição sem expor a unidade interna", () => {
    expect(formatBRLInput(2_000)).toBe("20,00");
    expect(formatBRLInput(129_999)).toBe("1299,99");
  });

  it("rejeita valores inválidos", () => {
    expect(() => parseBRLToCents("20,999")).toThrow("Valor monetário inválido");
    expect(() => parseBRLToCents("-10,00")).toThrow("Valor monetário inválido");
  });

  it("calcula o troco em centavos e rejeita pagamentos insuficientes ou fora da faixa", () => {
    expect(cashChangeInCents(18_499, parseBRLToCents("200,00"))).toBe(1_501);
    expect(cashChangeInCents(18_499, 18_499)).toBe(0);
    expect(cashChangeInCents(18_499, 18_498)).toBeNull();
    expect(cashChangeInCents(18_499, Number.MAX_SAFE_INTEGER + 1)).toBeNull();
    expect(cashChangeInCents(0, 200)).toBeNull();
  });
});

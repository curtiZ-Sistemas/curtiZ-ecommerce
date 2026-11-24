import { describe, expect, it } from "vitest";
import { formatCep, formatCnpj, isValidCnpj, onlyDigits } from "./cnpj";

describe("CNPJ", () => {
  it("valida os dígitos verificadores e recusa sequências repetidas", () => {
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
    expect(isValidCnpj("11222333000181")).toBe(true);
    expect(isValidCnpj("11222333000182")).toBe(false);
    expect(isValidCnpj("00000000000000")).toBe(false);
    expect(isValidCnpj("1122233300018")).toBe(false);
    expect(isValidCnpj("")).toBe(false);
  });

  it("aplica a máscara enquanto se digita", () => {
    expect(formatCnpj("11222333000181")).toBe("11.222.333/0001-81");
    expect(formatCnpj("112223")).toBe("11.222.3");
    expect(formatCnpj("11a")).toBe("11");
    expect(formatCep("30110100")).toBe("30110-100");
    expect(formatCep("3011")).toBe("3011");
    expect(onlyDigits("11.222.333/0001-81")).toBe("11222333000181");
  });
});

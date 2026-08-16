import { describe, expect, it } from "vitest";
import {
  formatBrazilianPhone,
  formatCpf,
  isValidBrazilianPhone,
  isValidCpf,
  sanitizeBrazilianPhone,
  sanitizeCpf
} from "./personal-data";

describe("personal data formatting", () => {
  it("formata CPF progressivamente e limita a onze dígitos", () => {
    expect(formatCpf("1")).toBe("1");
    expect(formatCpf("1234")).toBe("123.4");
    expect(formatCpf("1234567")).toBe("123.456.7");
    expect(formatCpf("123456789012345678")).toBe("123.456.789-01");
    expect(sanitizeCpf("abc 529.982.247-25 xyz")).toBe("52998224725");
  });

  it("valida os dígitos verificadores e rejeita sequências", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("123.456.789-01")).toBe(false);
    expect(isValidCpf("111.111.111-11")).toBe(false);
    expect(isValidCpf("abc52998224725")).toBe(false);
  });

  it("formata telefone progressivamente e limita a onze dígitos", () => {
    expect(formatBrazilianPhone("3")).toBe("(3");
    expect(formatBrazilianPhone("3133334444")).toBe("(31) 3333-4444");
    expect(formatBrazilianPhone("319999999999999")).toBe("(31) 99999-9999");
    expect(sanitizeBrazilianPhone("31 telefone 99999-9999")).toBe("31999999999");
  });

  it("valida DDD e quantidade do telefone no servidor", () => {
    expect(isValidBrazilianPhone("(31) 99999-9999")).toBe(true);
    expect(isValidBrazilianPhone("(31) 3333-4444")).toBe(true);
    expect(isValidBrazilianPhone("(00) 99999-9999")).toBe(false);
    expect(isValidBrazilianPhone("319999999999999")).toBe(false);
  });
});

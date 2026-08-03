import { describe, expect, it } from "vitest";
import {
  assessPassword,
  formatBrazilianPhone,
  normalizeEmail,
  normalizeFullName,
  parseSignupInput
} from "./signup-validation";

const validPayload = {
  name: "Rafael Fernandes",
  email: "rafael@example.com",
  phone: "31999990000",
  password: "SolNorte92",
  confirmPassword: "SolNorte92",
  terms: "on"
};

describe("signup validation", () => {
  it("normaliza nome, espaços, acentos, hífen e apóstrofo", () => {
    expect(normalizeFullName("  joão-pedro   d'ávila ")).toBe("João-Pedro D'Ávila ");
  });

  it("normaliza e-mail sem espaços e em minúsculas", () => {
    expect(normalizeEmail(" RAFAEL @EMAIL.COM ")).toBe("rafael@email.com");
  });

  it("formata telefone fixo e celular", () => {
    expect(formatBrazilianPhone("3133334444")).toBe("(31) 3333-4444");
    expect(formatBrazilianPhone("31999990000")).toBe("(31) 99999-0000");
  });

  it("rejeita nome com número e telefone com letras", () => {
    expect(parseSignupInput({ ...validPayload, name: "Rafael2 Fernandes" }).success).toBe(false);
    expect(parseSignupInput({ ...validPayload, phone: "31abc999990000" }).success).toBe(false);
  });

  it("rejeita senhas comuns, sequenciais ou iguais aos dados pessoais", () => {
    for (const password of ["123456", "654321", "abc123", "qwerty", "111111", "senha1"]) {
      expect(assessPassword(password).valid).toBe(false);
    }
    expect(
      assessPassword("Rafael92", {
        name: "Rafael",
        email: "outro@example.com",
        phone: "31999990000"
      }).valid
    ).toBe(false);
  });

  it("aceita cadastro válido e salva telefone E.164", () => {
    const parsed = parseSignupInput(validPayload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.phone).toBe("+5531999990000");
      expect(parsed.data.email).toBe("rafael@example.com");
    }
  });

  it("rejeita confirmação diferente", () => {
    expect(parseSignupInput({ ...validPayload, confirmPassword: "Outra92" }).success).toBe(false);
  });
});

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

  it.each([
    ["(31) 99999-9999", "+5531999999999"],
    ["31999999999", "+5531999999999"],
    ["+55 31 99999-9999", "+5531999999999"],
    ["(31) 3333-4444", "+553133334444"]
  ])("aceita %s e normaliza em E.164", (phone, normalized) => {
    const parsed = parseSignupInput({ ...validPayload, phone });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.phone).toBe(normalized);
  });

  it("rejeita nome com número e telefone com letras", () => {
    expect(parseSignupInput({ ...validPayload, name: "Rafael2 Fernandes" }).success).toBe(false);
    expect(parseSignupInput({ ...validPayload, phone: "31abc999990000" }).success).toBe(false);
  });

  it.each(["119999999", "55119999999999", "(00) 99999-9999", "31 telefone 9999"])(
    "rejeita telefone realmente inválido: %s",
    (phone) => {
      const parsed = parseSignupInput({ ...validPayload, phone });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        const fieldErrors = parsed.error.flatten().fieldErrors as Record<
          string,
          string[] | undefined
        >;
        expect(fieldErrors.phone).toEqual([
          "Informe um telefone válido com DDD."
        ]);
      }
    }
  );

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

  it("não permite que o cadastro público envie uma role privilegiada", () => {
    expect(parseSignupInput({ ...validPayload, role: "admin" }).success).toBe(false);
  });
});

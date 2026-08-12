import { describe, expect, it } from "vitest";
import { sanitizeTechnicalValue } from "./technical-sanitizer";

describe("sanitizeTechnicalValue", () => {
  it("mascara chaves sensíveis e identificadores pessoais em logs", () => {
    expect(sanitizeTechnicalValue({
      authorization: "Bearer segredo",
      nested: {
        access_token: "segredo",
        message: "Falha para pessoa@curtiz.com no CPF 123.456.789-00"
      }
    })).toEqual({
      authorization: "[REDACTED]",
      nested: {
        access_token: "[REDACTED]",
        message: "Falha para [EMAIL] no CPF [CPF]"
      }
    });
  });

  it("limita profundidade, quantidade e tamanho dos valores exibidos", () => {
    const longText = "a".repeat(5_000);
    const result = sanitizeTechnicalValue({ text: longText, values: Array.from({ length: 120 }, (_, index) => index) });
    expect(result).toMatchObject({ text: "a".repeat(4_000) });
    expect((result as { values: unknown[] }).values).toHaveLength(100);
  });

  it("remove credenciais embutidas em mensagens sem depender do nome da chave", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEyMzQ1In0.signature123456789";
    const result = sanitizeTechnicalValue({
      message: `Falha token=${jwt} url=postgresql://admin:senha@db.example.com/app sk-live=sk_live_1234567890abcdef`
    }) as { message: string };

    expect(result.message).not.toContain("senha");
    expect(result.message).not.toContain("eyJ");
    expect(result.message).not.toContain("sk_live_");
    expect(result.message).toContain("[CONNECTION_URL]");
  });
});

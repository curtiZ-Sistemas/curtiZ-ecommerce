import { describe, expect, it } from "vitest";
import { redact, safeInternalPath, sanitizePlainText } from "./index";

describe("segurança", () => {
  it("remove segredos de objetos", () => {
    expect(redact({ token: "secret", safe: "ok" })).toEqual({ token: "[REDACTED]", safe: "ok" });
  });
  it("redige dados pessoais, financeiros, erros e chaves com grafias diferentes", () => {
    const input = { requestId: "safe-id", nested: [{ api_key: "sensitive", serviceRole: "sensitive", webhook_secret: "sensitive",
      credential: "sensitive", document: "sensitive", card: "sensitive", pixPayload: "sensitive", address: "sensitive" }],
      error: new Error("sensitive"), detail: "https://user:password@example.invalid?token=sensitive" };
    const result = JSON.stringify(redact(input));
    expect(result).not.toContain("sensitive");
    expect(result).not.toContain("password");
    expect(result).toContain("safe-id");
  });
  it("tolera contexto circular sem falhar durante o registro de um erro", () => {
    const value: Record<string, unknown> = { code: "UNAVAILABLE" };
    value.self = value;
    expect(redact(value)).toEqual({ code: "UNAVAILABLE", self: "[REDACTED]" });
  });
  it("bloqueia redirecionamento externo", () => {
    expect(safeInternalPath("//evil.example", "/conta")).toBe("/conta");
  });
  it("remove HTML e CPF do suporte", () => {
    expect(sanitizePlainText("<script>x</script> 123.456.789-09")).not.toContain("123");
  });
});

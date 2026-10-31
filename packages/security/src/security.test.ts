import { describe, expect, it } from "vitest";
import { isAllowedBrowserRequest, readBoundedJson, redact, safeInternalPath, sanitizePlainText } from "./index";

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
  it("redige credenciais comuns mesmo dentro de texto", () => {
    const result = String(redact("token=abc123456 github_pat_abcdefghijklmnopqrstuvwxyz"));
    expect(result).not.toContain("abc123456");
    expect(result).not.toContain("github_pat_");
  });
  it("limita JSON pelo stream e exige o Content-Type", async () => {
    await expect(readBoundedJson(new Request("https://app.test", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ok: true })
    }), 32)).resolves.toEqual({ ok: true });
    await expect(readBoundedJson(new Request("https://app.test", {
      method: "POST", headers: { "content-type": "application/json" }, body: "x".repeat(33)
    }), 32)).rejects.toMatchObject({ status: 413 });
  });
  it("rejeita mutação cross-site e requisição sem sinais de mesma origem", () => {
    const allowed = new Set(["https://panel.example"]);
    expect(isAllowedBrowserRequest(new Request("https://panel.example/api", {
      method: "POST", headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" }
    }), allowed)).toBe(false);
    expect(isAllowedBrowserRequest(new Request("https://panel.example/api", {
      method: "POST", headers: { origin: "https://panel.example", "sec-fetch-site": "same-origin" }
    }), allowed)).toBe(true);
    expect(isAllowedBrowserRequest(new Request("https://panel.example/api", { method: "POST" }), allowed)).toBe(false);
  });
  it("bloqueia redirecionamento externo", () => {
    expect(safeInternalPath("//evil.example", "/conta")).toBe("/conta");
    expect(safeInternalPath("/\\evil.example", "/conta")).toBe("/conta");
    expect(safeInternalPath("/\n/evil.example", "/conta")).toBe("/conta");
    expect(safeInternalPath("/minha-conta?aba=pedidos", "/conta")).toBe("/minha-conta?aba=pedidos");
  });
  it("remove HTML e CPF do suporte", () => {
    expect(sanitizePlainText("<script>x</script> 123.456.789-09")).not.toContain("123");
  });
});

import { describe, expect, it } from "vitest";
import { redact, safeInternalPath, sanitizePlainText } from "./index";

describe("segurança", () => {
  it("remove segredos de objetos", () => {
    expect(redact({ token: "secret", safe: "ok" })).toEqual({ token: "[REDACTED]", safe: "ok" });
  });
  it("bloqueia redirecionamento externo", () => {
    expect(safeInternalPath("//evil.example", "/conta")).toBe("/conta");
  });
  it("remove HTML e CPF do suporte", () => {
    expect(sanitizePlainText("<script>x</script> 123.456.789-09")).not.toContain("123");
  });
});

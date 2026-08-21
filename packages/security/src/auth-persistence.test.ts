import { describe, expect, it } from "vitest";
import { applyAuthCookiePersistence, readAuthPersistence } from "./auth-persistence";

describe("persistência da autenticação", () => {
  it("mantém expiração somente quando o usuário escolhe permanecer conectado", () => {
    const options = { httpOnly: true, maxAge: 3600, expires: new Date("2030-01-01") };
    expect(applyAuthCookiePersistence(options, "persistent")).toEqual(options);
    expect(applyAuthCookiePersistence(options, "session")).toEqual({ httpOnly: true });
  });

  it("preserva cookies de remoção no logout", () => {
    expect(applyAuthCookiePersistence({ maxAge: 0 }, "session")).toEqual({ maxAge: 0 });
  });

  it("trata marcador ausente ou inválido como sessão não persistente", () => {
    expect(readAuthPersistence(undefined)).toBe("session");
    expect(readAuthPersistence("invalid")).toBe("session");
    expect(readAuthPersistence("persistent")).toBe("persistent");
  });
});

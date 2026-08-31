import { describe, expect, it } from "vitest";
import {
  configuredCookieDomains,
  cookieDomainMatchesHost,
  normalizeCookieDomain,
  sharedCookieOptions
} from "./auth-cookie";

describe("cookies compartilhados entre aplicações", () => {
  it("normaliza e valida domínio sem aceitar URL ou host local", () => {
    expect(normalizeCookieDomain(".example.com")).toBe("example.com");
    expect(normalizeCookieDomain("https://example.com")).toBeNull();
    expect(normalizeCookieDomain("localhost")).toBeNull();
  });

  it("aceita somente o domínio ou seus subdomínios", () => {
    expect(cookieDomainMatchesHost("example.com", "store.example.com")).toBe(true);
    expect(cookieDomainMatchesHost("example.com", "example.com")).toBe(true);
    expect(cookieDomainMatchesHost("example.com", "notexample.com")).toBe(false);
  });

  it("seleciona o domínio correspondente entre produção e workers.dev", () => {
    const domains = "curtiz.com.br,sistemas-curtiz.workers.dev";
    expect(configuredCookieDomains(domains)).toEqual([
      "curtiz.com.br",
      "sistemas-curtiz.workers.dev"
    ]);
    expect(sharedCookieOptions({ httpOnly: true }, "painel.curtiz.com.br", domains)).toEqual({
      httpOnly: true,
      domain: ".curtiz.com.br"
    });
    expect(
      sharedCookieOptions(
        { httpOnly: true },
        "curtiz-panel.sistemas-curtiz.workers.dev",
        domains
      )
    ).toEqual({
      httpOnly: true,
      domain: ".sistemas-curtiz.workers.dev"
    });
  });

  it("não aplica Domain quando o host não corresponde", () => {
    expect(sharedCookieOptions({ httpOnly: true }, "store.example.com", "example.com")).toEqual({
      httpOnly: true,
      domain: ".example.com"
    });
    expect(sharedCookieOptions({ httpOnly: true }, "attacker.test", "example.com")).toEqual({
      httpOnly: true
    });
  });

  it("preserva as opções de segurança e expiração da sessão", () => {
    expect(
      sharedCookieOptions(
        { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 3600 },
        "panel.example.com:443",
        ".example.com"
      )
    ).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 3600,
      domain: ".example.com"
    });
  });
});

import { describe, expect, it } from "vitest";
import { consentSigningKey, createConsentToken, verifyConsentToken } from "./consent-token";
import { consentMaxAgeMs, cookiePolicyVersion } from "./cookie-inventory";

const key = "k".repeat(40);
const now = Date.parse("2026-10-12T12:00:00Z");
const consent = {
  id: "11111111-1111-4111-8111-111111111111",
  policyVersion: cookiePolicyVersion(null),
  categories: { essential: true as const, preferences: true, analytics: false, marketing: false }
};

describe("token assinado de consentimento", () => {
  it("comprova categorias, versão e data da escolha", () => {
    const token = createConsentToken(consent, key, now);
    expect(verifyConsentToken(token, key, now)).toEqual({ ...consent, issuedAt: now });
  });

  it("não aceita valor editado no navegador, outra chave ou o JSON legado", () => {
    const token = createConsentToken(consent, key, now) ?? "";
    const signature = token.split(".")[1];
    // Mesmo formato, com todas as categorias ligadas, reaproveitando a assinatura original.
    const forged = Buffer.from(JSON.stringify({ id: consent.id, v: consent.policyVersion, c: "111", t: now }))
      .toString("base64url");
    expect(verifyConsentToken(`${forged}.${signature}`, key, now)).toBeNull();
    expect(verifyConsentToken(token, "x".repeat(40), now)).toBeNull();
    expect(verifyConsentToken(`${token}.extra`, key, now)).toBeNull();
    expect(verifyConsentToken(JSON.stringify({ essential: true, analytics: true }), key, now)).toBeNull();
    expect(verifyConsentToken("", key, now)).toBeNull();
  });

  it("expira em 12 meses e recusa data futura", () => {
    const token = createConsentToken(consent, key, now);
    expect(verifyConsentToken(token, key, now + consentMaxAgeMs - 1000)).not.toBeNull();
    expect(verifyConsentToken(token, key, now + consentMaxAgeMs + 1000)).toBeNull();
    expect(verifyConsentToken(createConsentToken(consent, key, now + 60 * 60 * 1000), key, now)).toBeNull();
  });

  it("deixa de valer quando o inventário muda de versão", () => {
    const stale = createConsentToken({ ...consent, policyVersion: "cookies-draft-inventory-2" }, key, now);
    expect(verifyConsentToken(stale, key, now)).toBeNull();
  });

  it("não assina sem chave adequada nem com dados inválidos", () => {
    expect(createConsentToken(consent, null, now)).toBeNull();
    expect(createConsentToken({ ...consent, id: "not-a-uuid" }, key, now)).toBeNull();
    expect(createConsentToken({ ...consent, policyVersion: "<script>" }, key, now)).toBeNull();
    expect(verifyConsentToken(createConsentToken(consent, key, now), null, now)).toBeNull();
  });

  it("usa a chave dedicada, depois a de rate limit, e só aceita segredo de demonstração fora de produção", () => {
    expect(consentSigningKey({ COOKIE_CONSENT_HMAC_KEY: key, RATE_LIMIT_HMAC_KEY: "r".repeat(40) })).toBe(key);
    expect(consentSigningKey({ RATE_LIMIT_HMAC_KEY: "r".repeat(40) })).toBe("r".repeat(40));
    expect(consentSigningKey({ APP_ENV: "production", DEMO_SESSION_SECRET: "d".repeat(40) })).toBeNull();
    expect(consentSigningKey({ APP_ENV: "development", DEMO_SESSION_SECRET: "d".repeat(40) })).toBe("d".repeat(40));
    expect(consentSigningKey({ RATE_LIMIT_HMAC_KEY: "short" })).toBeNull();
  });
});

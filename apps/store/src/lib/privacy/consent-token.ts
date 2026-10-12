import { createHmac, timingSafeEqual } from "node:crypto";
import { consentMaxAgeMs, isCurrentInventoryVersion } from "./cookie-inventory";

/**
 * Cookie httpOnly com a escolha do visitante assinada pelo servidor. O servidor só reconhece
 * categorias opcionais com assinatura válida, dentro de 12 meses e da versão atual do inventário;
 * valores editados no navegador ou o formato JSON legado valem como "sem consentimento".
 */
export const CONSENT_COOKIE = "curtiz-cookie-preferences";
export const CONSENT_COOKIE_MAX_AGE_SECONDS = Math.floor(consentMaxAgeMs / 1000);

export type ConsentCategories = {
  essential: true;
  preferences: boolean;
  analytics: boolean;
  marketing: boolean;
};

export type ConsentToken = {
  id: string;
  policyVersion: string;
  categories: ConsentCategories;
  issuedAt: number;
};

type Environment = Readonly<Record<string, string | undefined>>;

const domain = "curtiz:cookie-consent:v1:";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export const policyVersionPattern = /^[a-z0-9][a-z0-9.-]{0,59}$/u;
const clockSkewMs = 5 * 60 * 1000;

/**
 * Chave dedicada opcional; senão a chave HMAC de rate limit já exigida em produção, sempre com
 * separação de domínio. O segredo de demonstração só é aceito fora de produção.
 */
export function consentSigningKey(environment: Environment = process.env): string | null {
  const key = environment.COOKIE_CONSENT_HMAC_KEY?.trim()
    || environment.RATE_LIMIT_HMAC_KEY?.trim()
    || (environment.APP_ENV === "production" ? "" : environment.DEMO_SESSION_SECRET?.trim() ?? "");
  return key && key.length >= 32 ? key : null;
}

const sign = (payload: string, key: string) =>
  createHmac("sha256", key).update(domain + payload).digest();

export function createConsentToken(
  consent: Omit<ConsentToken, "issuedAt">,
  key: string | null,
  now = Date.now()
): string | null {
  if (!key || !uuidPattern.test(consent.id) || !policyVersionPattern.test(consent.policyVersion)) return null;
  const { preferences, analytics, marketing } = consent.categories;
  const payload = Buffer.from(JSON.stringify({
    id: consent.id, v: consent.policyVersion, c: [preferences, analytics, marketing].map(Number).join(""), t: now
  })).toString("base64url");
  return `${payload}.${sign(payload, key).toString("base64url")}`;
}

export function verifyConsentToken(
  token: string | null | undefined,
  key: string | null,
  now = Date.now()
): ConsentToken | null {
  if (!token || !key) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const expected = sign(payload, key);
  const received = Buffer.from(signature, "base64url");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const value = parsed as Record<string, unknown>;
    if (typeof value.id !== "string" || !uuidPattern.test(value.id)
      || typeof value.v !== "string" || !policyVersionPattern.test(value.v) || !isCurrentInventoryVersion(value.v)
      || typeof value.c !== "string" || !/^[01]{3}$/u.test(value.c)
      || typeof value.t !== "number" || !Number.isFinite(value.t)
      || value.t > now + clockSkewMs || now - value.t > consentMaxAgeMs) return null;
    return {
      id: value.id,
      policyVersion: value.v,
      categories: { essential: true, preferences: value.c[0] === "1", analytics: value.c[1] === "1", marketing: value.c[2] === "1" },
      issuedAt: value.t
    };
  } catch {
    return null;
  }
}

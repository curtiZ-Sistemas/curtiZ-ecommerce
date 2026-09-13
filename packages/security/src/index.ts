import { randomUUID } from "node:crypto";

export {
  DEMO_SESSION_COOKIE,
  authenticateDemoAccount,
  createDemoSession,
  demoDestination,
  isLocalDemoRequest,
  verifyDemoSession
} from "./demo-auth";
export type { DemoAccount, DemoRole, DemoSession } from "./demo-auth";
export {
  AUTH_PERSISTENCE_COOKIE,
  applyAuthCookiePersistence,
  readAuthPersistence
} from "./auth-persistence";
export type { AuthPersistence } from "./auth-persistence";
export { cookieDomainMatchesHost, normalizeCookieDomain, sharedCookieOptions } from "./auth-cookie";
export { buildNonceContentSecurityPolicy } from "./content-security-policy";
export type { ContentSecurityPolicyOptions } from "./content-security-policy";
export { postgresUuidSchema } from "./postgres-uuid";
export {
  REFERRAL_ATTRIBUTION_COOKIE,
  createReferralAttribution,
  verifyReferralAttribution
} from "./referral-attribution";

const sensitiveKeys =
  /password|token|authorization|cookie|secret|apikey|servicerole|credential|privatekey|encryption|document|cpf|card|cvv|cvc|securitycode|pix|qrcode|bankaccount|accountnumber|address|street|postalcode|email|phone|stack|message|cause|details|hint/i;
const unsafeProtocols = /^(javascript|data|vbscript):/i;

export const createRequestId = (): string => randomUUID();

export const redact = (value: unknown): unknown => {
  const seen = new WeakSet<object>();
  const visit = (item: unknown, depth: number): unknown => {
    if (depth > 12) return "[REDACTED]";
    if (item instanceof Error) return { name: "Error" };
    if (item && typeof item === "object") {
      if (seen.has(item)) return "[REDACTED]";
      seen.add(item);
      if (Array.isArray(item)) return item.slice(0, 100).map((entry) => visit(entry, depth + 1));
      return Object.fromEntries(Object.entries(item).slice(0, 100).map(([key, entry]) => [key,
        sensitiveKeys.test(key.replace(/[^a-z0-9]/giu, "")) ? "[REDACTED]" : visit(entry, depth + 1)
      ]));
    }
    if (typeof item === "string") return item
      .replace(/\b(?:Bearer\s+\S+|sb_secret_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/giu, "[REDACTED]")
      .replace(/https?:\/\/[^\s]+/giu, "[URL REDACTED]")
      .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/gu, "[REDACTED]")
      .slice(0, 1000);
    return item;
  };
  return visit(value, 0);
};

export const logServerEvent = (level: "info" | "warn" | "error", event: string, context: unknown): void => {
  console[level](/^[a-z0-9_.-]{1,80}$/u.test(event) ? event : "application_event", redact(context));
};

export const sanitizePlainText = (value: string, maximum = 4_000): string =>
  value
    .replace(/<[^>]*>/g, "")
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, "[DADO FINANCEIRO REMOVIDO]")
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[CPF REMOVIDO]")
    .slice(0, maximum)
    .trim();

export const safeInternalPath = (value: string | null | undefined, fallback = "/"): string => {
  if (!value || !value.startsWith("/") || value.startsWith("//") || unsafeProtocols.test(value)) {
    return fallback;
  }
  return value;
};

export const assertAllowedOrigin = (request: Request, allowedOrigins: string[]): void => {
  const origin = request.headers.get("origin");
  if (origin && !allowedOrigins.includes(origin)) throw new Error("Origem não permitida.");
};

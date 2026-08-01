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
  cookieDomainMatchesHost,
  normalizeCookieDomain,
  sharedCookieOptions
} from "./auth-cookie";
export { buildNonceContentSecurityPolicy } from "./content-security-policy";
export type { ContentSecurityPolicyOptions } from "./content-security-policy";

const sensitiveKeys =
  /password|token|authorization|cookie|access_token|refresh_token|card|cvv|cpf/i;
const unsafeProtocols = /^(javascript|data|vbscript):/i;

export const createRequestId = (): string => randomUUID();

export const redact = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        sensitiveKeys.test(key) ? "[REDACTED]" : redact(item)
      ])
    );
  }
  return value;
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

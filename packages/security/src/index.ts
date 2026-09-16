import { randomUUID } from "node:crypto";
export { safeInternalPath } from "./safe-path";
export { reencodeUploadImage } from "./image-upload";
export type { UploadImageBinding } from "./image-upload";
export { scanAttachment } from "./attachment-scanner";
export type { AttachmentScanner, AttachmentScanStatus } from "./attachment-scanner";

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

export class RequestBodyError extends Error {
  constructor(public readonly status: number) {
    super("request_body_rejected");
  }
}

/** Reads the stream with an effective cap, including when Content-Length is absent or forged. */
export async function readBoundedBody(request: Request, maximumBytes: number): Promise<Uint8Array> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) throw new RequestBodyError(400);
    if (parsedLength > maximumBytes) throw new RequestBodyError(413);
  }
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumBytes) {
        await reader.cancel();
        throw new RequestBodyError(413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function readBoundedJson(request: Request, maximumBytes = 16_384): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    throw new RequestBodyError(415);
  }
  const bytes = await readBoundedBody(request, maximumBytes);
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new RequestBodyError(400);
  }
}

export async function readJsonResponse(request: Request, maximumBytes = 16_384): Promise<unknown> {
  try {
    return await readBoundedJson(request, maximumBytes);
  } catch (error) {
    const status = error instanceof RequestBodyError ? error.status : 400;
    return Response.json({ message: status === 413 ? "A requisição excede o limite permitido." : "Corpo JSON inválido." },
      { status, headers: { "cache-control": "private, no-store" } });
  }
}

export async function readFormResponse(request: Request, maximumBytes: number): Promise<FormData | Response> {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data;")) throw new RequestBodyError(415);
    const bytes = await readBoundedBody(request, maximumBytes);
    return await new Response(bytes as BodyInit, { headers: { "content-type": contentType } }).formData();
  } catch (error) {
    return Response.json({ message: "Arquivo inválido ou acima do limite permitido." }, {
      status: error instanceof RequestBodyError ? error.status : 400,
      headers: { "cache-control": "private, no-store" }
    });
  }
}

export function isAllowedBrowserRequest(request: Request, allowedOrigins: ReadonlySet<string>): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (origin) return origin === new URL(request.url).origin || allowedOrigins.has(origin);
  return ["GET", "HEAD", "OPTIONS"].includes(request.method)
    || request.headers.get("sec-fetch-site") === "same-origin";
}

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
      .replace(/\b(?:Bearer\s+\S+|(?:sb_secret|sk|pk|rk)_[A-Za-z0-9_-]{8,}|(?:gh[oprsu]|github_pat)_[A-Za-z0-9_]{10,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/giu, "[REDACTED]")
      .replace(/\b(?:api[_-]?key|secret|token|password|authorization)\s*[:=]\s*[^\s,;]+/giu, "[REDACTED]")
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

export const assertAllowedOrigin = (request: Request, allowedOrigins: string[]): void => {
  const origin = request.headers.get("origin");
  if (origin && !allowedOrigins.includes(origin)) throw new Error("Origem não permitida.");
};

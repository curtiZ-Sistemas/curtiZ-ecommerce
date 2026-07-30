import { createHmac, timingSafeEqual } from "node:crypto";

export const DEMO_SESSION_COOKIE = "curtiz-demo-session";

export type DemoRole = "customer" | "operational" | "admin" | "manager" | "technical";

export type DemoAccount = {
  email: string;
  fullName: string;
  role: DemoRole;
};

export type DemoSession = DemoAccount & {
  expiresAt: number;
};

const demoAccounts: readonly DemoAccount[] = [
  { email: "cliente.demo@curtiz.local", fullName: "Cliente Demo", role: "customer" },
  {
    email: "operacional.demo@curtiz.local",
    fullName: "Operacional Demo",
    role: "operational"
  },
  { email: "admin.demo@curtiz.local", fullName: "Administrador Demo", role: "admin" },
  { email: "gerencia.demo@curtiz.local", fullName: "Gerência Demo", role: "manager" },
  { email: "tecnico.demo@curtiz.local", fullName: "Técnico Demo", role: "technical" }
];

const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const safeEqual = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};

const sessionSecret = (): string | null => {
  const secret = process.env.DEMO_SESSION_SECRET?.trim();
  return secret && secret.length >= 32 ? secret : null;
};

const signatureFor = (payload: string, secret: string): string =>
  createHmac("sha256", secret).update(payload).digest("base64url");

export const isLocalDemoRequest = (request: Request): boolean => {
  if (process.env.DEMO_MODE !== "true") return false;

  try {
    return localHosts.has(new URL(request.url).hostname);
  } catch {
    return false;
  }
};

export const authenticateDemoAccount = (email: string, password: string): DemoAccount | null => {
  const configuredPassword = process.env.DEMO_USERS_PASSWORD;
  if (!configuredPassword || !safeEqual(password, configuredPassword)) return null;

  return demoAccounts.find((account) => account.email === normalizeEmail(email)) ?? null;
};

export const createDemoSession = (
  account: DemoAccount,
  remember: boolean,
  now = Date.now()
): { value: string; maxAge?: number } | null => {
  const secret = sessionSecret();
  if (!secret) return null;

  const maxAge = remember ? 60 * 60 * 24 * 7 : 60 * 60 * 8;
  const session: DemoSession = {
    ...account,
    expiresAt: now + maxAge * 1000
  };
  const payload = Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  const value = `${payload}.${signatureFor(payload, secret)}`;
  return remember ? { value, maxAge } : { value };
};

export const verifyDemoSession = (
  value: string | null | undefined,
  now = Date.now()
): DemoSession | null => {
  const secret = sessionSecret();
  if (!value || !secret) return null;

  const [payload, providedSignature, extra] = value.split(".");
  if (!payload || !providedSignature || extra) return null;
  if (!safeEqual(providedSignature, signatureFor(payload, secret))) return null;

  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    const candidate = parsed as Partial<DemoSession>;
    const account = demoAccounts.find(
      (item) =>
        item.email === candidate.email &&
        item.fullName === candidate.fullName &&
        item.role === candidate.role
    );
    if (!account || typeof candidate.expiresAt !== "number" || candidate.expiresAt <= now) {
      return null;
    }
    return { ...account, expiresAt: candidate.expiresAt };
  } catch {
    return null;
  }
};

export const demoDestination = (role: DemoRole): string => {
  const destinations: Record<DemoRole, string> = {
    customer: "/minha-conta",
    operational: "/operacional",
    admin: "/administracao",
    manager: "/gerencia",
    technical: "/tecnico"
  };
  return destinations[role];
};

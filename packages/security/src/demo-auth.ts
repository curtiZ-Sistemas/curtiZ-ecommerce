import { createHmac, timingSafeEqual } from "node:crypto";

export const DEMO_SESSION_COOKIE = "curtiz-demo-session";

export type DemoRole =
  "customer" | "representative" | "operational" | "admin" | "manager" | "technical";

export type DemoAccount = {
  email: string;
  fullName: string;
  role: DemoRole;
  roles: readonly DemoRole[];
};

export type DemoSession = DemoAccount & {
  expiresAt: number;
};

const demoAccounts: readonly DemoAccount[] = [
  {
    email: "cliente.demo@curtiz.local",
    fullName: "Cliente Demo",
    role: "customer",
    roles: ["customer"]
  },
  {
    email: "representante.demo@curtiz.local",
    fullName: "Representante Demo",
    role: "representative",
    roles: ["customer", "representative"]
  },
  {
    email: "operacional.demo@curtiz.local",
    fullName: "Operacional Demo",
    role: "operational",
    roles: ["operational"]
  },
  {
    email: "admin.demo@curtiz.local",
    fullName: "Administrador Demo",
    role: "admin",
    roles: ["admin"]
  },
  {
    email: "gerencia.demo@curtiz.local",
    fullName: "Gerência Demo",
    role: "manager",
    roles: ["manager"]
  },
  {
    email: "tecnico.demo@curtiz.local",
    fullName: "Técnico Demo",
    role: "technical",
    roles: ["technical"]
  }
];

const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);

const configuredStagingHosts = (): Set<string> => {
  const configured = [
    ...(process.env.STAGING_DEMO_HOSTS ?? "").split(","),
    process.env.NEXT_PUBLIC_STORE_URL,
    process.env.NEXT_PUBLIC_PANEL_URL
  ];
  const hosts = new Set<string>();
  for (const value of configured) {
    if (!value?.trim()) continue;
    try {
      hosts.add(value.includes("://") ? new URL(value).hostname : value.trim().toLowerCase());
    } catch {
      // O validador de ambiente rejeita valores inválidos antes do deploy.
    }
  }
  return hosts;
};

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
  const explicitDemo = process.env.DEMO_MODE === "true";
  if (!explicitDemo) return false;

  try {
    const url = new URL(request.url);
    if (localHosts.has(url.hostname)) return true;
    return (
      process.env.APP_ENV === "staging" &&
      url.protocol === "https:" &&
      configuredStagingHosts().has(url.hostname)
    );
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
        item.role === candidate.role &&
        Array.isArray(candidate.roles) &&
        item.roles.length === candidate.roles.length &&
        item.roles.every((role, index) => role === candidate.roles?.[index])
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
    representative: "/representante",
    operational: "/operacional",
    admin: "/administracao",
    manager: "/gerencia",
    technical: "/tecnico"
  };
  return destinations[role];
};

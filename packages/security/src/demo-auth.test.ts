import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  authenticateDemoAccount,
  createDemoSession,
  isLocalDemoRequest,
  verifyDemoSession
} from "./demo-auth";

const previousEnvironment = {
  demoMode: process.env.DEMO_MODE,
  password: process.env.DEMO_USERS_PASSWORD,
  sessionSecret: process.env.DEMO_SESSION_SECRET
};

beforeEach(() => {
  process.env.DEMO_MODE = "true";
  process.env.DEMO_USERS_PASSWORD = "1234567890";
  process.env.DEMO_SESSION_SECRET = "test-only-demo-session-secret-with-adequate-length";
});

afterEach(() => {
  process.env.DEMO_MODE = previousEnvironment.demoMode;
  process.env.DEMO_USERS_PASSWORD = previousEnvironment.password;
  process.env.DEMO_SESSION_SECRET = previousEnvironment.sessionSecret;
});

describe("autenticação demo local", () => {
  it("aceita uma conta conhecida e cria uma sessão verificável", () => {
    const account = authenticateDemoAccount("OPERACIONAL.DEMO@CURTIZ.LOCAL", "1234567890");
    expect(account?.role).toBe("operational");

    const session = account ? createDemoSession(account, false, 1_000) : null;
    expect(session).not.toBeNull();
    expect(verifyDemoSession(session?.value, 2_000)?.email).toBe("operacional.demo@curtiz.local");
  });

  it("rejeita senha, assinatura e endereço público inválidos", () => {
    expect(authenticateDemoAccount("operacional.demo@curtiz.local", "senha-incorreta")).toBeNull();
    expect(verifyDemoSession("payload.assinatura")).toBeNull();
    expect(isLocalDemoRequest(new Request("https://loja.example/login"))).toBe(false);
  });

  it("só habilita o fallback em loopback com DEMO_MODE explícito", () => {
    expect(isLocalDemoRequest(new Request("http://localhost:3000/login"))).toBe(true);
    process.env.DEMO_MODE = "false";
    expect(isLocalDemoRequest(new Request("http://localhost:3000/login"))).toBe(false);
  });
});

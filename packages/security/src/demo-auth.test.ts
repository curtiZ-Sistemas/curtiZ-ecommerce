import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  authenticateDemoAccount,
  createDemoSession,
  isLocalDemoRequest,
  verifyDemoSession
} from "./demo-auth";

const previousEnvironment = {
  appEnvironment: process.env.APP_ENV,
  demoMode: process.env.DEMO_MODE,
  checkoutEnabled: process.env.CHECKOUT_ENABLED,
  storeUrl: process.env.NEXT_PUBLIC_STORE_URL,
  panelUrl: process.env.NEXT_PUBLIC_PANEL_URL,
  password: process.env.DEMO_USERS_PASSWORD,
  sessionSecret: process.env.DEMO_SESSION_SECRET
};

beforeEach(() => {
  process.env.DEMO_MODE = "true";
  process.env.DEMO_USERS_PASSWORD = "1234567890";
  process.env.DEMO_SESSION_SECRET = "test-only-demo-session-secret-with-adequate-length";
});

afterEach(() => {
  process.env.APP_ENV = previousEnvironment.appEnvironment;
  process.env.DEMO_MODE = previousEnvironment.demoMode;
  process.env.CHECKOUT_ENABLED = previousEnvironment.checkoutEnabled;
  process.env.NEXT_PUBLIC_STORE_URL = previousEnvironment.storeUrl;
  process.env.NEXT_PUBLIC_PANEL_URL = previousEnvironment.panelUrl;
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

  it("habilita loopback somente com modo demo explícito", () => {
    expect(isLocalDemoRequest(new Request("http://localhost:3000/login"))).toBe(true);
    process.env.DEMO_MODE = "false";
    expect(isLocalDemoRequest(new Request("http://localhost:3000/login"))).toBe(false);
  });

  it("permite somente hosts HTTPS explicitamente configurados em staging", () => {
    process.env.APP_ENV = "staging";
    process.env.NEXT_PUBLIC_PANEL_URL = "https://painel.staging.example.com";
    expect(isLocalDemoRequest(new Request("https://painel.staging.example.com/login"))).toBe(true);
    expect(isLocalDemoRequest(new Request("http://painel.staging.example.com/login"))).toBe(false);
    expect(isLocalDemoRequest(new Request("https://host-invasor.example.com/login"))).toBe(false);
  });

  it("não usa credenciais demo configuradas como bypass em produção", () => {
    process.env.DEMO_MODE = "false";
    delete process.env.CHECKOUT_ENABLED;
    process.env.APP_ENV = "production";
    process.env.NEXT_PUBLIC_STORE_URL = "https://curtiz.example.com";

    expect(
      isLocalDemoRequest(new Request("https://curtiz.example.com/api/auth/login"))
    ).toBe(false);
  });
});

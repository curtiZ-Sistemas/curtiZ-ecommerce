import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { cookieDomainMatchesHost } from "@curtiz/security/auth-cookie";

type StoredCookie = {
  name: string; value: string; domain?: string; httpOnly?: boolean; secure?: boolean;
  sameSite?: boolean | "lax" | "strict" | "none"; path?: string; maxAge?: number; expires?: Date | string | number;
};
const state = vi.hoisted(() => ({
  host: "curtiz.com.br", roles: ["admin"], cookies: [] as StoredCookie[],
  writes: [] as StoredCookie[], invalidCredentials: false,
  rateLimit: vi.fn(), turnstile: vi.fn()
}));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: state.host }),
  cookies: async () => ({
    getAll: () => state.cookies,
    get: (name: string) => state.cookies.find(c => c.name === name),
    set: (cookie: StoredCookie) => {
      state.cookies = [...state.cookies.filter(c => c.name !== cookie.name), cookie];
      state.writes.push(cookie);
    }
  })
}));
vi.mock("@/lib/http-origin", () => import("./http-origin"));
vi.mock("@/lib/private-request", () => import("./private-request"));
vi.mock("@/lib/auth-routing", () => import("./auth-routing"));
vi.mock("@/lib/supabase/server", () => import("./supabase/server"));
vi.mock("@/lib/unknown-data", () => import("./unknown-data"));
vi.mock("@/lib/signup-validation", () => import("./signup-validation"));
vi.mock("@/lib/auth-rate-limit", () => ({ enforceAuthRateLimit: state.rateLimit }));
vi.mock("@/lib/turnstile", () => ({ verifyTurnstile: state.turnstile }));

import { POST } from "../app/api/auth/[mode]/route";
import { createServerSupabaseClient as panelClient } from "../../../panel/src/lib/supabase/server";

const testUser = { id: "00000000-0000-4000-8000-000000000001", email: "admin@example.invalid", user_metadata: {} };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json", "x-supabase-api-version": "2024-01-01" }
});

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("APP_ENV", "production");
  vi.stubEnv("DEMO_MODE", "false");
  vi.stubEnv("REQUIRE_INTERNAL_MFA", "false");
  vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "test-publishable-placeholder");
  vi.stubEnv("AUTH_COOKIE_DOMAINS", "curtiz.com.br,sistemas-curtiz.workers.dev");
  // Reproduce the values found inside the published Worker, despite correct Runtime URLs.
  vi.stubEnv("NEXT_PUBLIC_STORE_URL", "https://curtiz-ecommerce.sistemas-curtiz.workers.dev");
  vi.stubEnv("NEXT_PUBLIC_PANEL_URL", "https://curtiz-painel.sistemas-curtiz.workers.dev");
  vi.stubEnv("NEXT_PUBLIC_STORE_TEST_URL", "https://curtiz-ecommerce.sistemas-curtiz.workers.dev");
  vi.stubEnv("NEXT_PUBLIC_PANEL_TEST_URL", "https://curtiz-painel.sistemas-curtiz.workers.dev");
  vi.stubEnv("ALLOWED_ORIGINS", "https://curtiz.com.br,https://painel.curtiz.com.br");
  state.host = "curtiz.com.br";
  state.roles = ["admin"];
  state.cookies = [];
  state.writes = [];
  state.invalidCredentials = false;
  state.rateLimit.mockReset().mockResolvedValue({ status: "allowed" });
  state.turnstile.mockReset().mockResolvedValue(true);
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input.toString() : input.url);
    if (url.pathname === "/auth/v1/token") {
      if (state.invalidCredentials) return json({ code: "invalid_credentials", message: "Invalid login credentials" }, 400);
      const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
      const accessToken = [encode({ alg: "HS256", typ: "JWT" }), encode({
        sub: testUser.id, exp: Math.floor(Date.now() / 1000) + 3600, aal: "aal2"
      }), "test-signature"].join(".");
      return json({ access_token: accessToken, refresh_token: "test-refresh-placeholder", token_type: "bearer", expires_in: 3600, user: testUser });
    }
    if (url.pathname === "/auth/v1/user") return json(testUser);
    if (url.pathname === "/rest/v1/profiles") return json({ status: "active" });
    if (url.pathname === "/rest/v1/user_roles") return json(state.roles.map(role => ({ role })));
    if (url.pathname === "/rest/v1/rpc/log_internal_auth_event") return json(null);
    throw new Error(`Unexpected test request: ${url.pathname}`);
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function login(remember = false, origin = `https://${state.host}`, next?: string) {
  return POST(new NextRequest(`${origin}/api/auth/login`, {
    method: "POST", headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ email: testUser.email, password: "test-password", ...(remember ? { remember: "on" } : {}), ...(next ? { next } : {}) })
  }), { params: Promise.resolve({ mode: "login" }) });
}

describe("login e sessão entre loja e painel", () => {
  it.each([
    [["admin"], "/administracao"], [["manager"], "/gerencia"],
    [["technical"], "/tecnico"], [["operational"], "/operacional"],
    [["admin", "manager"], "/selecionar-painel"], [["admin", "technical"], "/selecionar-painel"]
  ])("envia %j exclusivamente ao painel oficial", async (roles, destination) => {
    state.roles = roles;
    const response = await login();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ redirectTo: `https://painel.curtiz.com.br${destination}` });
    expect(state.rateLimit).toHaveBeenCalledOnce();
    expect(state.turnstile).toHaveBeenCalledOnce();
  });
  it.each(["customer", "representative"])("mantém %s na loja", async role => {
    state.roles = [role];
    expect(await (await login()).json()).toMatchObject({ redirectTo: "/minha-conta" });
  });
  it.each([false, true])("persiste sessão no painel com lembrar acesso %s", async remember => {
    const response = await login(remember);
    const sessionCookies = state.writes.filter(c => c.name.startsWith("sb-"));
    expect(sessionCookies.length).toBeGreaterThan(0);
    for (const cookie of sessionCookies) {
      expect(cookie).toMatchObject({ domain: ".curtiz.com.br", httpOnly: true, secure: true, sameSite: "lax", path: "/" });
      if (remember) expect(cookie.maxAge).toBeGreaterThan(0);
      else { expect(cookie.maxAge).toBeUndefined(); expect(cookie.expires).toBeUndefined(); }
    }
    expect(response.cookies.get("curtiz-auth-persistence")).toMatchObject({
      domain: ".curtiz.com.br", value: remember ? "persistent" : "session"
    });
    state.host = "painel.curtiz.com.br";
    state.cookies = [...sessionCookies, response.cookies.get("curtiz-auth-persistence")!];
    const client = await panelClient();
    expect((await client!.auth.getUser()).data.user?.id).toBe(testUser.id);
  });
  it("mantém o par workers.dev e seus cookies separados da produção", async () => {
    state.host = "curtiz-ecommerce.sistemas-curtiz.workers.dev";
    const response = await login();
    expect(await response.json()).toMatchObject({ redirectTo: "https://curtiz-painel.sistemas-curtiz.workers.dev/administracao" });
    const sessionCookies = state.writes.filter(c => c.name.startsWith("sb-"));
    expect(sessionCookies.length).toBeGreaterThan(0);
    for (const cookie of sessionCookies) {
      expect(cookie.domain).toBe(".sistemas-curtiz.workers.dev");
      expect(cookieDomainMatchesHost(cookie.domain!.slice(1), "painel.curtiz.com.br")).toBe(false);
    }
    expect(cookieDomainMatchesHost("curtiz.com.br", state.host)).toBe(false);
  });
  it("rejeita credenciais inválidas com mensagem e sem sessão", async () => {
    state.invalidCredentials = true;
    const response = await login();
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ message: "E-mail ou senha inválidos." });
    expect(state.writes).toEqual([]);
  });
  it("não permite origem externa nem destino arbitrário", async () => {
    const forbidden = await POST(new NextRequest("https://curtiz.com.br/api/auth/login", {
      method: "POST", headers: { origin: "https://attacker.invalid", "content-type": "application/json" },
      body: JSON.stringify({ email: testUser.email, password: "test-password" })
    }), { params: Promise.resolve({ mode: "login" }) });
    expect(forbidden.status).toBe(403);
    expect(state.writes).toEqual([]);
    expect(await (await login(false, "https://curtiz.com.br", "https://attacker.invalid")).json())
      .toMatchObject({ redirectTo: "https://painel.curtiz.com.br/administracao" });
  });
  it("preserva bloqueio por rate limit", async () => {
    state.rateLimit.mockResolvedValue({ status: "blocked", retryAfterSeconds: 900 });
    const response = await login();
    expect(response.status).toBe(429);
    expect(state.writes).toEqual([]);
  });
  it("preserva a verificação Turnstile", async () => {
    state.turnstile.mockResolvedValue(false);
    expect((await login()).status).toBe(403);
    expect(state.writes).toEqual([]);
  });
});

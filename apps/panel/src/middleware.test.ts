import { NextRequest } from "next/server";
import type { CookieOptions } from "@supabase/ssr";
import { afterEach, describe, expect, it, vi } from "vitest";
import { config, middleware } from "./middleware";

type CookieHooks = { setAll(cookies: Array<{ name: string; value: string; options: CookieOptions }>): void };
const state = vi.hoisted(() => ({ getUser: vi.fn(), hooks: null as CookieHooks | null }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, options: { cookies: CookieHooks }) => {
    state.hooks = options.cookies;
    return { auth: { getUser: state.getUser } };
  }
}));

vi.mock("@/lib/public-media", () => ({
  publicCatalogMediaOrigins: () => [],
  publicCatalogUploadSource: (url?: string) => url ? `${new URL(url).origin}/storage/v1/object/upload/sign/catalog-public/products/` : null
}));

describe("panel security headers", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

  it.each(["session", "persistent"])("encaminha a sessão %s renovada ao render e ao navegador", async persistence => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_MODE", "false");
    vi.stubEnv("AUTH_COOKIE_DOMAINS", "curtiz.com.br");
    vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "publishable-key-with-safe-length");
    state.getUser.mockImplementationOnce(async () => {
      state.hooks?.setAll([{ name: "sb-project-auth-token", value: "renewed", options: { maxAge: 3600 } }]);
      return { data: { user: { id: "test-user" } }, error: null };
    });
    const response = await middleware(new NextRequest("https://painel.curtiz.com.br/administracao", {
      headers: { cookie: `sb-project-auth-token=expired; curtiz-auth-persistence=${persistence}` }
    }));
    expect(response.headers.get("x-middleware-request-cookie")).toContain("sb-project-auth-token=renewed");
    const cookie = response.cookies.get("sb-project-auth-token");
    expect(cookie).toMatchObject({ value: "renewed", domain: ".curtiz.com.br", secure: true });
    expect(cookie?.maxAge).toBe(persistence === "persistent" ? 3600 : undefined);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("protege conteúdo, recursos do navegador e enquadramento em produção", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "");

    const response = await middleware(new NextRequest("https://painel.example/administrativo"));

    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp.split("; ").find((value) => value.startsWith("connect-src "))).not.toContain("supabase");
    expect(csp).not.toContain("unsafe-eval");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("permissions-policy")).toContain("camera=()");
    expect(response.headers.get("strict-transport-security")).toContain("max-age=31536000");
  });

  it("não duplica autenticação nas APIs que autorizam a própria requisição", () => {
    expect(config.matcher[0]).toContain("?!api|");
  });

  it("permite apenas upload assinado de vídeo no Storage do projeto configurado", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "");
    const result = await middleware(new NextRequest("https://painel.example/administracao"));
    const connect = result.headers.get("content-security-policy")?.split("; ").find((value) => value.startsWith("connect-src ")) ?? "";
    expect(connect).toContain("https://project.supabase.co/storage/v1/object/upload/sign/catalog-public/products/");
    expect(connect.split(" ")).not.toContain("https://project.supabase.co");
    expect(connect).not.toContain("wss:");
    expect(connect).not.toContain("*.supabase.co");
  });
});

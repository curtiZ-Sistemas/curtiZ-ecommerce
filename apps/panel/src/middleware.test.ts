import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { config, middleware } from "./middleware";

vi.mock("@/lib/public-media", () => ({
  publicCatalogMediaOrigins: () => [],
  publicCatalogUploadSource: (url?: string) => url ? `${new URL(url).origin}/storage/v1/object/upload/sign/catalog-public/products/` : null
}));

describe("panel security headers", () => {
  afterEach(() => vi.unstubAllEnvs());

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

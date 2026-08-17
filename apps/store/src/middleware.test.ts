import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { middleware } from "./middleware";

const { getUser } = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser } })
}));

describe("store security headers", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("protege conteúdo, recursos do navegador e enquadramento em produção", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");

    const response = await middleware(new NextRequest("https://loja.example/ajuda"));

    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("permissions-policy")).toContain("camera=()");
    expect(response.headers.get("strict-transport-security")).toContain("max-age=31536000");
  });

  it("não consulta autenticação em páginas públicas conhecidas", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key-with-safe-length");

    await middleware(new NextRequest("https://loja.example/produtos"));

    expect(getUser).not.toHaveBeenCalled();
  });
});

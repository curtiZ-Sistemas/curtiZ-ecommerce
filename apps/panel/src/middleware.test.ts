import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { config, proxy } from "./proxy";

vi.mock("@/lib/public-media", () => ({
  publicCatalogMediaOrigins: () => []
}));

describe("panel security headers", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("protege conteúdo, recursos do navegador e enquadramento em produção", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");

    const response = await proxy(new NextRequest("https://painel.example/administrativo"));

    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("permissions-policy")).toContain("camera=()");
    expect(response.headers.get("strict-transport-security")).toContain("max-age=31536000");
  });

  it("não duplica autenticação nas APIs que autorizam a própria requisição", () => {
    expect(config.matcher[0]).toContain("?!api|");
  });
});

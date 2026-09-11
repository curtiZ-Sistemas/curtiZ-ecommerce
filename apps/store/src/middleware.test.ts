import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { middleware } from "./middleware";

const { getUser } = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser } })
}));

function readCspDirective(csp: string, name: string): string {
  return csp.split("; ").find((directive) => directive.startsWith(`${name} `)) ?? "";
}

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

  it("libera somente as origens usadas pelo Checkout Bricks na rota de checkout", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("MERCADO_PAGO_ENABLED", "");
    vi.stubEnv("CHECKOUT_ENABLED", "");

    const response = await middleware(new NextRequest("https://loja.example/checkout"));
    const csp = response.headers.get("content-security-policy") ?? "";
    const scriptSources = readCspDirective(csp, "script-src");
    const connectSources = readCspDirective(csp, "connect-src");
    const frameSources = readCspDirective(csp, "frame-src");
    const imageSources = readCspDirective(csp, "img-src");

    expect(scriptSources).toContain("https://sdk.mercadopago.com");
    expect(scriptSources).toContain("https://http2.mlstatic.com");
    expect(connectSources).toContain("https://api.mercadopago.com");
    expect(connectSources).toContain("https://api-static.mercadopago.com");
    expect(connectSources).toContain("https://api.mercadolibre.com");
    expect(connectSources).toContain("https://www.mercadolibre.com");
    expect(connectSources).toContain("https://http2.mlstatic.com");
    expect(frameSources).toContain("https://secure-fields.mercadopago.com");
    expect(frameSources).toContain("https://sdk.mercadopago.com");
    expect(imageSources).toContain("https://http2.mlstatic.com");
    expect(imageSources).toContain("https://www.mercadolibre.com");
    expect(imageSources).toContain("https://www.mercadolivre.com");
    expect(scriptSources).not.toContain("sha256-");
    expect(scriptSources).not.toContain("unsafe-eval");
    expect(scriptSources).not.toContain("unsafe-inline");
    expect(csp).not.toMatch(/(?:^|\s)\*(?:\s|;|$)/u);
  });

  it("não libera origens do Mercado Pago fora do checkout", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");

    const response = await middleware(new NextRequest("https://loja.example/produtos"));
    const csp = response.headers.get("content-security-policy") ?? "";

    expect(csp).not.toContain("mercadopago.com");
    expect(csp).not.toContain("mercadolibre.com");
    expect(csp).not.toContain("mlstatic.com");
  });

  it("libera o Brick somente na rota estrita de pagamento do pedido", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");

    const orderId = "11111111-1111-4111-8111-111111111111";
    const paymentResponse = await middleware(
      new NextRequest(`https://loja.example/pedido/${orderId}/pagamento`)
    );
    const paymentCsp = paymentResponse.headers.get("content-security-policy") ?? "";

    expect(readCspDirective(paymentCsp, "script-src")).toContain("https://sdk.mercadopago.com");
    expect(readCspDirective(paymentCsp, "connect-src")).toContain("https://api.mercadopago.com");
    expect(readCspDirective(paymentCsp, "frame-src")).toContain("https://secure-fields.mercadopago.com");
    expect(readCspDirective(paymentCsp, "img-src")).toContain("https://http2.mlstatic.com");
    expect(readCspDirective(paymentCsp, "style-src-elem")).toContain("'unsafe-inline'");

    for (const pathname of [
      "/pedido/qualquer/pagamento",
      `/pedido/${orderId}/pagamento/extra`,
      `/pedido/${orderId}/resumo`
    ]) {
      const response = await middleware(new NextRequest(`https://loja.example${pathname}`));
      expect(response.headers.get("content-security-policy")).not.toContain("mercadopago.com");
    }
  });

  it("impede indexação do alias workers.dev sem redirecionar o ambiente", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");

    const response = await middleware(
      new NextRequest("https://curtiz-ecommerce.sistemas-curtiz.workers.dev/produtos")
    );

    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");
    expect(response.headers.get("location")).toBeNull();
  });
});

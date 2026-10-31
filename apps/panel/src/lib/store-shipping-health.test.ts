import { describe, expect, it } from "vitest";
import { getStoreShippingService } from "./store-shipping-health";

describe("diagnóstico persistido do frete da loja", () => {
  it("distingue ausência de uma verificação do estado OAuth do painel", () => {
    expect(getStoreShippingService(null)).toMatchObject({
      name: "Frete da loja",
      state: "unavailable",
      detail: expect.stringContaining("A loja ainda não registrou uma verificação de cotação no runtime.") as unknown
    });
  });

  it("distingue falha de consulta de ausência de diagnóstico", () => {
    expect(getStoreShippingService(null, true)).toMatchObject({ state: "unavailable",
      detail: "Não foi possível consultar o diagnóstico da loja no Supabase." });
  });

  it("mostra a falha de criptografia e o HTTP real sem expor texto arbitrário", () => {
    const service = getStoreShippingService({ state: "offline", error_summary: "melhor_envio_authentication",
      metadata_sanitized: { reason: "token_decryption_failed", upstreamStatus: 403, databaseCode: "PGRST202" } });
    expect(service.detail).toContain("Não foi possível decifrar os tokens com as chaves configuradas");
    expect(service.detail).toContain("HTTP Melhor Envio 403");
    expect(service.detail).toContain("código do banco PGRST202");
    expect(getStoreShippingService({ state: "offline", metadata_sanitized: {
      reason: "sensitive detail", databaseCode: "select secret", upstreamStatus: 999
    } }).detail).not.toMatch(/sensitive|select secret|999/u);
  });

  it("mostra somente categoria e nomes de requisitos sanitizados", () => {
    const service = getStoreShippingService({
      state: "not_configured",
      error_summary: "melhor_envio_not_configured",
      checked_at: "2026-09-29T12:00:00.000Z",
      latency_ms: null,
      metadata_sanitized: {
        environment: "sandbox",
        missing: ["MELHOR_ENVIO_CLIENT_SECRET", "MELHOR_ENVIO_ORIGIN_ADDRESS", "endereço real"],
        invalid: ["MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY_INVALID", "11999999999"]
      }
    });
    expect(service).toMatchObject({
      name: "Frete da loja",
      state: "not_configured",
      detail: "Configuração do Melhor Envio incompleta na loja · Sandbox · ausente: MELHOR_ENVIO_CLIENT_SECRET, ausente: MELHOR_ENVIO_ORIGIN_ADDRESS, inválido: MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY_INVALID · última verificação 2026-09-29T12:00:00.000Z",
      checkedAt: "2026-09-29T12:00:00.000Z"
    });
    expect(JSON.stringify(service)).not.toContain("endereço real");
    expect(JSON.stringify(service)).not.toContain("11999999999");
  });

  it("mapeia categorias internas sem devolver mensagens de provedor", () => {
    expect(getStoreShippingService({
      state: "offline",
      error_summary: "melhor_envio_authentication",
      metadata_sanitized: { environment: "sandbox", missing: [], invalid: [] }
    })).toMatchObject({
      state: "offline",
      detail: "Autenticação do Melhor Envio falhou na loja (OAuth/token) · Sandbox"
    });
  });

  it.each([
    ["store_runtime_context_unavailable", "Runtime do Cloudflare indisponível na loja"],
    ["shipping_rate_limit_unavailable", "Limitador de requisições (RPC) indisponível na loja"],
    ["melhor_envio_configuration_invalid", "Configuração do Melhor Envio com valor inválido na loja"],
    ["shipping_quote_persistence_unavailable", "Cotação obtida, mas não foi gravada em shipping_quotes"],
    ["shipping_product_lookup_unavailable", "Consulta dos produtos do carrinho falhou na loja"]
  ])("distingue %s", (code, label) => {
    expect(getStoreShippingService({ state: "degraded", error_summary: code, metadata_sanitized: {} }).detail)
      .toContain(label);
  });

  it("mostra o código de suporte da última cotação somente no formato esperado", () => {
    expect(getStoreShippingService({
      state: "not_configured", error_summary: "shipping_provider_disabled",
      metadata_sanitized: { environment: "sandbox", supportCode: "FRT-1A2B3C4D" }
    }).detail).toBe("Frete desabilitado na configuração efetiva da loja · Sandbox · código FRT-1A2B3C4D");
    expect(getStoreShippingService({
      state: "degraded", error_summary: "melhor_envio_timeout",
      metadata_sanitized: { supportCode: "segredo qualquer" }
    }).detail).not.toContain("segredo");
  });
});

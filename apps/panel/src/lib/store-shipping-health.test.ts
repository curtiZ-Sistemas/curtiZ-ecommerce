import { describe, expect, it } from "vitest";
import { getStoreShippingService } from "./store-shipping-health";

describe("diagnóstico persistido do frete da loja", () => {
  it("distingue ausência de uma verificação do estado OAuth do painel", () => {
    expect(getStoreShippingService(null)).toMatchObject({
      name: "Frete da loja",
      state: "not_configured",
      detail: "A loja ainda não registrou uma verificação de cotação no runtime."
    });
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
      detail: "Autenticação do Melhor Envio falhou na loja · Sandbox"
    });
  });
});

import { describe, expect, it } from "vitest";
import {
  getIntegrationConfig,
  isMelhorEnvioSandboxReady,
  parseEnvironmentBoolean
} from "./integrations";

describe("configuração opcional de integrações", () => {
  it.each(["true", "1", "yes"])("aceita %s como verdadeiro", (value) => {
    expect(parseEnvironmentBoolean(value)).toBe(true);
  });

  it.each(["false", "0", "no"])("aceita %s como falso", (value) => {
    expect(parseEnvironmentBoolean(value, true)).toBe(false);
  });

  it("mantém tudo desativado quando as flags estão ausentes", () => {
    expect(getIntegrationConfig({})).toEqual({
      checkoutEnabled: false,
      payment: { provider: "disabled", enabled: false, mercadoPagoEnabled: false },
      shipping: { provider: "disabled", enabled: false, melhorEnvioEnabled: false },
      email: { provider: "disabled", enabled: false },
      whatsapp: { provider: "disabled", enabled: false },
      googleMerchant: { enabled: false },
      turnstile: { enabled: false },
      internalMfaRequired: false
    });
  });

  it("mantém o catálogo Google desligado sem liberação explícita", () => {
    expect(getIntegrationConfig({}).googleMerchant.enabled).toBe(false);
    expect(
      getIntegrationConfig({ GOOGLE_MERCHANT_ENABLED: "true" }).googleMerchant.enabled
    ).toBe(true);
  });

  it("não libera checkout com apenas um provider ativo", () => {
    expect(
      getIntegrationConfig({
        CHECKOUT_ENABLED: "true",
        PAYMENT_PROVIDER: "mercadopago",
        MERCADO_PAGO_ENABLED: "true",
        SHIPPING_PROVIDER: "disabled"
      }).checkoutEnabled
    ).toBe(false);
  });

  it("libera checkout com o frete fixo temporário", () => {
    expect(
      getIntegrationConfig({
        CHECKOUT_ENABLED: "true",
        PAYMENT_PROVIDER: "mercadopago",
        MERCADO_PAGO_ENABLED: "true",
        SHIPPING_PROVIDER: "fixed"
      })
    ).toMatchObject({
      checkoutEnabled: true,
      shipping: { provider: "fixed", enabled: true, melhorEnvioEnabled: false }
    });
  });

  it("mantém frete fixo quando o Sandbox solicitado ainda não está autorizado", () => {
    expect(
      getIntegrationConfig({
        PAYMENT_PROVIDER: "mercado_pago",
        SHIPPING_PROVIDER: "melhor_envio",
        MELHOR_ENVIO_ENABLED: "true"
      })
    ).toMatchObject({
      payment: { provider: "mercadopago", mercadoPagoEnabled: true },
      shipping: { provider: "fixed", enabled: true, melhorEnvioEnabled: false }
    });
  });

  it("aceita Melhor Envio somente com OAuth validado no Sandbox", () => {
    const environment = {
      SHIPPING_PROVIDER: "melhor_envio",
      MELHOR_ENVIO_ENABLED: "true",
      MELHOR_ENVIO_OAUTH_VALIDATED: "true",
      MELHOR_ENVIO_BASE_URL: "https://sandbox.melhorenvio.com.br",
      MELHOR_ENVIO_REDIRECT_URI: "https://store.example.com/api/shipping/melhor-envio/callback",
      MELHOR_ENVIO_CLIENT_ID: "client-id",
      MELHOR_ENVIO_CLIENT_SECRET: "client-secret",
      MELHOR_ENVIO_ACCESS_TOKEN: "sandbox-access-token",
      MELHOR_ENVIO_ACCESS_TOKEN_EXPIRES_AT: "2099-01-01T00:00:00.000Z"
    };
    expect(isMelhorEnvioSandboxReady(environment)).toBe(true);
    expect(getIntegrationConfig(environment).shipping).toMatchObject({
      provider: "melhorenvio",
      enabled: true,
      melhorEnvioEnabled: true
    });
  });

  it("nunca habilita a URL de produção do Melhor Envio", () => {
    expect(isMelhorEnvioSandboxReady({
      SHIPPING_PROVIDER: "melhorenvio",
      MELHOR_ENVIO_ENABLED: "true",
      MELHOR_ENVIO_OAUTH_VALIDATED: "true",
      MELHOR_ENVIO_BASE_URL: "https://melhorenvio.com.br",
      MELHOR_ENVIO_REDIRECT_URI: "https://store.example.com/callback",
      MELHOR_ENVIO_CLIENT_ID: "client-id",
      MELHOR_ENVIO_CLIENT_SECRET: "client-secret",
      MELHOR_ENVIO_ACCESS_TOKEN: "access-token",
      MELHOR_ENVIO_ACCESS_TOKEN_EXPIRES_AT: "2099-01-01T00:00:00.000Z"
    })).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  getIntegrationConfig,
  isMelhorEnvioConfigured,
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

  it("não faz fallback para frete fixo quando o Melhor Envio está incompleto", () => {
    expect(
      getIntegrationConfig({
        PAYMENT_PROVIDER: "mercado_pago",
        SHIPPING_PROVIDER: "melhor_envio",
        MELHOR_ENVIO_ENABLED: "true"
      })
    ).toMatchObject({
      payment: { provider: "mercadopago", mercadoPagoEnabled: true },
      shipping: { provider: "melhorenvio", enabled: false, melhorEnvioEnabled: false }
    });
  });

  it("aceita configuração server-side do Melhor Envio no Sandbox", () => {
    const environment = {
      SHIPPING_PROVIDER: "melhor_envio",
      MELHOR_ENVIO_ENABLED: "true",
      MELHOR_ENVIO_ENVIRONMENT: "sandbox",
      MELHOR_ENVIO_BASE_URL: "https://sandbox.melhorenvio.com.br",
      MELHOR_ENVIO_REDIRECT_URI: "https://store.example.com/api/shipping/melhor-envio/callback",
      MELHOR_ENVIO_CLIENT_ID: "client-id",
      MELHOR_ENVIO_CLIENT_SECRET: "client-secret",
      MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=",
      MELHOR_ENVIO_APP_NAME: "curti Z",
      MELHOR_ENVIO_TECHNICAL_CONTACT: "tech@example.com",
      MELHOR_ENVIO_ORIGIN_NAME: "Loja Teste",
      MELHOR_ENVIO_ORIGIN_EMAIL: "origem@example.com",
      MELHOR_ENVIO_ORIGIN_PHONE: "11999999999",
      MELHOR_ENVIO_ORIGIN_DOCUMENT: "12345678909",
      MELHOR_ENVIO_ORIGIN_ADDRESS: "Rua Teste",
      MELHOR_ENVIO_ORIGIN_NUMBER: "100",
      MELHOR_ENVIO_ORIGIN_DISTRICT: "Centro",
      MELHOR_ENVIO_ORIGIN_CITY: "São Paulo",
      MELHOR_ENVIO_ORIGIN_STATE: "SP",
      MELHOR_ENVIO_ORIGIN_POSTAL_CODE: "01001000"
    };
    expect(isMelhorEnvioSandboxReady(environment)).toBe(true);
    expect(getIntegrationConfig(environment).shipping).toMatchObject({
      provider: "melhorenvio",
      enabled: true,
      melhorEnvioEnabled: true
    });
  });

  it("rejeita URL legada divergente do ambiente selecionado", () => {
    expect(isMelhorEnvioSandboxReady({
      SHIPPING_PROVIDER: "melhorenvio",
      MELHOR_ENVIO_ENABLED: "true",
      MELHOR_ENVIO_ENVIRONMENT: "sandbox",
      MELHOR_ENVIO_BASE_URL: "https://melhorenvio.com.br",
      MELHOR_ENVIO_REDIRECT_URI: "https://store.example.com/callback",
      MELHOR_ENVIO_CLIENT_ID: "client-id",
      MELHOR_ENVIO_CLIENT_SECRET: "client-secret",
      MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=",
      MELHOR_ENVIO_APP_NAME: "curti Z",
      MELHOR_ENVIO_TECHNICAL_CONTACT: "tech@example.com",
      MELHOR_ENVIO_ORIGIN_POSTAL_CODE: "01001000"
    })).toBe(false);
  });

  it("exige CNPJ e Inscrição Estadual no ambiente comercial de produção", () => {
    const environment = {
      MELHOR_ENVIO_ENABLED: "true", MELHOR_ENVIO_ENVIRONMENT: "production",
      MELHOR_ENVIO_REDIRECT_URI: "https://panel.example.com/callback", MELHOR_ENVIO_CLIENT_ID: "client-id",
      MELHOR_ENVIO_CLIENT_SECRET: "client-secret", MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=",
      MELHOR_ENVIO_APP_NAME: "curti Z", MELHOR_ENVIO_TECHNICAL_CONTACT: "tech@example.com",
      MELHOR_ENVIO_ORIGIN_NAME: "Loja Teste", MELHOR_ENVIO_ORIGIN_EMAIL: "origem@example.com",
      MELHOR_ENVIO_ORIGIN_PHONE: "11999999999", MELHOR_ENVIO_ORIGIN_ADDRESS: "Rua Teste",
      MELHOR_ENVIO_ORIGIN_NUMBER: "100", MELHOR_ENVIO_ORIGIN_DISTRICT: "Centro",
      MELHOR_ENVIO_ORIGIN_CITY: "São Paulo", MELHOR_ENVIO_ORIGIN_STATE: "SP",
      MELHOR_ENVIO_ORIGIN_POSTAL_CODE: "01001000", MELHOR_ENVIO_ORIGIN_DOCUMENT: "12345678909"
    };
    expect(isMelhorEnvioConfigured(environment)).toBe(false);
    expect(isMelhorEnvioConfigured({ ...environment, MELHOR_ENVIO_ORIGIN_COMPANY_DOCUMENT: "12345678000195",
      MELHOR_ENVIO_ORIGIN_STATE_REGISTER: "110042490114" })).toBe(true);
  });
});

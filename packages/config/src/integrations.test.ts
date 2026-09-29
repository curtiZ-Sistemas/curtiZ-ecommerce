import { describe, expect, it } from "vitest";
import {
  getMelhorEnvioReadiness,
  getIntegrationConfig,
  isMelhorEnvioConfigured,
  isMelhorEnvioSandboxReady,
  parseEnvironmentBoolean
} from "./integrations";

const completeSandboxEnvironment = {
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
    expect(isMelhorEnvioSandboxReady(completeSandboxEnvironment)).toBe(true);
    expect(getIntegrationConfig(completeSandboxEnvironment).shipping).toMatchObject({
      provider: "melhorenvio",
      enabled: true,
      melhorEnvioEnabled: true
    });
    expect(getMelhorEnvioReadiness(completeSandboxEnvironment)).toEqual({ configured: true, missing: [], invalid: [] });
  });

  it.each([
    "MELHOR_ENVIO_REDIRECT_URI", "MELHOR_ENVIO_CLIENT_ID", "MELHOR_ENVIO_CLIENT_SECRET",
    "MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY", "MELHOR_ENVIO_APP_NAME", "MELHOR_ENVIO_TECHNICAL_CONTACT",
    "MELHOR_ENVIO_ORIGIN_NAME", "MELHOR_ENVIO_ORIGIN_EMAIL", "MELHOR_ENVIO_ORIGIN_PHONE",
    "MELHOR_ENVIO_ORIGIN_ADDRESS", "MELHOR_ENVIO_ORIGIN_NUMBER", "MELHOR_ENVIO_ORIGIN_DISTRICT",
    "MELHOR_ENVIO_ORIGIN_CITY", "MELHOR_ENVIO_ORIGIN_STATE", "MELHOR_ENVIO_ORIGIN_POSTAL_CODE"
  ])("desabilita o frete e aponta somente o nome quando %s está ausente", (name) => {
    const environment = { ...completeSandboxEnvironment };
    delete environment[name as keyof typeof environment];
    const readiness = getMelhorEnvioReadiness(environment);
    expect(readiness.configured).toBe(false);
    expect(readiness.missing).toContain(name);
    expect(getIntegrationConfig(environment).shipping.enabled).toBe(false);
    expect(JSON.stringify(readiness)).not.toContain("client-secret");
    expect(JSON.stringify(readiness)).not.toContain("Rua Teste");
    expect(JSON.stringify(readiness)).not.toContain("11999999999");
    expect(JSON.stringify(readiness)).not.toContain("origem@example.com");
  });

  it.each([
    ["MELHOR_ENVIO_ENABLED", "false", "MELHOR_ENVIO_ENABLED_DISABLED"],
    ["MELHOR_ENVIO_ENVIRONMENT", "productionx", "MELHOR_ENVIO_ENVIRONMENT_INVALID"],
    ["MELHOR_ENVIO_BASE_URL", "https://melhorenvio.com.br", "MELHOR_ENVIO_BASE_URL_INVALID"],
    ["MELHOR_ENVIO_REDIRECT_URI", "http://store.example.com/callback", "MELHOR_ENVIO_REDIRECT_URI_INVALID"],
    ["MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY", "invalid-key", "MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY_INVALID"],
    ["MELHOR_ENVIO_TECHNICAL_CONTACT", "contato-invalido", "MELHOR_ENVIO_TECHNICAL_CONTACT_INVALID"],
    ["MELHOR_ENVIO_ORIGIN_EMAIL", "email-invalido", "MELHOR_ENVIO_ORIGIN_EMAIL_INVALID"],
    ["MELHOR_ENVIO_ORIGIN_PHONE", "1199", "MELHOR_ENVIO_ORIGIN_PHONE_INVALID"],
    ["MELHOR_ENVIO_ORIGIN_STATE", "São Paulo", "MELHOR_ENVIO_ORIGIN_STATE_INVALID"],
    ["MELHOR_ENVIO_ORIGIN_POSTAL_CODE", "123", "MELHOR_ENVIO_ORIGIN_POSTAL_CODE_INVALID"],
    ["MELHOR_ENVIO_ORIGIN_DOCUMENT", "123", "MELHOR_ENVIO_ORIGIN_DOCUMENT_INVALID"]
  ])("desabilita o frete e aponta somente o código para %s inválido", (name, value, code) => {
    const environment = { ...completeSandboxEnvironment, [name]: value };
    const readiness = getMelhorEnvioReadiness(environment);
    expect(readiness.configured).toBe(false);
    expect(readiness.invalid).toContain(code);
    expect(getIntegrationConfig(environment).shipping.enabled).toBe(false);
    expect(JSON.stringify(readiness)).not.toContain("invalid-key");
    expect(JSON.stringify(readiness)).not.toContain("email-invalido");
  });

  it("aceita CNPJ Sandbox válido e não retorna dados do remetente", () => {
    const environment = { ...completeSandboxEnvironment, MELHOR_ENVIO_ORIGIN_DOCUMENT: "" };
    const readiness = getMelhorEnvioReadiness({
      ...environment,
      MELHOR_ENVIO_ORIGIN_COMPANY_DOCUMENT: "12345678000195"
    });
    expect(readiness).toEqual({ configured: true, missing: [], invalid: [] });
    expect(JSON.stringify(readiness)).not.toContain("12345678000195");
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

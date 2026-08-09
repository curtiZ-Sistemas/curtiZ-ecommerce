import { describe, expect, it } from "vitest";
import { type EnvironmentValues, validateEnvironment } from "./environment-validation";

const stagingEnvironment: EnvironmentValues = {
  APP_ENV: "staging",
  PANEL_DEPLOYMENT_MODE: "separate",
  NEXT_PUBLIC_STORE_URL: "https://store-staging.example.com",
  NEXT_PUBLIC_PANEL_URL: "https://panel-staging.example.com",
  NEXT_PUBLIC_SUPABASE_URL: "https://staging.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "staging-publishable-key",
  SUPABASE_SECRET_KEY: "staging-secret-key",
  PII_ENCRYPTION_KEY: "staging-pii-key",
  AUDIT_HASH_KEY: "staging-audit-key",
  ALLOWED_ORIGINS: "https://store-staging.example.com,https://panel-staging.example.com",
  AUTH_COOKIE_DOMAIN: "example.com",
  DEMO_MODE: "true",
  DEMO_USERS_PASSWORD: "a-secure-staging-demo-password",
  DEMO_SESSION_SECRET: "staging-demo-session-secret-with-32-chars-minimum",
  PAYMENT_PROVIDER: "mock",
  EMAIL_PROVIDER: "mock",
  SHIPPING_PROVIDER: "mock",
  WHATSAPP_PROVIDER: "mock",
  REQUIRE_INTERNAL_MFA: "false"
};

const disabledProduction: EnvironmentValues = {
  ...stagingEnvironment,
  APP_ENV: "production",
  DEMO_MODE: "false",
  REQUIRE_INTERNAL_MFA: "false",
  AUTH_RATE_LIMIT_ENABLED: "true",
  CHECKOUT_ENABLED: "false",
  PAYMENT_PROVIDER: "disabled",
  MERCADO_PAGO_ENABLED: "false",
  SHIPPING_PROVIDER: "disabled",
  MELHOR_ENVIO_ENABLED: "false",
  EMAIL_PROVIDER: "disabled",
  EMAIL_ENABLED: "false",
  TURNSTILE_ENABLED: "false",
  WHATSAPP_PROVIDER: "disabled"
};

describe("environment validation", () => {
  it("permite mocks, demo, MFA desativado e integrações ausentes em staging", () => {
    expect(validateEnvironment("staging", stagingEnvironment)).toMatchObject({
      environment: "staging",
      valid: true,
      errors: []
    });
  });

  it("continua exigindo infraestrutura e chaves internas em staging", () => {
    const result = validateEnvironment("staging", {
      ...stagingEnvironment,
      SUPABASE_SECRET_KEY: "",
      PII_ENCRYPTION_KEY: undefined,
      ALLOWED_ORIGINS: ""
    });
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "SUPABASE_SECRET_KEY não está configurada",
        "PII_ENCRYPTION_KEY não está configurada",
        "ALLOWED_ORIGINS não está configurada"
      ])
    );
  });

  it("exige credenciais quando um provider real é selecionado", () => {
    const result = validateEnvironment("staging", {
      ...stagingEnvironment,
      PAYMENT_PROVIDER: "mercadopago"
    });
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "MERCADO_PAGO_ACCESS_TOKEN não está configurada",
        "MERCADO_PAGO_PUBLIC_KEY não está configurada",
        "MERCADO_PAGO_WEBHOOK_SECRET não está configurada"
      ])
    );
  });

  it("não aceita mocks nem modo demo em produção", () => {
    const result = validateEnvironment("production", stagingEnvironment);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "DEMO_MODE deve ser false em produção",
        "PAYMENT_PROVIDER=mock não é permitido em produção",
        "EMAIL_PROVIDER=mock não é permitido em produção",
        "SHIPPING_PROVIDER=mock não é permitido em produção"
      ])
    );
  });

  it("aprova produção inicial com integrações e MFA explicitamente desativados", () => {
    expect(validateEnvironment("production", disabledProduction)).toMatchObject({
      environment: "production",
      valid: true,
      errors: []
    });
    expect(
      validateEnvironment("production", { ...disabledProduction, DEMO_MODE: undefined }).valid
    ).toBe(true);
  });

  it("exige rate limit de autenticação em produção", () => {
    expect(
      validateEnvironment("production", {
        ...disabledProduction,
        AUTH_RATE_LIMIT_ENABLED: "false"
      }).errors
    ).toContain("AUTH_RATE_LIMIT_ENABLED deve ser true em produção");
  });

  it("exige segredos somente quando a integração é habilitada", () => {
    expect(
      validateEnvironment("production", {
        ...disabledProduction,
        MERCADO_PAGO_ENABLED: "true"
      }).errors
    ).toEqual(expect.arrayContaining(["MERCADO_PAGO_ACCESS_TOKEN não está configurada"]));
    expect(
      validateEnvironment("production", { ...disabledProduction, EMAIL_ENABLED: "true" }).errors
    ).toEqual(expect.arrayContaining(["RESEND_API_KEY não está configurada"]));
    expect(
      validateEnvironment("production", {
        ...disabledProduction,
        TURNSTILE_ENABLED: "true"
      }).errors
    ).toEqual(expect.arrayContaining(["TURNSTILE_SECRET_KEY não está configurada"]));
  });

  it("rejeita false como provider e aceita somente em flags", () => {
    const result = validateEnvironment("production", {
      ...disabledProduction,
      SHIPPING_PROVIDER: "false"
    });
    expect(result.errors).toContain("SHIPPING_PROVIDER possui valor inválido: false");
  });

  it("permite desenvolvimento local sem credenciais remotas", () => {
    expect(
      validateEnvironment("development", {
        APP_ENV: "development",
        NEXT_PUBLIC_STORE_URL: "http://localhost:3000",
        NEXT_PUBLIC_PANEL_URL: "http://localhost:3001",
        DEMO_MODE: "true",
        PAYMENT_PROVIDER: "mock"
      }).valid
    ).toBe(true);
  });

  it("rejeita apps remotos iguais ou fora do domínio compartilhado", () => {
    expect(
      validateEnvironment("staging", {
        ...stagingEnvironment,
        NEXT_PUBLIC_PANEL_URL: stagingEnvironment.NEXT_PUBLIC_STORE_URL
      }).errors
    ).toContain("NEXT_PUBLIC_STORE_URL e NEXT_PUBLIC_PANEL_URL devem usar aplicações distintas");

    expect(
      validateEnvironment("staging", {
        ...stagingEnvironment,
        NEXT_PUBLIC_PANEL_URL: "https://panel.outro-dominio.com"
      }).errors
    ).toContain("NEXT_PUBLIC_PANEL_URL não pertence a AUTH_COOKIE_DOMAIN");
  });

  it("rejeita URL do Supabase com caminho da API", () => {
    expect(
      validateEnvironment("production", {
        ...disabledProduction,
        NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co/rest/v1/"
      }).errors
    ).toContain(
      "NEXT_PUBLIC_SUPABASE_URL deve conter somente a origem do projeto, sem /rest/v1 ou outros caminhos"
    );
  });

  it("permite a mesma origem somente quando o modo integrado é explícito", () => {
    expect(
      validateEnvironment("staging", {
        ...stagingEnvironment,
        PANEL_DEPLOYMENT_MODE: "integrated",
        NEXT_PUBLIC_PANEL_URL: stagingEnvironment.NEXT_PUBLIC_STORE_URL
      }).valid
    ).toBe(true);
  });
});

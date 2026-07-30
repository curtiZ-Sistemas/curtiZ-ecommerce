import { describe, expect, it } from "vitest";
import { type EnvironmentValues, validateEnvironment } from "./environment-validation";

const stagingEnvironment: EnvironmentValues = {
  NEXT_PUBLIC_STORE_URL: "https://store-staging.example.com",
  NEXT_PUBLIC_PANEL_URL: "https://panel-staging.example.com",
  NEXT_PUBLIC_SUPABASE_URL: "https://staging.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "staging-publishable-key",
  SUPABASE_SECRET_KEY: "staging-secret-key",
  PII_ENCRYPTION_KEY: "staging-pii-key",
  AUDIT_HASH_KEY: "staging-audit-key",
  ALLOWED_ORIGINS: "https://store-staging.example.com,https://panel-staging.example.com",
  DEMO_MODE: "true",
  PAYMENT_PROVIDER: "mock",
  EMAIL_PROVIDER: "mock",
  SHIPPING_PROVIDER: "mock",
  REQUIRE_INTERNAL_MFA: "false"
};

describe("environment validation", () => {
  it("permite mocks, demo, MFA desativado e integrações ausentes em staging", () => {
    const result = validateEnvironment("staging", stagingEnvironment);

    expect(result).toMatchObject({ environment: "staging", valid: true, errors: [] });
  });

  it("continua exigindo infraestrutura e chaves internas em staging", () => {
    const result = validateEnvironment("staging", {
      ...stagingEnvironment,
      SUPABASE_SECRET_KEY: "",
      PII_ENCRYPTION_KEY: undefined,
      ALLOWED_ORIGINS: ""
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "SUPABASE_SECRET_KEY não está configurada",
        "PII_ENCRYPTION_KEY não está configurada",
        "ALLOWED_ORIGINS não está configurada"
      ])
    );
  });

  it("exige credenciais quando um provider real é selecionado em staging", () => {
    const result = validateEnvironment("staging", {
      ...stagingEnvironment,
      PAYMENT_PROVIDER: "mercadopago"
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "MERCADO_PAGO_ACCESS_TOKEN não está configurada",
        "MERCADO_PAGO_PUBLIC_KEY não está configurada",
        "MERCADO_PAGO_WEBHOOK_SECRET não está configurada"
      ])
    );
  });

  it("não aceita a configuração permissiva de staging como produção", () => {
    const result = validateEnvironment("production", stagingEnvironment);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "DEMO_MODE deve ser false em produção",
        "PAYMENT_PROVIDER deve ser mercadopago em produção",
        "EMAIL_PROVIDER deve usar um provedor real em produção",
        "SHIPPING_PROVIDER deve usar um provedor real em produção",
        "REQUIRE_INTERNAL_MFA deve ser true em produção"
      ])
    );
  });

  it("aprova produção somente com providers reais e controles obrigatórios", () => {
    const result = validateEnvironment("production", {
      ...stagingEnvironment,
      DEMO_MODE: "false",
      REQUIRE_INTERNAL_MFA: "true",
      PAYMENT_PROVIDER: "mercadopago",
      MERCADO_PAGO_ACCESS_TOKEN: "production-access-token",
      MERCADO_PAGO_PUBLIC_KEY: "production-public-key",
      MERCADO_PAGO_WEBHOOK_SECRET: "production-webhook-secret",
      EMAIL_PROVIDER: "resend",
      RESEND_API_KEY: "production-resend-key",
      EMAIL_FROM: "Curtiz <noreply@example.com>",
      SHIPPING_PROVIDER: "custom",
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: "production-turnstile-site-key",
      TURNSTILE_SECRET_KEY: "production-turnstile-secret"
    });

    expect(result).toMatchObject({ environment: "production", valid: true, errors: [] });
  });

  it("permite desenvolvimento local sem credenciais remotas", () => {
    const result = validateEnvironment("development", {
      NEXT_PUBLIC_STORE_URL: "http://localhost:3000",
      NEXT_PUBLIC_PANEL_URL: "http://localhost:3001",
      DEMO_MODE: "true",
      PAYMENT_PROVIDER: "mock"
    });

    expect(result.valid).toBe(true);
  });
});

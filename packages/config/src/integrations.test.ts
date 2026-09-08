import { describe, expect, it } from "vitest";
import { getIntegrationConfig, parseEnvironmentBoolean } from "./integrations";

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

  it("normaliza os aliases documentados", () => {
    expect(
      getIntegrationConfig({
        PAYMENT_PROVIDER: "mercado_pago",
        SHIPPING_PROVIDER: "melhor_envio"
      })
    ).toMatchObject({
      payment: { provider: "mercadopago", mercadoPagoEnabled: true },
      shipping: { provider: "melhorenvio", melhorEnvioEnabled: true }
    });
  });
});

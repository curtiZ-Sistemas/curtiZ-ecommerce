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
      turnstile: { enabled: false },
      internalMfaRequired: false
    });
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

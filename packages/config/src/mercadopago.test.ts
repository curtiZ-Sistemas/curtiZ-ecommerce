import { describe, expect, it } from "vitest";
import { getMercadoPagoCredentials } from "./mercadopago";

describe("Mercado Pago activation boundary", () => {
  const test = { MERCADO_PAGO_ENVIRONMENT: "test", MERCADO_PAGO_ACCESS_TOKEN: "TEST-fixture",
    NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY: "TEST-public" };
  const live = { MERCADO_PAGO_ENVIRONMENT: "production", MERCADO_PAGO_ACCESS_TOKEN: "APP_USR-fixture",
    NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY: "APP_USR-public" };
  it("keeps existing test credentials usable", () => expect(getMercadoPagoCredentials(test)?.mode).toBe("test"));
  it("requires explicit production approval as well as matching keys", () => {
    expect(getMercadoPagoCredentials(live)).toBeNull();
    expect(getMercadoPagoCredentials({ ...live, MERCADO_PAGO_PRODUCTION_READY: "true" })?.mode).toBe("production");
  });
  it.each([
    { ...test, MERCADO_PAGO_ACCESS_TOKEN: "APP_USR-fixture" },
    { ...test, NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY: "APP_USR-public" },
    { ...live, MERCADO_PAGO_ENVIRONMENT: "test", MERCADO_PAGO_PRODUCTION_READY: "true" },
    { ...test, MERCADO_PAGO_ENVIRONMENT: "invalid" },
    { ...live, MERCADO_PAGO_PRODUCTION_READY: "true", MERCADO_PAGO_ACCESS_TOKEN: "TEST-fixture" }
  ])("fails closed for mixed or invalid settings", environment => expect(getMercadoPagoCredentials(environment)).toBeNull());
});

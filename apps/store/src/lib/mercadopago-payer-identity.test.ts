import { describe, expect, it } from "vitest";
import { readMercadoPagoPayerDocument } from "./mercadopago-payer-identity";

describe("identidade do pagador Mercado Pago", () => {
  it("separa documento TEST do last4 real do cliente", () => {
    expect(readMercadoPagoPayerDocument("12345678909", "test", "4725")).toBe("12345678909");
    expect(readMercadoPagoPayerDocument("12345678900", "test", "4725")).toBe("12345678900");
  });
  it.each(["", "11111111111", "1234567890", "123456789012", "abc12345678909", "12345678909extra"])(
    "recusa documento TEST malformado: %s", value => {
      expect(readMercadoPagoPayerDocument(value, "test")).toBeNull();
    });
  it("mantém checksum e vínculo ao cliente fora de TEST", () => {
    expect(readMercadoPagoPayerDocument("12345678900", "production")).toBeNull();
    expect(readMercadoPagoPayerDocument("12345678909", "production", "4725")).toBeNull();
    expect(readMercadoPagoPayerDocument("529.982.247-25", "production", "4725")).toBe("52998224725");
    expect(readMercadoPagoPayerDocument("52998224725", "production", "")).toBeNull();
  });
});

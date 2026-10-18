import { describe, expect, it, vi } from "vitest";
import type { MelhorEnvioQuote } from "@curtiz/integrations";
import { createShippingPreviewCache, shippingPreviewKey } from "./shipping-preview";

const quote: MelhorEnvioQuote = { provider: "melhorenvio", serviceId: "1", service: "PAC", carrier: "Correios",
  amountInCents: 2000, costInCents: 1800, estimatedDays: 5, packages: [{ private: true }], expiresAt: "2099-01-01T00:00:00Z" };
describe("shipping preview cache", () => {
  it("isolates concurrent I/O, strips private fields and expires after one minute", async () => {
    let now = 1000;
    const cache = createShippingPreviewCache(() => now);
    const load = vi.fn(async () => [quote]);
    const results = await Promise.all([cache("a", load), cache("a", load)]);
    expect(load).toHaveBeenCalledTimes(2);
    expect(results[0]).toEqual([{ serviceId: "1", service: "PAC", carrier: "Correios", amountInCents: 2000, estimatedDays: 5 }]);
    await cache("a", load);
    expect(load).toHaveBeenCalledTimes(2);
    now += 60_001;
    await cache("a", load);
    expect(load).toHaveBeenCalledTimes(3);
  });
  it("does not cache provider failures or expired rates; caches empty services briefly", async () => {
    const cache = createShippingPreviewCache();
    const failure = vi.fn(async (): Promise<MelhorEnvioQuote[]> => { throw new Error("provider"); });
    await expect(cache("failed", failure)).rejects.toThrow();
    await expect(cache("failed", failure)).rejects.toThrow();
    expect(failure).toHaveBeenCalledTimes(2);
    const expired = vi.fn(async () => [{ ...quote, expiresAt: "2000-01-01T00:00:00Z" }]);
    await cache("expired", expired); await cache("expired", expired);
    expect(expired).toHaveBeenCalledTimes(2);
    const empty = vi.fn(async () => []);
    await cache("empty", empty); await cache("empty", empty);
    expect(empty).toHaveBeenCalledTimes(1);
  });
  it("partitions by product, variant, quantity, official measures, price, CEP, origin and environment", () => {
    const input = { productId: "kit", variantId: "red", postalCode: "01310100", originPostalCode: "01001000", environment: "production",
      products: [{ id: "red", quantity: 1, weightKg: 1, widthCm: 20, heightCm: 10, lengthCm: 30, insuranceValue: 100 }] };
    const key = shippingPreviewKey(input);
    for (const patch of [{ productId: "other" }, { variantId: "blue" }, { postalCode: "20040002" },
      { originPostalCode: "20040002" }, { environment: "sandbox" }]) {
      expect(shippingPreviewKey({ ...input, ...patch })).not.toBe(key);
    }
    for (const patch of [{ quantity: 2 }, { weightKg: 2 }, { widthCm: 25 }, { heightCm: 12 }, { lengthCm: 35 }, { insuranceValue: 150 }]) {
      expect(shippingPreviewKey({ ...input, products: [{ ...input.products[0]!, ...patch }] })).not.toBe(key);
    }
  });
});

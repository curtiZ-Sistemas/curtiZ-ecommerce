import { createHash } from "node:crypto";
import type { MelhorEnvioQuote, MelhorEnvioQuoteProduct } from "@curtiz/integrations";

export type ShippingPreviewQuote = Pick<MelhorEnvioQuote, "serviceId" | "service" | "carrier" | "amountInCents" | "estimatedDays">;

// An optional, bounded cache, never a substitute for the distributed request budget.
export function createShippingPreviewCache(now = Date.now) {
  const entries = new Map<string, { until: number; quotes: ShippingPreviewQuote[] }>();
  return async (key: string, load: () => Promise<MelhorEnvioQuote[]>): Promise<ShippingPreviewQuote[]> => {
    for (const [id, entry] of entries) if (entry.until <= now()) entries.delete(id);
    const cached = entries.get(key);
    if (cached) return cached.quotes;
    // Keep only completed data: Workers must not share another request's I/O promise.
    const result = await load();
    const quotes = result.map(({ serviceId, service, carrier, amountInCents, estimatedDays }) =>
      ({ serviceId, service, carrier, amountInCents, estimatedDays }));
    const until = Math.min(now() + 60_000, ...result.map((quote) => Date.parse(quote.expiresAt)));
    if (Number.isFinite(until) && until > now()) {
      if (entries.size >= 100) entries.delete(entries.keys().next().value ?? "");
      entries.set(key, { quotes, until });
    }
    return quotes;
  };
}

export function shippingPreviewKey(input: {
  productId: string; variantId: string; postalCode: string; originPostalCode: string;
  environment: string; products: MelhorEnvioQuoteProduct[];
}) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

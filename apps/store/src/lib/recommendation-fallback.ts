import type { Product } from "@curtiz/domain";
import { availableCatalogRecommendations } from "./catalog-recommendations";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function eligibleProduct(value: unknown): value is Product {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const product = value as Partial<Product>;
  return typeof product.id === "string" && typeof product.slug === "string"
    && typeof product.name === "string" && typeof product.image === "string"
    && product.image.length > 0 && typeof product.stock === "number" && product.stock > 0
    && availableCatalogRecommendations([product]).length > 0;
}

export function appendEligibleRecommendations(
  existing: readonly Product[], candidates: unknown, excluded: ReadonlySet<string>, limit: number
): Product[] {
  const next = [...existing];
  if (!Array.isArray(candidates)) return next;
  for (const candidate of candidates as unknown[]) {
    if (!eligibleProduct(candidate) || excluded.has(candidate.id)
      || next.some((item) => item.id === candidate.id)) continue;
    next.push(candidate);
    if (next.length >= limit) break;
  }
  return next;
}

type FallbackResponse = { ok: boolean; json: () => Promise<unknown> };
type FallbackFetch = (url: string, signal: AbortSignal) => Promise<FallbackResponse>;

export async function loadRecommendationFallback({ initial, excludedIds, category, priceInCents,
  limit, signal, fetcher = (url, requestSignal) => fetch(url, { signal: requestSignal, cache: "no-store" })
}: {
  initial: readonly Product[]; excludedIds: readonly string[]; category?: string;
  priceInCents?: number; limit: number; signal: AbortSignal; fetcher?: FallbackFetch;
}): Promise<Product[]> {
  const excluded = new Set(excludedIds);
  let next = appendEligibleRecommendations([], initial, excluded, limit);
  const catalogParams = (withPrice: boolean) => {
    const params = new URLSearchParams({ estoque: "1", limite: "24" });
    if (category) params.set("categoria", category);
    if (withPrice && priceInCents) {
      params.set("preco_min", String(Math.max(0, Math.floor(priceInCents * .65 / 100))));
      params.set("preco_max", String(Math.ceil(priceInCents * 1.35 / 100)));
    }
    return params;
  };
  const intelligenceUrl = (source: "trending" | "newest", inCategory: boolean) => {
    const seen = [...excludedIds, ...next.map((item) => item.id)]
      .filter((id) => uuidPattern.test(id)).slice(-50);
    const params = new URLSearchParams({ source, limit: String(limit), seen: seen.join(",") });
    if (inCategory && category) params.set("category", category);
    return `/api/intelligence/recommendations?${params}`;
  };
  const steps = [
    () => intelligenceUrl("trending", true),
    () => `/api/catalog?${catalogParams(true)}`,
    () => `/api/catalog?${catalogParams(false)}`,
    () => intelligenceUrl("trending", false),
    () => intelligenceUrl("newest", false),
    () => "/api/catalog?estoque=1&limite=24&ordem=newest"
  ];
  for (const url of steps) {
    if (next.length >= limit || signal.aborted) break;
    try {
      const response = await fetcher(url(), signal);
      if (!response.ok) continue;
      const data: unknown = await response.json();
      const candidates = data && typeof data === "object" && !Array.isArray(data)
        ? (data as { products?: unknown }).products : undefined;
      next = appendEligibleRecommendations(next, candidates, excluded, limit);
    } catch { /* Continue with the next independent public source. */ }
  }
  return next;
}

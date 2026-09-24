import type { Product } from "@curtiz/domain";
import { appendEligibleRecommendations } from "./recommendation-fallback";
import { diversifyRecommendations, type RecommendationDiversity } from "./recommendation-diversity";

export type IntelligenceSource =
  | "personalized" | "trending" | "most_wanted" | "most_viewed" | "discovery"
  | "newest" | "price_range" | "recently_viewed" | "because_you_viewed";

type LoadOptions = {
  source: IntelligenceSource;
  sessionId: string | null;
  recent?: string[];
  category?: string;
  priceInCents?: number;
  query?: string;
  productName?: string;
  productId?: string;
  currentProduct?: Product;
  diversity?: RecommendationDiversity;
  seen?: string[];
  limit: number;
  signal: AbortSignal;
  fetcher?: typeof fetch;
};

const behavioralSources = new Set<IntelligenceSource>([
  "personalized", "because_you_viewed", "recently_viewed", "price_range"
]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const normalize = (value: string) => value.toLocaleLowerCase("pt-BR")
  .normalize("NFD").replace(/[\u0300-\u036f]/gu, "").replace(/[^a-z0-9]+/gu, " ").trim();

export function searchContextScore(product: Product, query: string): number {
  const terms = normalize(query).split(" ").filter((term) => term.length >= 3);
  if (!terms.length) return 0;
  const name = normalize(product.name);
  const category = normalize(product.category);
  const description = normalize(product.description);
  return terms.reduce((score, term) => score +
    (name.split(" ").some((word) => word.startsWith(term)) ? 4 : name.includes(term) ? 3 : 0) +
    (category.split(" ").some((word) => word.startsWith(term)) ? 3 : category.includes(term) ? 2 : 0) +
    (description.includes(term) ? 1 : 0), 0);
}

export async function loadSmartRecommendations({ source, sessionId, recent = [], category,
  priceInCents, query, productName, productId, currentProduct, diversity, seen = [], limit, signal, fetcher = fetch
}: LoadOptions): Promise<{ products: Product[]; hasMore: boolean }> {
  const target = Math.max(1, Math.min(24, limit));
  const excluded = new Set([...seen, ...(productId ? [productId] : []), ...(currentProduct ? [currentProduct.id] : [])]);
  const candidatePool: Product[] = [];
  let products: Product[] = [];
  let hasMore = false;
  let requests = 0;
  const priceMin = priceInCents ? Math.max(0, Math.floor(priceInCents * 65 / 100)) : undefined;
  const priceMax = priceInCents ? Math.ceil(priceInCents * 135 / 100) : undefined;
  const seed = (query || productName || productId || `${new Date().toISOString().slice(0, 10)}:${seen.length}`).slice(0, 80);
  const refreshSelection = () => {
    products = diversifyRecommendations(candidatePool, {
      excludeProductIds: [...excluded], currentProduct, limit: target, mode: diversity
    });
  };
  const currentSeen = () => [...new Set([...excluded, ...candidatePool.map((item) => item.id)])]
    .filter((id) => uuidPattern.test(id)).slice(0, 50);

  const request = async (requestedSource: IntelligenceSource, requestedLimit = target,
    withSession = false): Promise<void> => {
    if (signal.aborted || products.length >= target || requestedLimit < 1 || requests >= 8) return;
    requests += 1;
    const body = {
      source: requestedSource, sessionId: withSession ? sessionId : null,
      category: category || null, seen: currentSeen(),
      recent: requestedSource === "recently_viewed" ? recent : [],
      seed, limit: Math.min(requestedLimit, target - products.length),
      priceMin: priceMin ?? null, priceMax: priceMax ?? null
    };
    const params = new URLSearchParams({
      source: body.source, seed: body.seed, limit: String(body.limit), seen: body.seen.join(",")
    });
    if (category) params.set("category", category);
    if (priceMin !== undefined) params.set("priceMin", String(priceMin));
    if (priceMax !== undefined) params.set("priceMax", String(priceMax));
    try {
      const response = await fetcher(withSession ? "/api/intelligence/recommendations"
        : `/api/intelligence/recommendations?${params}`, withSession
        ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal, cache: "no-store" }
        : { signal });
      if (!response.ok) return;
      const data: unknown = await response.json();
      if (!data || typeof data !== "object" || Array.isArray(data)) return;
      const payload = data as { products?: unknown; demo?: boolean; source?: string; nextCursor?: unknown };
      if (payload.demo || payload.source === "demo") return;
      candidatePool.splice(0, candidatePool.length,
        ...appendEligibleRecommendations(candidatePool, payload.products, excluded, target * 8));
      refreshSelection();
      hasMore = Boolean(payload.nextCursor);
    } catch {
      if (signal.aborted) return;
    }
  };

  const contextCatalog = async (): Promise<void> => {
    if (signal.aborted || products.length >= target || requests >= 8 || (!query && !productName && !category && !priceInCents)) return;
    requests += 1;
    const params = new URLSearchParams({ estoque: "1", limite: "24", compacto: "1" });
    if (category) params.set("categoria", category);
    if (priceMin !== undefined) params.set("preco_min", String(Math.floor(priceMin / 100)));
    if (priceMax !== undefined) params.set("preco_max", String(Math.ceil(priceMax / 100)));
    try {
      const response = await fetcher(`/api/catalog?${params}`, { signal });
      if (!response.ok) return;
      const data: unknown = await response.json();
      if (!data || typeof data !== "object" || Array.isArray(data)) return;
      const payload = data as { products?: unknown; source?: string };
      if (payload.source === "demo" || response.headers.get("x-catalog-source") === "demo"
        || !Array.isArray(payload.products)) return;
      const contextTerm = query || productName;
      const matches = contextTerm
        ? (payload.products as Product[]).filter((product) => product && typeof product.name === "string"
          && typeof product.category === "string" && typeof product.description === "string")
            .map((product) => ({ product, score: searchContextScore(product, contextTerm) }))
            .filter((item) => !query || item.score > 0)
            .sort((a, b) => b.score - a.score).map((item) => item.product)
        : payload.products;
      candidatePool.splice(0, candidatePool.length,
        ...appendEligibleRecommendations(candidatePool, matches, excluded, target * 8));
      refreshSelection();
    } catch {
      if (signal.aborted) return;
    }
  };

  if (source !== "personalized" && (!behavioralSources.has(source) || sessionId)) {
    await request(source, target, behavioralSources.has(source) && Boolean(sessionId));
    return { products, hasMore };
  }

  if (sessionId) {
    await request("personalized", query ? Math.max(1, Math.ceil(target * .67)) : target, true);
    await contextCatalog();
    if (products.length < target && recent.length) await request("because_you_viewed", target - products.length, true);
    if (products.length < target && priceInCents) await request("price_range", target - products.length, true);
    if (products.length < target && recent.length) await request("recently_viewed", target, true);
  } else {
    await contextCatalog();
  }
  if (products.length < target) await request("most_wanted");
  if (products.length < target) await request("trending");
  if (products.length < target) await request("discovery");
  if (products.length < target) await request("newest");
  if (diversity === "product_detail") {
    products = diversifyRecommendations(candidatePool, {
      excludeProductIds: [...excluded], currentProduct, limit: target,
      mode: diversity, relaxFamilies: true
    });
  }
  return { products, hasMore: false };
}

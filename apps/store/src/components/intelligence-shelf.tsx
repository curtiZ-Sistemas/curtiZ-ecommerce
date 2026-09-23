"use client";

import { storefrontItemKey, type Product } from "@curtiz/domain";
import { LoaderCircle, RefreshCw, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { intelligenceSessionId, recentlyViewedProductIds } from "../lib/intelligence-client";
import { appendEligibleRecommendations, loadRecommendationFallback } from "../lib/recommendation-fallback";
import { ProductCard } from "./product-card";

export type IntelligenceSource =
  | "personalized"
  | "trending"
  | "most_wanted"
  | "most_viewed"
  | "discovery"
  | "newest"
  | "price_range"
  | "recently_viewed"
  | "because_you_viewed";
const sourceTitles: Record<IntelligenceSource, string> = {
  personalized: "Escolhas para você",
  trending: "Em alta agora",
  most_wanted: "Mais desejados",
  most_viewed: "Mais vistos",
  discovery: "Continue descobrindo",
  newest: "Novidades para conhecer",
  price_range: "Na sua faixa de interesse",
  recently_viewed: "Vistos recentemente",
  because_you_viewed: "Porque você viu estes estilos"
};
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const emptyProductIds: string[] = [];

export function IntelligenceShelf({
  source = "personalized",
  title,
  subtitle,
  limit = 8,
  category,
  excludeProductIds = emptyProductIds,
  fallbackCatalog = false,
  priceInCents,
  infinite = false,
  className = ""
}: {
  source?: IntelligenceSource;
  title?: string;
  subtitle?: string;
  limit?: number;
  category?: string;
  excludeProductIds?: string[];
  fallbackCatalog?: boolean;
  priceInCents?: number;
  infinite?: boolean;
  className?: string;
}) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [hasMore, setHasMore] = useState(true);
  const [consentRevision, setConsentRevision] = useState(0);
  const [activated, setActivated] = useState(false);
  const [supportsObserver, setSupportsObserver] = useState(true);
  const shelf = useRef<HTMLElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const page = useRef(0);
  const request = useRef<AbortController | null>(null);
  const productsRef = useRef<Product[]>([]);
  useEffect(() => {
    const refreshConsent = () => setConsentRevision((current) => current + 1);
    window.addEventListener("curtiz-consent-changed", refreshConsent);
    return () => window.removeEventListener("curtiz-consent-changed", refreshConsent);
  }, []);
  const load = useCallback(
    async (reset = false) => {
      if (request.current) return;
      const controller = new AbortController();
      request.current = controller;
      if (reset) setLoading(true);
      else setLoadingMore(true);
      setError("");
      try {
        void consentRevision;
        const sessionId = intelligenceSessionId();
        const publicSource: IntelligenceSource = [
          "personalized",
          "recently_viewed",
          "because_you_viewed",
          "price_range"
        ].includes(source)
          ? "trending"
          : source;
        const seen = [
          ...excludeProductIds,
          ...(reset ? [] : productsRef.current.map((item) => item.id))
        ].filter((id) => uuidPattern.test(id)).slice(-50);
        const seed = `${new Date().toISOString().slice(0, 10)}:${page.current}`;
        const publicParams = new URLSearchParams({
          source: publicSource,
          seed,
          limit: String(limit),
          seen: seen.join(",")
        });
        if (category) publicParams.set("category", category);
        let response: Response | null = null;
        let data: unknown = null;
        try {
          response = await fetch(
            sessionId
              ? "/api/intelligence/recommendations"
              : `/api/intelligence/recommendations?${publicParams}`,
            sessionId
              ? {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({
                    source,
                    sessionId,
                    category: category || null,
                    seen,
                    recent: source === "recently_viewed" ? recentlyViewedProductIds() : [],
                    seed,
                    limit
                  }),
                  signal: controller.signal,
                  cache: "no-store"
                }
              : { signal: controller.signal }
          );
          data = await response.json().catch(() => null);
        } catch (error) {
          if (controller.signal.aborted || !fallbackCatalog) throw error;
        }
        if (
          !response?.ok ||
          !data ||
          typeof data !== "object" ||
          !Array.isArray((data as { products?: unknown }).products)
        ) {
          if (!fallbackCatalog) throw new Error("Não foi possível carregar esta seleção.");
        }
        const excluded = new Set(excludeProductIds);
        const primary = response?.ok && data && typeof data === "object" && Array.isArray((data as { products?: unknown }).products)
          ? (data as { products: unknown[] }).products : [];
        let next = appendEligibleRecommendations([], primary, excluded, limit);
        if (fallbackCatalog && reset && next.length < limit) next = await loadRecommendationFallback({
          initial: next, excludedIds: [...excludeProductIds, ...seen], category, priceInCents, limit,
          signal: controller.signal
        });
        setProducts((current) => {
          const merged = reset
            ? next
            : [
                ...current,
                ...next.filter((item) => !current.some((existing) => existing.id === item.id))
              ];
          productsRef.current = merged;
          return merged;
        });
        setHasMore(!fallbackCatalog && next.length === limit && Boolean((data as { nextCursor?: unknown } | null)?.nextCursor));
        page.current += 1;
      } catch (loadError) {
        if (!controller.signal.aborted)
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Não foi possível carregar esta seleção."
          );
      } finally {
        request.current = null;
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [category, consentRevision, excludeProductIds, fallbackCatalog, limit, priceInCents, source]
  );
  useEffect(() => {
    const node = shelf.current;
    if (!node || activated) return;
    if (typeof IntersectionObserver === "undefined") {
      setSupportsObserver(false);
      setActivated(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setActivated(true);
          observer.disconnect();
        }
      },
      { rootMargin: "600px 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [activated]);
  useEffect(() => {
    if (!activated) return;
    page.current = 0;
    productsRef.current = [];
    setProducts([]);
    void load(true);
    return () => request.current?.abort();
  }, [activated, load]);
  useEffect(() => {
    const node = sentinel.current;
    if (!infinite || !node || !hasMore || loading || loadingMore || error) return;
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void load(false);
      },
      { rootMargin: "500px 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [error, hasMore, infinite, load, loading, loadingMore]);
  if (!activated || loading)
    return (
      <section ref={shelf} className={`section container intelligence-shelf ${className}`} aria-busy="true">
        <div className="section-heading">
          <h2>{title ?? sourceTitles[source]}</h2>
        </div>
        <div className="intelligence-skeleton" aria-label="Carregando recomendações">
          {Array.from({ length: Math.min(limit, 4) }, (_, index) => (
            <i aria-hidden="true" key={index} />
          ))}
        </div>
      </section>
    );
  if (error && !products.length)
    return (
      <section className={`section container intelligence-shelf ${className}`}>
        <div className="intelligence-empty">
          <Sparkles aria-hidden="true" />
          <h2>{title ?? sourceTitles[source]}</h2>
          <p>{error}</p>
          <button className="secondary-button" onClick={() => void load(true)}>
            <RefreshCw />
            Tentar novamente
          </button>
        </div>
      </section>
    );
  if (!products.length) return null;
  return (
    <section
      className={`section container intelligence-shelf ${className}`}
      aria-labelledby={`intelligence-${source}-title`}
    >
      <div className="section-heading">
        <div>
          <p className="eyebrow">Descoberta curti Z</p>
          <h2 id={`intelligence-${source}-title`}>{title ?? sourceTitles[source]}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
      </div>
      <div className="product-grid">
        {products.map((product) => (
          <ProductCard product={product} recommendationSource={source} key={storefrontItemKey(product)} />
        ))}
      </div>
      {infinite && (
        <div className="intelligence-sentinel" ref={sentinel}>
          {loadingMore && (
            <>
              <LoaderCircle className="spin" />
              Carregando mais estilos
            </>
          )}
          {!hasMore && <span>Você chegou ao fim desta seleção.</span>}
          {hasMore && !supportsObserver && !loadingMore && !error &&
            <button className="secondary-button" onClick={() => void load(false)}>Carregar mais estilos</button>}
          {error && (
            <button className="secondary-button" onClick={() => void load(false)}>
              <RefreshCw />
              Tentar novamente
            </button>
          )}
        </div>
      )}
    </section>
  );
}

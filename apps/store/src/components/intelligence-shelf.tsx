"use client";

import type { Product } from "@curtiz/domain";
import { LoaderCircle, RefreshCw, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { intelligenceSessionId, recentlyViewedProductIds } from "../lib/intelligence-client";
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
const isProduct = (value: unknown): value is Product =>
  Boolean(value) &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  typeof (value as Product).id === "string" &&
  typeof (value as Product).slug === "string" &&
  typeof (value as Product).name === "string";

export function IntelligenceShelf({
  source = "personalized",
  title,
  subtitle,
  limit = 8,
  category,
  infinite = false,
  className = ""
}: {
  source?: IntelligenceSource;
  title?: string;
  subtitle?: string;
  limit?: number;
  category?: string;
  infinite?: boolean;
  className?: string;
}) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [hasMore, setHasMore] = useState(true);
  const sentinel = useRef<HTMLDivElement>(null);
  const page = useRef(0);
  const request = useRef<AbortController | null>(null);
  const productsRef = useRef<Product[]>([]);
  const load = useCallback(
    async (reset = false) => {
      if (request.current) return;
      const controller = new AbortController();
      request.current = controller;
      if (reset) setLoading(true);
      else setLoadingMore(true);
      setError("");
      try {
        const seen = reset ? [] : productsRef.current.map((item) => item.id).slice(-50);
        const response = await fetch("/api/intelligence/recommendations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            source,
            sessionId: intelligenceSessionId(),
            category: category || null,
            seen,
            recent: source === "recently_viewed" ? recentlyViewedProductIds() : [],
            seed: `${new Date().toISOString().slice(0, 10)}:${page.current}`,
            limit
          }),
          signal: controller.signal,
          cache: "no-store"
        });
        const data: unknown = await response.json();
        if (
          !response.ok ||
          !data ||
          typeof data !== "object" ||
          !Array.isArray((data as { products?: unknown }).products)
        )
          throw new Error("Não foi possível carregar esta seleção.");
        const next = (data as { products: unknown[] }).products.filter(isProduct);
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
        setHasMore(next.length === limit && Boolean((data as { nextCursor?: unknown }).nextCursor));
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
    [category, limit, source]
  );
  useEffect(() => {
    page.current = 0;
    productsRef.current = [];
    setProducts([]);
    void load(true);
    return () => request.current?.abort();
  }, [load]);
  useEffect(() => {
    const node = sentinel.current;
    if (!infinite || !node || !hasMore || loading || loadingMore || error) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void load(false);
      },
      { rootMargin: "500px 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [error, hasMore, infinite, load, loading, loadingMore]);
  if (loading)
    return (
      <section className={`section container intelligence-shelf ${className}`} aria-busy="true">
        <div className="section-heading">
          <h2>{title ?? sourceTitles[source]}</h2>
        </div>
        <div className="intelligence-skeleton" aria-label="Carregando recomendações">
          {Array.from({ length: Math.min(limit, 4) }, (_, index) => (
            <i key={index} />
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
          <ProductCard product={product} recommendationSource={source} key={product.id} />
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

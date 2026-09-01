"use client";

import { formatBRL, storefrontItemKey, storefrontProductHref, type Product } from "@curtiz/domain";
import { Clock3, LoaderCircle, Search, X } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import React, {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from "react";
import type { CatalogResult, FacetOption } from "@/lib/catalog-query";
import {
  intelligenceSessionId,
  recentlyViewedProductIds,
  trackIntelligence
} from "../lib/intelligence-client";
import { normalizeSearchTerm, parseSearchHistory, rememberSearch } from "../lib/search-history";
import { hasConsentCategory } from "../lib/privacy/consent-client";

const recentSearchesKey = "curtiz-recent-searches";

type SearchOption =
  | { id: string; type: "product"; label: string; href: string; product: Product }
  | { id: string; type: "category"; label: string; href: string }
  | { id: string; type: "recent"; label: string; href: string }
  | { id: string; type: "recommendation"; label: string; href: string; product: Product };

type RecommendationResult = { products?: Product[] };

export function SearchAutocomplete({
  idPrefix,
  className = "",
  placeholder = "Qual pegada você vai curti?",
  autoFocus = false,
  onNavigate
}: {
  idPrefix: string;
  className?: string;
  placeholder?: string;
  autoFocus?: boolean;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const generatedId = useId();
  const listId = `${idPrefix}-${generatedId.replaceAll(":", "")}-suggestions`;
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<FacetOption[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [recommendations, setRecommendations] = useState<Product[]>([]);
  const [searchComplete, setSearchComplete] = useState(false);
  const [recommendationsLoading, setRecommendationsLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const requestSequence = useRef(0);

  useEffect(() => {
    const syncRecentSearches = () => {
      if (!hasConsentCategory("preferences")) {
        localStorage.removeItem(recentSearchesKey);
        setRecent([]);
        return;
      }
      try {
        const stored: unknown = JSON.parse(localStorage.getItem(recentSearchesKey) ?? "[]");
        setRecent(parseSearchHistory(stored));
      } catch {
        localStorage.removeItem(recentSearchesKey);
      }
    };
    syncRecentSearches();
    window.addEventListener("curtiz-consent-changed", syncRecentSearches);
    return () => window.removeEventListener("curtiz-consent-changed", syncRecentSearches);
  }, []);

  useEffect(() => {
    const normalized = normalizeSearchTerm(query);
    const needsEmptyFallback = focused && !normalized && recent.length === 0;
    const needsNoResultFallback =
      focused && normalized.length >= 2 && searchComplete && products.length === 0;
    if (!needsEmptyFallback && !needsNoResultFallback) return;

    const controller = new AbortController();
    const sessionId = intelligenceSessionId();
    const personalized = needsNoResultFallback && Boolean(sessionId);
    setRecommendationsLoading(true);
    const request = personalized
      ? fetch("/api/intelligence/recommendations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            source: "personalized",
            sessionId,
            recent: recentlyViewedProductIds(),
            seen: [],
            seed: normalized || "search-empty",
            limit: 3
          }),
          cache: "no-store",
          signal: controller.signal
        })
      : fetch("/api/intelligence/recommendations?source=most_wanted&limit=3&seed=search", {
          cache: "force-cache",
          signal: controller.signal
        });

    void request
      .then(async (response) => {
        if (!response.ok) throw new Error("recommendations_unavailable");
        return (await response.json()) as RecommendationResult;
      })
      .then((result) =>
        setRecommendations((result.products ?? []).filter((item) => item.stock > 0).slice(0, 3))
      )
      .catch(() => {
        if (!controller.signal.aborted) setRecommendations([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setRecommendationsLoading(false);
      });
    return () => controller.abort();
  }, [focused, products.length, query, recent.length, searchComplete]);

  useEffect(() => {
    const normalized = normalizeSearchTerm(query);
    if (normalized.length < 2) {
      setProducts([]);
      setCategories([]);
      setSearchComplete(false);
      setLoading(false);
      return;
    }
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setSearchComplete(false);
      setRecommendations([]);
      void fetch(`/api/catalog?q=${encodeURIComponent(normalized)}&pagina=1&limite=5&sugestoes=1`, {
        cache: "no-store",
        signal: controller.signal
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("search_unavailable");
          return (await response.json()) as CatalogResult;
        })
        .then((result) => {
          if (requestSequence.current !== sequence) return;
          setProducts(result.products.slice(0, 5));
          setCategories(result.facets.categories.slice(0, 3));
          setSearchComplete(true);
          trackIntelligence({ type: "search", query: normalized, resultCount: result.total });
          if (result.total === 0)
            trackIntelligence({ type: "search_no_results", query: normalized, resultCount: 0 });
        })
        .catch(() => {
          if (!controller.signal.aborted && requestSequence.current === sequence) {
            setProducts([]);
            setCategories([]);
            setSearchComplete(false);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted && requestSequence.current === sequence) {
            setLoading(false);
          }
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const options = useMemo<SearchOption[]>(() => {
    const normalized = normalizeSearchTerm(query);
    if (!normalized) {
      if (!recent.length) {
        return recommendations.map((product) => ({
          id: `recommendation-empty-${storefrontItemKey(product)}`,
          type: "recommendation" as const,
          label: product.name,
          href: storefrontProductHref(product),
          product
        }));
      }
      return recent.map((term) => ({
        id: `recent-${term}`,
        type: "recent",
        label: term,
        href: `/busca?q=${encodeURIComponent(term)}`
      }));
    }
    if (normalized.length < 2) return [];
    return [
      ...products.map((product) => ({
        id: `product-${storefrontItemKey(product)}`,
        type: "product" as const,
        label: product.name,
        href: storefrontProductHref(product),
        product
      })),
      ...categories.map((category) => ({
        id: `category-${category.value}`,
        type: "category" as const,
        label: category.label,
        href: `/produtos?categoria=${encodeURIComponent(category.value)}`
      })),
      ...(searchComplete && products.length === 0
        ? recommendations.map((product) => ({
            id: `recommendation-${storefrontItemKey(product)}`,
            type: "recommendation" as const,
            label: product.name,
            href: storefrontProductHref(product),
            product
          }))
        : [])
    ];
  }, [categories, products, query, recent, recommendations, searchComplete]);

  const saveRecent = (term: string) => {
    if (!hasConsentCategory("preferences")) return;
    const next = rememberSearch(recent, term);
    if (next.length === 0) return;
    setRecent(next);
    try {
      localStorage.setItem(recentSearchesKey, JSON.stringify(next));
    } catch {
      // A busca continua funcional quando o navegador bloqueia o armazenamento local.
    }
  };

  const removeRecent = (term: string) => {
    const next = recent.filter((item) => item !== term);
    setRecent(next);
    try {
      if (next.length) localStorage.setItem(recentSearchesKey, JSON.stringify(next));
      else localStorage.removeItem(recentSearchesKey);
    } catch {
      // A remoção permanece refletida na sessão atual.
    }
  };

  const navigate = (option: SearchOption) => {
    const normalizedQuery = normalizeSearchTerm(query);
    if (
      (option.type === "product" || option.type === "recommendation") &&
      normalizedQuery.length >= 2
    )
      trackIntelligence({
        type: "search_result_click",
        query: normalizedQuery,
        productId: option.product.id,
        variantId: option.product.variantId
      });
    if (option.type === "recent") saveRecent(option.label);
    else if (normalizedQuery.length >= 2) saveRecent(normalizedQuery);
    setFocused(false);
    onNavigate?.();
    router.push(option.href);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    const normalized = normalizeSearchTerm(query);
    if (!normalized) {
      event.preventDefault();
      return;
    }
    saveRecent(normalized);
    setFocused(false);
    onNavigate?.();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && options.length) {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % options.length);
    } else if (event.key === "ArrowUp" && options.length) {
      event.preventDefault();
      setActiveIndex((current) => (current <= 0 ? options.length - 1 : current - 1));
    } else if (event.key === "Enter" && activeIndex >= 0 && options[activeIndex]) {
      event.preventDefault();
      navigate(options[activeIndex]);
    } else if (event.key === "Escape") {
      setFocused(false);
      setActiveIndex(-1);
    }
  };

  const normalizedQuery = normalizeSearchTerm(query);
  const showPanel = focused;
  const emptyRecommendations = !normalizedQuery && recent.length === 0;
  const noResults = normalizedQuery.length >= 2 && searchComplete && products.length === 0;

  return (
    <div
      className={`search-autocomplete ${className}`.trim()}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setFocused(false);
          setActiveIndex(-1);
        }
      }}
    >
      <form className="search-form" action="/busca" role="search" onSubmit={submit}>
        <label className="sr-only" htmlFor={`${idPrefix}-search`}>
          Buscar produtos
        </label>
        <input
          id={`${idPrefix}-search`}
          name="q"
          type="search"
          placeholder={placeholder}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(-1);
          }}
          onKeyDown={handleKeyDown}
          autoComplete="off"
          autoFocus={autoFocus}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showPanel}
          aria-controls={listId}
          aria-activedescendant={activeIndex >= 0 ? options[activeIndex]?.id : undefined}
        />
        <button type="submit" aria-label="Buscar">
          {loading ? (
            <LoaderCircle className="spin" aria-hidden="true" />
          ) : (
            <Search aria-hidden="true" />
          )}
        </button>
      </form>

      {showPanel && (
        <div
          className="search-suggestions"
          id={listId}
          role="listbox"
          aria-label="Sugestões de busca"
        >
          <div className="search-suggestions-heading">
            <strong>
              {!normalizedQuery
                ? recent.length
                  ? "Buscas recentes"
                  : "Sugestões para você"
                : normalizedQuery.length < 2
                  ? "Continue digitando"
                  : loading
                    ? "Buscando produtos…"
                    : noResults
                      ? "Nenhum resultado exato"
                      : options.length
                        ? "Sugestões"
                        : "Busca indisponível"}
            </strong>
            {!loading && normalizedQuery.length >= 2 && !noResults ? (
              <span>{options.length} opções</span>
            ) : null}
            {noResults && recommendations.length ? <span>Você pode gostar de</span> : null}
          </div>
          {(emptyRecommendations || noResults) && recommendationsLoading ? (
            <p className="search-suggestions-status">
              <LoaderCircle className="spin" aria-hidden="true" /> Preparando sugestões
            </p>
          ) : null}
          {options.map((option, index) => (
            <div
              className={option.type === "recent" ? "search-history-row" : undefined}
              key={option.id}
            >
              <button
                id={option.id}
                className={activeIndex === index ? "search-suggestion active" : "search-suggestion"}
                type="button"
                role="option"
                aria-selected={activeIndex === index}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => navigate(option)}
              >
                {option.type === "product" || option.type === "recommendation" ? (
                  <Image src={option.product.image} alt="" width={56} height={44} />
                ) : (
                  <span className="search-suggestion-icon" aria-hidden="true">
                    {option.type === "recent" ? <Clock3 /> : <Search />}
                  </span>
                )}
                <span>
                  <strong>{option.label}</strong>
                  <small>
                    {option.type === "product" || option.type === "recommendation"
                      ? `${option.product.category} · ${formatBRL(option.product.priceInCents)}`
                      : option.type === "category"
                        ? "Categoria"
                        : "Buscar novamente"}
                  </small>
                </span>
              </button>
              {option.type === "recent" ? (
                <button
                  className="search-history-remove"
                  type="button"
                  aria-label={`Apagar pesquisa ${option.label}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => removeRecent(option.label)}
                >
                  <X aria-hidden="true" />
                </button>
              ) : null}
            </div>
          ))}
          {normalizedQuery.length === 1 ? (
            <p className="search-suggestions-status">
              Digite mais um caractere para ver resultados.
            </p>
          ) : null}
          {normalizedQuery.length >= 2 && (
            <button
              className="search-all-results"
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() =>
                navigate({
                  id: "all-results",
                  type: "recent",
                  label: normalizedQuery,
                  href: `/busca?q=${encodeURIComponent(normalizedQuery)}`
                })
              }
            >
              Ver todos os resultados para “{normalizedQuery}”
            </button>
          )}
        </div>
      )}
    </div>
  );
}

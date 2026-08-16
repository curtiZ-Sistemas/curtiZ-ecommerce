"use client";

import type { Product } from "@curtiz/domain";
import { Clock3, LoaderCircle, Search } from "lucide-react";
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

const recentSearchesKey = "curtiz-recent-searches";

type SearchOption =
  | { id: string; type: "product"; label: string; href: string; product: Product }
  | { id: string; type: "category"; label: string; href: string }
  | { id: string; type: "recent"; label: string; href: string };

export function SearchAutocomplete({
  idPrefix,
  className = "",
  placeholder = "Busque por produto, cor ou categoria",
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
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const requestSequence = useRef(0);

  useEffect(() => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(recentSearchesKey) ?? "[]");
      if (Array.isArray(stored)) {
        setRecent(stored.filter((item): item is string => typeof item === "string").slice(0, 5));
      }
    } catch {
      localStorage.removeItem(recentSearchesKey);
    }
  }, []);

  useEffect(() => {
    const normalized = query.trim();
    if (normalized.length < 2) {
      setProducts([]);
      setCategories([]);
      setLoading(false);
      return;
    }
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      void fetch(`/api/catalog?q=${encodeURIComponent(normalized)}&pagina=1`, {
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
        })
        .catch(() => {
          if (!controller.signal.aborted && requestSequence.current === sequence) {
            setProducts([]);
            setCategories([]);
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
    if (query.trim().length < 2) {
      return recent.map((term) => ({
        id: `recent-${term}`,
        type: "recent",
        label: term,
        href: `/busca?q=${encodeURIComponent(term)}`
      }));
    }
    return [
      ...products.map((product) => ({
        id: `product-${product.id}`,
        type: "product" as const,
        label: product.name,
        href: `/produto/${product.slug}`,
        product
      })),
      ...categories.map((category) => ({
        id: `category-${category.value}`,
        type: "category" as const,
        label: category.label,
        href: `/produtos?categoria=${encodeURIComponent(category.value)}`
      }))
    ];
  }, [categories, products, query, recent]);

  const saveRecent = (term: string) => {
    const normalized = term.trim();
    if (!normalized) return;
    const next = [normalized, ...recent.filter((item) => item !== normalized)].slice(0, 5);
    setRecent(next);
    localStorage.setItem(recentSearchesKey, JSON.stringify(next));
  };

  const navigate = (option: SearchOption) => {
    if (option.type !== "category") saveRecent(option.label);
    setFocused(false);
    onNavigate?.();
    router.push(option.href);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    const normalized = query.trim();
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

  const showPanel = focused && (query.trim().length >= 2 || recent.length > 0);

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
        {loading ? (
          <LoaderCircle className="spin" aria-hidden="true" />
        ) : (
          <Search aria-hidden="true" />
        )}
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
        <button type="submit">Buscar</button>
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
              {query.trim().length < 2
                ? "Buscas recentes"
                : loading
                  ? "Buscando produtos…"
                  : options.length
                    ? "Sugestões"
                    : "Nenhum resultado encontrado"}
            </strong>
            {!loading && query.trim().length >= 2 ? <span>{options.length} opções</span> : null}
            {!loading && query.trim().length < 2 && recent.length ? (
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setRecent([]);
                  localStorage.removeItem(recentSearchesKey);
                }}
              >
                Limpar
              </button>
            ) : null}
          </div>
          {options.map((option, index) => (
            <button
              id={option.id}
              className={activeIndex === index ? "search-suggestion active" : "search-suggestion"}
              type="button"
              role="option"
              aria-selected={activeIndex === index}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => navigate(option)}
              key={option.id}
            >
              {option.type === "product" ? (
                <Image src={option.product.image} alt="" width={56} height={44} />
              ) : (
                <span className="search-suggestion-icon" aria-hidden="true">
                  {option.type === "recent" ? <Clock3 /> : <Search />}
                </span>
              )}
              <span>
                <strong>{option.label}</strong>
                <small>
                  {option.type === "product"
                    ? option.product.category
                    : option.type === "category"
                      ? "Categoria"
                      : "Buscar novamente"}
                </small>
              </span>
            </button>
          ))}
          {query.trim().length >= 2 && (
            <button
              className="search-all-results"
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() =>
                navigate({
                  id: "all-results",
                  type: "recent",
                  label: query.trim(),
                  href: `/busca?q=${encodeURIComponent(query.trim())}`
                })
              }
            >
              Ver todos os resultados para “{query.trim()}”
            </button>
          )}
        </div>
      )}
    </div>
  );
}

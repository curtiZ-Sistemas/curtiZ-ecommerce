"use client";

import { formatBRL } from "@curtiz/domain";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  RotateCcw,
  SlidersHorizontal,
  X
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  type ChangeEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  parseCatalogFilters,
  type CatalogFacets,
  type CatalogResult,
  type FacetOption
} from "@/lib/catalog-query";
import { ProductCard } from "./product-card";

const emptyFacets: CatalogFacets = {
  categories: [],
  collections: [],
  colors: [],
  sizes: [],
  price: { min: 0, max: 0 },
  promotionCount: 0,
  inStockCount: 0,
  newestCount: 0
};

const sortOptions = [
  ["relevant", "Mais relevantes"],
  ["newest", "Mais recentes"],
  ["best_sellers", "Mais vendidos"],
  ["rating", "Melhor avaliados"],
  ["price_asc", "Menor preço"],
  ["price_desc", "Maior preço"],
  ["discount", "Maior desconto"],
  ["name_asc", "Nome A–Z"],
  ["name_desc", "Nome Z–A"]
] as const;

const colorSwatches: Record<string, string> = {
  preto: "#171717",
  branco: "#f7f7f5",
  marinho: "#18294a",
  coral: "#d96b55",
  rosa: "#e994b3",
  areia: "#d8c2a5",
  caramelo: "#a96e45",
  bege: "#d8c7ae",
  azul: "#3c70ad"
};

export function CatalogPage({
  title,
  description,
  category,
  query,
  preset
}: {
  title: string;
  description: string;
  category?: string;
  query?: string;
  preset?: "promotion" | "newest" | "best_sellers";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [result, setResult] = useState<CatalogResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const filters = useMemo(() => {
    const parsed = parseCatalogFilters(searchParams, category);
    if (preset === "best_sellers" && !searchParams.has("ordem")) {
      return { ...parsed, sort: "best_sellers" as const };
    }
    return parsed;
  }, [category, preset, searchParams]);
  const [priceMinDraft, setPriceMinDraft] = useState(
    filters.priceMin === undefined ? "" : String(filters.priceMin / 100)
  );
  const [priceMaxDraft, setPriceMaxDraft] = useState(
    filters.priceMax === undefined ? "" : String(filters.priceMax / 100)
  );

  useEffect(() => {
    setPriceMinDraft(filters.priceMin === undefined ? "" : String(filters.priceMin / 100));
    setPriceMaxDraft(filters.priceMax === undefined ? "" : String(filters.priceMax / 100));
  }, [filters.priceMax, filters.priceMin]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams(searchParams.toString());
    if (category) params.set("categoria_fixa", category);
    if (query && !params.has("q")) params.set("q", query);
    if (preset === "promotion") params.set("promocao", "1");
    if (preset === "newest") params.set("novidades", "1");
    if (preset === "best_sellers" && !params.has("ordem")) params.set("ordem", "best_sellers");
    setLoading(true);
    setError("");
    void fetch(`/api/catalog?${params.toString()}`, {
      cache: "no-store",
      signal: controller.signal
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("catalog_unavailable");
        return (await response.json()) as CatalogResult;
      })
      .then(setResult)
      .catch(() => {
        if (!controller.signal.aborted) {
          setError("Não foi possível carregar os produtos. Tente novamente.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [category, preset, query, searchParams]);

  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      triggerRef.current?.focus();
    };
  }, [mobileOpen]);

  const updateUrl = (change: (params: URLSearchParams) => void, preservePage = false) => {
    const next = new URLSearchParams(searchParams.toString());
    change(next);
    if (!preservePage) next.delete("pagina");
    router.replace(`${pathname}${next.size ? `?${next.toString()}` : ""}`, { scroll: false });
  };

  const setFlag = (name: string, checked: boolean) =>
    updateUrl((params) => {
      if (checked) params.set(name, "1");
      else params.delete(name);
    });

  const setSingle = (name: string, value: string) =>
    updateUrl((params) => {
      if (value) params.set(name, value);
      else params.delete(name);
    });

  const toggleList = (name: "cores" | "tamanhos", value: string) =>
    updateUrl((params) => {
      const current = new Set(
        (params.get(name) ?? "").split(",").map((item) => item.trim()).filter(Boolean)
      );
      if (current.has(value)) current.delete(value);
      else current.add(value);
      const values = [...current];
      if (values.length) params.set(name, values.join(","));
      else params.delete(name);
    });

  const applyPrice = () =>
    updateUrl((params) => {
      const minimum = Number(priceMinDraft.replace(",", "."));
      const maximum = Number(priceMaxDraft.replace(",", "."));
      if (priceMinDraft && Number.isFinite(minimum) && minimum >= 0) {
        params.set("preco_min", String(minimum));
      } else {
        params.delete("preco_min");
      }
      if (priceMaxDraft && Number.isFinite(maximum) && maximum >= 0) {
        params.set("preco_max", String(maximum));
      } else {
        params.delete("preco_max");
      }
    });

  const reset = () =>
    updateUrl((params) => {
      [
        "categoria",
        "colecao",
        "cores",
        "tamanhos",
        "preco_min",
        "preco_max",
        "promocao",
        "estoque",
        "novidades",
        "avaliacao"
      ].forEach((name) => params.delete(name));
    });

  const activeFilters = [
    !category && filters.category,
    filters.collection,
    ...filters.colors,
    ...filters.sizes,
    filters.priceMin !== undefined,
    filters.priceMax !== undefined,
    filters.promotion,
    filters.inStock,
    filters.newest,
    filters.minRating !== undefined
  ].filter(Boolean).length;
  const facets = result?.facets ?? emptyFacets;
  const products = result?.products ?? [];
  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;

  const filterContent = (mobile = false) => (
    <div className={mobile ? "filter-content mobile" : "filter-content"}>
      {!category && facets.categories.length > 0 && (
        <FilterSection title="Categoria" initiallyOpen>
          <RadioOptions
            options={facets.categories}
            value={filters.category ?? ""}
            name={mobile ? "mobile-category" : "desktop-category"}
            onChange={(value) => setSingle("categoria", value)}
          />
        </FilterSection>
      )}
      {facets.collections.length > 0 && (
        <FilterSection title="Coleção">
          <RadioOptions
            options={facets.collections}
            value={filters.collection ?? ""}
            name={mobile ? "mobile-collection" : "desktop-collection"}
            onChange={(value) => setSingle("colecao", value)}
          />
        </FilterSection>
      )}
      {facets.colors.length > 0 && (
        <FilterSection title="Cor" initiallyOpen>
          <div className="filter-option-list color-filter-list">
            {facets.colors.map((option) => (
              <label key={option.value}>
                <input
                  type="checkbox"
                  checked={filters.colors.includes(option.value)}
                  onChange={() => toggleList("cores", option.value)}
                />
                <i
                  className="color-swatch"
                  style={{
                    background:
                      option.hex ??
                      colorSwatches[option.value.toLocaleLowerCase("pt-BR")] ??
                      "#dedbd5"
                  }}
                  aria-hidden="true"
                />
                <span>{option.label}</span><small>{option.count}</small>
              </label>
            ))}
          </div>
        </FilterSection>
      )}
      {facets.sizes.length > 0 && (
        <FilterSection title="Tamanho" initiallyOpen>
          <div className="filter-size-grid">
            {facets.sizes.map((option) => (
              <label
                className={filters.sizes.includes(option.value) ? "selected" : ""}
                key={option.value}
              >
                <input
                  type="checkbox"
                  checked={filters.sizes.includes(option.value)}
                  onChange={() => toggleList("tamanhos", option.value)}
                />
                <span>{option.label}</span><small>{option.count}</small>
              </label>
            ))}
          </div>
        </FilterSection>
      )}
      {facets.price.max > 0 && (
        <FilterSection title="Faixa de preço" initiallyOpen>
          <div className="price-filter-fields">
            <label>
              <span>Mínimo</span>
              <div><i>R$</i><input
                type="number"
                min="0"
                step="1"
                inputMode="decimal"
                value={priceMinDraft}
                onChange={(event) => setPriceMinDraft(event.target.value)}
                placeholder={String(Math.floor(facets.price.min / 100))}
              /></div>
            </label>
            <label>
              <span>Máximo</span>
              <div><i>R$</i><input
                type="number"
                min="0"
                step="1"
                inputMode="decimal"
                value={priceMaxDraft}
                onChange={(event) => setPriceMaxDraft(event.target.value)}
                placeholder={String(Math.ceil(facets.price.max / 100))}
              /></div>
            </label>
          </div>
          <button className="secondary-button compact-button price-apply" type="button" onClick={applyPrice}>
            Aplicar preço
          </button>
        </FilterSection>
      )}
      {(facets.inStockCount > 0 || facets.newestCount > 0 || facets.promotionCount > 0) && (
        <FilterSection title="Disponibilidade" initiallyOpen>
          <div className="filter-option-list">
            {facets.inStockCount > 0 && (
              <FilterCheckbox
                label="Em estoque"
                count={facets.inStockCount}
                checked={filters.inStock}
                onChange={(checked) => setFlag("estoque", checked)}
              />
            )}
            {facets.newestCount > 0 && (
              <FilterCheckbox
                label="Lançamentos"
                count={facets.newestCount}
                checked={filters.newest}
                onChange={(checked) => setFlag("novidades", checked)}
              />
            )}
            {facets.promotionCount > 0 && (
              <FilterCheckbox
                label="Em promoção"
                count={facets.promotionCount}
                checked={filters.promotion}
                onChange={(checked) => setFlag("promocao", checked)}
              />
            )}
          </div>
        </FilterSection>
      )}
      <FilterSection title="Avaliação">
        <div className="filter-option-list">
          {[4.5, 4, 3].map((rating) => (
            <label key={rating}>
              <input
                type="radio"
                name={mobile ? "mobile-rating" : "desktop-rating"}
                checked={filters.minRating === rating}
                onChange={() => setSingle("avaliacao", String(rating))}
              />
              <span>{rating.toLocaleString("pt-BR")} estrelas ou mais</span>
            </label>
          ))}
        </div>
      </FilterSection>
    </div>
  );

  return (
    <div className="container page-shell catalog-page">
      <header className="section-heading catalog-heading">
        <div>
          <p className="eyebrow">Catálogo Curtiz</p>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </header>

      <div className="catalog-mobile-actions">
        <button
          ref={triggerRef}
          className="secondary-button"
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-haspopup="dialog"
        >
          <SlidersHorizontal /> Filtrar
          {activeFilters > 0 && <span>{activeFilters}</span>}
        </button>
        <SortSelect
          value={filters.sort}
          promotionAvailable={facets.promotionCount > 0}
          onChange={(value) => setSingle("ordem", value === "relevant" ? "" : value)}
          compact
        />
        <output aria-live="polite">{result?.total ?? 0} resultados</output>
      </div>

      {mobileOpen && (
        <div className="filter-drawer-layer">
          <button
            className="filter-drawer-backdrop"
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Fechar filtros"
          />
          <section
            className="filter-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mobile-filter-title"
          >
            <header>
              <div>
                <p className="eyebrow">Refine sua busca</p>
                <h2 id="mobile-filter-title">Filtros</h2>
              </div>
              <button ref={closeRef} type="button" onClick={() => setMobileOpen(false)} aria-label="Fechar">
                <X />
              </button>
            </header>
            <div className="filter-drawer-scroll">{filterContent(true)}</div>
            <footer>
              <button className="secondary-button" type="button" onClick={reset} disabled={!activeFilters}>
                Limpar
              </button>
              <button className="primary-button" type="button" onClick={() => setMobileOpen(false)}>
                Ver {result?.total ?? 0} produtos
              </button>
            </footer>
          </section>
        </div>
      )}

      <div className="catalog-layout">
        <aside className="filter-panel" aria-label="Filtros do catálogo">
          <div className="filter-panel-heading">
            <div><h2>Filtros</h2><span>{result?.total ?? 0} produtos</span></div>
            {activeFilters > 0 && <button type="button" onClick={reset}><RotateCcw /> Limpar</button>}
          </div>
          {filterContent()}
        </aside>

        <section className="catalog-results" aria-live="polite" aria-busy={loading}>
          <div className="catalog-results-bar">
            <span>
              <strong>{result?.total ?? 0}</strong>{" "}
              {(result?.total ?? 0) === 1 ? "produto encontrado" : "produtos encontrados"}
            </span>
            <SortSelect
              value={filters.sort}
              promotionAvailable={facets.promotionCount > 0}
              onChange={(value) => setSingle("ordem", value === "relevant" ? "" : value)}
            />
          </div>

          {activeFilters > 0 && (
            <div className="active-filter-list" aria-label="Filtros ativos">
              {!category && filters.category && (
                <FilterChip label={filters.category} onRemove={() => setSingle("categoria", "")} />
              )}
              {filters.collection && (
                <FilterChip label={filters.collection} onRemove={() => setSingle("colecao", "")} />
              )}
              {filters.colors.map((color) => (
                <FilterChip key={color} label={color} onRemove={() => toggleList("cores", color)} />
              ))}
              {filters.sizes.map((size) => (
                <FilterChip key={size} label={`Tamanho ${size}`} onRemove={() => toggleList("tamanhos", size)} />
              ))}
              {filters.priceMin !== undefined && (
                <FilterChip label={`A partir de ${formatBRL(filters.priceMin)}`} onRemove={() => setSingle("preco_min", "")} />
              )}
              {filters.priceMax !== undefined && (
                <FilterChip label={`Até ${formatBRL(filters.priceMax)}`} onRemove={() => setSingle("preco_max", "")} />
              )}
              {filters.promotion && <FilterChip label="Em promoção" onRemove={() => setFlag("promocao", false)} />}
              {filters.inStock && <FilterChip label="Em estoque" onRemove={() => setFlag("estoque", false)} />}
              {filters.newest && <FilterChip label="Lançamentos" onRemove={() => setFlag("novidades", false)} />}
              {filters.minRating !== undefined && (
                <FilterChip label={`${filters.minRating}+ estrelas`} onRemove={() => setSingle("avaliacao", "")} />
              )}
              <button className="clear-active-filters" type="button" onClick={reset}>Limpar todos</button>
            </div>
          )}

          {loading ? (
            <CatalogSkeleton />
          ) : error ? (
            <div className="empty-state catalog-empty" role="alert">
              <SlidersHorizontal />
              <h2>Não foi possível carregar o catálogo</h2>
              <p>{error}</p>
              <button className="secondary-button" type="button" onClick={() => router.refresh()}>
                Tentar novamente
              </button>
            </div>
          ) : products.length ? (
            <>
              <div className="product-grid">
                {products.map((product) => <ProductCard product={product} key={product.id} />)}
              </div>
              {totalPages > 1 && (
                <nav className="catalog-pagination" aria-label="Paginação do catálogo">
                  <button
                    type="button"
                    disabled={filters.page <= 1}
                    onClick={() => updateUrl((params) => params.set("pagina", String(filters.page - 1)), true)}
                  >
                    <ArrowLeft /> Anterior
                  </button>
                  <span>Página {filters.page} de {totalPages}</span>
                  <button
                    type="button"
                    disabled={filters.page >= totalPages}
                    onClick={() => updateUrl((params) => params.set("pagina", String(filters.page + 1)), true)}
                  >
                    Próxima <ArrowRight />
                  </button>
                </nav>
              )}
            </>
          ) : (
            <div className="empty-state catalog-empty">
              <SlidersHorizontal />
              <h2>Nenhum produto encontrado com esses filtros.</h2>
              <p>Remova um filtro ou limpe a seleção para visualizar outras opções.</p>
              <div className="empty-state-actions">
                <button className="primary-button" type="button" onClick={reset}>Limpar filtros</button>
                <button className="secondary-button" type="button" onClick={() => router.back()}>Voltar</button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function FilterSection({
  title,
  initiallyOpen = false,
  children
}: {
  title: string;
  initiallyOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="filter-section" open={initiallyOpen}>
      <summary>{title}<ChevronDown aria-hidden="true" /></summary>
      <div>{children}</div>
    </details>
  );
}

function FilterCheckbox({
  label,
  count,
  checked,
  onChange
}: {
  label: string;
  count: number;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span><small>{count}</small>
    </label>
  );
}

function RadioOptions({
  options,
  value,
  name,
  onChange
}: {
  options: FacetOption[];
  value: string;
  name: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="filter-option-list">
      <label>
        <input type="radio" name={name} checked={!value} onChange={() => onChange("")} />
        <span>Todas</span>
      </label>
      {options.map((option) => (
        <label key={option.value}>
          <input
            type="radio"
            name={name}
            checked={value === option.value || value === option.label}
            onChange={() => onChange(option.value)}
          />
          <span>{option.label}</span><small>{option.count}</small>
        </label>
      ))}
    </div>
  );
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return <button type="button" onClick={onRemove}>{label}<X aria-hidden="true" /></button>;
}

function SortSelect({
  value,
  promotionAvailable,
  onChange,
  compact = false
}: {
  value: string;
  promotionAvailable: boolean;
  onChange: (value: string) => void;
  compact?: boolean;
}) {
  return (
    <label className={compact ? "sort-control compact" : "sort-control"}>
      {!compact && <span>Ordenar por</span>}
      <select
        value={value}
        onChange={(event: ChangeEvent<HTMLSelectElement>) => onChange(event.target.value)}
        aria-label="Ordenar produtos"
      >
        {sortOptions
          .filter(([option]) => option !== "discount" || promotionAvailable)
          .map(([option, label]) => <option value={option} key={option}>{label}</option>)}
      </select>
    </label>
  );
}

function CatalogSkeleton() {
  return (
    <div className="product-grid catalog-skeleton" aria-label="Carregando produtos">
      {Array.from({ length: 8 }, (_, index) => (
        <div className="product-card" key={index}>
          <div className="skeleton skeleton-product-image" />
          <div className="product-card-body">
            <div className="skeleton skeleton-line short" />
            <div className="skeleton skeleton-line" />
            <div className="skeleton skeleton-line short" />
          </div>
        </div>
      ))}
    </div>
  );
}

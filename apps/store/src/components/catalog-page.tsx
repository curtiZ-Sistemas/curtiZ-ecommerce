"use client";

import type { Product } from "@curtiz/domain";
import { RotateCcw, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import { ProductCard } from "./product-card";
import { demoProducts } from "@/lib/catalog";

type Sort = "relevant" | "newest" | "low" | "high";

export function CatalogPage({
  title,
  description,
  category,
  query
}: {
  title: string;
  description: string;
  category?: string;
  query?: string;
}) {
  const [sort, setSort] = useState<Sort>("relevant");
  const [promotion, setPromotion] = useState(false);
  const [available, setAvailable] = useState(false);
  const [newest, setNewest] = useState(false);
  const [sizes, setSizes] = useState<string[]>([]);

  const products = useMemo<Product[]>(() => {
    const normalizedQuery = query?.trim().toLocaleLowerCase("pt-BR");
    const filtered = demoProducts.filter((product) => {
      if (category && product.category.toLocaleLowerCase("pt-BR") !== category.toLocaleLowerCase("pt-BR")) {
        return false;
      }
      if (
        normalizedQuery &&
        !`${product.name} ${product.category} ${product.colors.join(" ")}`
          .toLocaleLowerCase("pt-BR")
          .includes(normalizedQuery)
      ) {
        return false;
      }
      if (promotion && !product.compareAtPriceInCents) return false;
      if (available && product.stock <= 0) return false;
      if (newest && !product.featured) return false;
      if (sizes.length && !sizes.some((size) => product.sizes.includes(size))) return false;
      return true;
    });

    return [...filtered].sort((first, second) => {
      if (sort === "low") return first.priceInCents - second.priceInCents;
      if (sort === "high") return second.priceInCents - first.priceInCents;
      if (sort === "newest") return Number(Boolean(second.featured)) - Number(Boolean(first.featured));
      return Number(Boolean(second.featured)) - Number(Boolean(first.featured));
    });
  }, [available, category, newest, promotion, query, sizes, sort]);

  const activeFilters = Number(promotion) + Number(available) + Number(newest) + sizes.length;

  const reset = () => {
    setPromotion(false);
    setAvailable(false);
    setNewest(false);
    setSizes([]);
  };

  const filters = (
    <>
      <div className="filter-panel-heading">
        <h2>Filtrar produtos</h2>
        {activeFilters > 0 && (
          <button type="button" onClick={reset}><RotateCcw /> Limpar</button>
        )}
      </div>
      <fieldset>
        <legend>Disponibilidade</legend>
        <label><input type="checkbox" checked={promotion} onChange={(event) => setPromotion(event.target.checked)} /> Em promoção</label>
        <label><input type="checkbox" checked={available} onChange={(event) => setAvailable(event.target.checked)} /> Em estoque</label>
        <label><input type="checkbox" checked={newest} onChange={(event) => setNewest(event.target.checked)} /> Lançamentos</label>
      </fieldset>
      <fieldset>
        <legend>Tamanhos</legend>
        <div className="filter-size-grid">
          {["33/34", "35/36", "37/38", "39/40", "41/42"].map((size) => (
            <label className={sizes.includes(size) ? "selected" : ""} key={size}>
              <input
                type="checkbox"
                checked={sizes.includes(size)}
                onChange={(event) =>
                  setSizes((current) =>
                    event.target.checked
                      ? [...current, size]
                      : current.filter((item) => item !== size)
                  )
                }
              />
              {size}
            </label>
          ))}
        </div>
      </fieldset>
    </>
  );

  return (
    <div className="container page-shell catalog-page">
      <div className="section-heading catalog-heading">
        <div>
          <p className="eyebrow">Catálogo Curtiz</p>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        <label className="sort-control">
          <span>Ordenar por</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
            <option value="relevant">Mais relevantes</option>
            <option value="newest">Lançamentos</option>
            <option value="low">Menor preço</option>
            <option value="high">Maior preço</option>
          </select>
        </label>
      </div>

      <details className="mobile-filter-panel">
        <summary><SlidersHorizontal /> Filtros {activeFilters > 0 && <span>{activeFilters}</span>}</summary>
        <div>{filters}</div>
      </details>

      <div className="catalog-layout">
        <aside className="filter-panel">{filters}</aside>
        <section className="catalog-results" aria-live="polite">
          <div className="catalog-results-bar">
            <span>{products.length} {products.length === 1 ? "produto" : "produtos"}</span>
            {activeFilters > 0 && <span>{activeFilters} {activeFilters === 1 ? "filtro ativo" : "filtros ativos"}</span>}
          </div>
          {products.length ? (
            <div className="product-grid">
              {products.map((product) => <ProductCard product={product} key={product.id} />)}
            </div>
          ) : (
            <div className="empty-state catalog-empty">
              <SlidersHorizontal />
              <h2>Nenhum produto encontrado</h2>
              <p>Tente remover alguns filtros ou buscar por outro termo.</p>
              <button className="secondary-button" type="button" onClick={reset}>Limpar filtros</button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

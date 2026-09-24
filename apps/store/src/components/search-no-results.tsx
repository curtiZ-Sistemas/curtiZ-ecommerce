import type { Product } from "@curtiz/domain";
import Link from "next/link";
import { ProductCard } from "./product-card";

export function shouldHideEmptyCatalogFilters(total: number | undefined, activeFilters: number, loading: boolean) {
  return total === 0 && activeFilters === 0 && !loading;
}

export function SearchNoResults({ searchTerm, suggestions, loading, loaded }: {
  searchTerm: string;
  suggestions: Product[];
  loading: boolean;
  loaded: boolean;
}) {
  const uniqueSuggestions = suggestions.filter((product, index, all) =>
    all.findIndex((item) => item.id === product.id) === index
  ).slice(0, 6);
  return (
    <div className="catalog-discovery">
      <div className="search-no-results-intro">
        <h1>Não encontramos resultados para “{searchTerm}”</h1>
        <p>Tente outro termo ou confira algumas opções escolhidas para você.</p>
        <Link className="secondary-button" href="/produtos">Ver todos os produtos</Link>
      </div>
      <section className="search-no-results-recommendations" aria-labelledby="search-suggestions-title">
        <div className="section-heading">
          <div>
            <h2 id="search-suggestions-title">Talvez você curta</h2>
          </div>
        </div>
        {(!loaded || loading) && (
          <div className="search-recommendation-skeleton" role="status" aria-label="Carregando sugestões">
            {Array.from({ length: 6 }, (_, index) => <i key={index} aria-hidden="true" />)}
          </div>
        )}
        {loaded && uniqueSuggestions.length > 0 && (
          <div className="product-grid">
            {uniqueSuggestions.map((product) => (
              <ProductCard key={product.id} product={product} recommendationSource="search_no_results" />
            ))}
          </div>
        )}
        {loaded && !uniqueSuggestions.length && (
          <p className="search-recommendations-unavailable">Explore o catálogo para encontrar seu próximo par.</p>
        )}
      </section>
    </div>
  );
}

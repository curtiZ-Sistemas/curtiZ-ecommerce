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
  return (
    <div className="catalog-discovery">
      <div className="search-no-results-intro">
        <p className="eyebrow">Sua busca na curti Z</p>
        <h2>Não encontramos “{searchTerm}”</h2>
        <p>Não encontramos um produto com esse termo. Veja outras opções da loja para continuar descobrindo.</p>
        <Link href="/produtos">Ver todos os produtos</Link>
      </div>
      <section className="search-no-results-recommendations" aria-labelledby="search-suggestions-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Descubra algo novo</p>
            <h3 id="search-suggestions-title">Selecionados para você</h3>
          </div>
        </div>
        {(!loaded || loading) && (
          <div className="search-recommendation-skeleton" role="status" aria-label="Carregando sugestões">
            {Array.from({ length: 6 }, (_, index) => <i key={index} aria-hidden="true" />)}
          </div>
        )}
        {loaded && suggestions.length > 0 && (
          <div className="product-grid">
            {suggestions.map((product) => (
              <ProductCard key={product.id} product={product} recommendationSource="search_no_results" />
            ))}
          </div>
        )}
        {loaded && !suggestions.length && (
          <p className="search-recommendations-unavailable">Explore o catálogo para encontrar seu próximo par.</p>
        )}
      </section>
    </div>
  );
}

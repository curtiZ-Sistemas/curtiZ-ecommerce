"use client";

import { storefrontItemKey, type Product } from "@curtiz/domain";
import { useEffect, useState } from "react";
import { fetchPublicCatalog, publicCatalogUrl } from "@/lib/public-catalog-client";
import { ProductCard } from "./product-card";

type RecommendationState =
  | { status: "loading"; products: Product[] }
  | { status: "ready"; products: Product[] }
  | { status: "unavailable"; products: Product[] };

export function ErrorRecommendations({ excludeProductId }: { excludeProductId?: string }) {
  const [state, setState] = useState<RecommendationState>({
    status: "loading",
    products: []
  });

  useEffect(() => {
    const controller = new AbortController();
    const url = publicCatalogUrl({ ordem: "best_sellers", limite: "4" });

    void fetchPublicCatalog(url, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        const products = result
          .filter((product) => product.id !== excludeProductId && product.stock > 0)
          .filter((product, index, list) =>
            list.findIndex((candidate) => candidate.id === product.id) === index
          )
          .slice(0, 4);
        setState({ status: "ready", products });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setState({ status: "unavailable", products: [] });
        }
      });

    return () => controller.abort();
  }, [excludeProductId]);

  if (state.status === "unavailable" || (state.status === "ready" && !state.products.length)) {
    return null;
  }

  return (
    <section className="error-recommendations" aria-labelledby="error-recommendations-title">
      <div className="error-recommendations-heading">
        <p className="eyebrow">Continue explorando</p>
        <h2 id="error-recommendations-title">Produtos que podem te interessar</h2>
        <p>Selecionamos algumas opções disponíveis na curti Z.</p>
      </div>

      {state.status === "loading" ? (
        <div
          className="error-recommendation-grid error-recommendation-skeletons"
          aria-label="Carregando produtos sugeridos"
          aria-busy="true"
        >
          {[0, 1, 2, 3].map((item) => (
            <div className="product-card" key={item}>
              <div className="skeleton error-recommendation-image" />
              <div className="product-card-body">
                <div className="skeleton skeleton-line" />
                <div className="skeleton skeleton-line short" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="error-recommendation-grid">
          {state.products.map((product) => (
            <ProductCard
              product={product}
              display={{ rating: false, installments: false }}
              imageSizes="(max-width: 700px) 66vw, (max-width: 1000px) 33vw, 280px"
              key={storefrontItemKey(product)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

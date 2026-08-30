"use client";

import type { CartLine, Product } from "@curtiz/domain";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchPublicCatalog, publicCatalogUrl } from "@/lib/public-catalog-client";
import { ProductCard } from "./product-card";

type RecommendationState =
  | { status: "loading"; products: Product[] }
  | { status: "success"; products: Product[] }
  | { status: "error"; products: Product[] };

export function CartRecommendations({ lines }: { lines: CartLine[] }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [reload, setReload] = useState(0);
  const [state, setState] = useState<RecommendationState>({
    status: "loading",
    products: []
  });
  const productKey = useMemo(
    () => [...new Set(lines.map((line) => line.productId))].sort().join(","),
    [lines]
  );
  const categoryKey = useMemo(
    () =>
      [...new Set(lines.flatMap((line) => (line.category ? [line.category] : [])))]
        .slice(0, 2)
        .join(","),
    [lines]
  );

  useEffect(() => {
    const controller = new AbortController();
    const category = categoryKey ? categoryKey.split(",")[0] : undefined;
    const urls = [
      ...(category
        ? [publicCatalogUrl({ categoria_fixa: category, ordem: "best_sellers", limite: "8" })]
        : []),
      publicCatalogUrl({ ordem: "best_sellers", limite: "8" })
    ];
    const excluded = new Set(productKey.split(",").filter(Boolean));
    setState({ status: "loading", products: [] });

    void (async () => {
      const unique = new Map<string, Product>();
      let successfulRequests = 0;
      for (const url of urls) {
        try {
          const products = await fetchPublicCatalog(url, controller.signal);
          successfulRequests += 1;
          for (const product of products) {
            if (!excluded.has(product.id) && product.stock > 0 && !unique.has(product.id)) {
              unique.set(product.id, product);
            }
          }
          if (unique.size >= 8) break;
        } catch {
          if (controller.signal.aborted) return;
        }
      }
      if (controller.signal.aborted) return;
      if (successfulRequests === 0) {
        setState({ status: "error", products: [] });
      } else {
        setState({ status: "success", products: [...unique.values()].slice(0, 8) });
      }
    })();

    return () => controller.abort();
  }, [categoryKey, productKey, reload]);

  const scrollRecommendations = (direction: -1 | 1) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    scroller.scrollBy({
      left: direction * scroller.clientWidth,
      behavior: reduceMotion ? "auto" : "smooth"
    });
  };

  return (
    <section className="cart-recommendations" aria-labelledby="cart-recommendations-title">
      <div className="cart-recommendations-heading">
        <div>
          <p className="eyebrow">Complete sua seleção</p>
          <h2 id="cart-recommendations-title">Você também pode gostar</h2>
        </div>
        {state.status === "success" && state.products.length > 4 ? (
          <div className="cart-recommendation-controls" aria-label="Navegar pelas recomendações">
            <button
              type="button"
              aria-label="Ver produtos anteriores"
              onClick={() => scrollRecommendations(-1)}
            >
              <ArrowLeft aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Ver próximos produtos"
              onClick={() => scrollRecommendations(1)}
            >
              <ArrowRight aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </div>

      {state.status === "loading" ? (
        <div
          className="cart-recommendation-grid cart-recommendation-skeletons"
          aria-label="Carregando recomendações"
          aria-busy="true"
        >
          {[0, 1, 2, 3].map((item) => (
            <div className="product-card" key={item}>
              <div className="skeleton cart-recommendation-image" />
              <div className="product-card-body">
                <div className="skeleton skeleton-line" />
                <div className="skeleton skeleton-line short" />
              </div>
            </div>
          ))}
        </div>
      ) : state.status === "error" ? (
        <div className="cart-recommendations-state" role="status">
          <span>Não foi possível carregar as sugestões agora.</span>
          <button type="button" onClick={() => setReload((current) => current + 1)}>
            Tentar novamente
          </button>
        </div>
      ) : state.products.length > 0 ? (
        <div className="cart-recommendation-grid" ref={scrollerRef}>
          {state.products.map((product) => (
            <ProductCard
              product={product}
              display={{ rating: false, installments: false }}
              imageSizes="(max-width: 700px) 62vw, (max-width: 1100px) 32vw, 230px"
              key={product.id}
            />
          ))}
        </div>
      ) : (
        <p className="cart-recommendations-state" role="status">
          Não há outras sugestões disponíveis no momento.
        </p>
      )}
    </section>
  );
}

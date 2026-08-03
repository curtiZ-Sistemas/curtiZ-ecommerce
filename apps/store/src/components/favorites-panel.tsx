"use client";

import { Heart } from "lucide-react";
import Link from "next/link";
import { ProductCard } from "./product-card";
import { useFavorites } from "./favorites-provider";

export function FavoritesPanel() {
  const { hydrated, products } = useFavorites();

  if (!hydrated) {
    return (
      <div className="favorites-grid" aria-busy="true" aria-label="Carregando favoritos">
        {[0, 1].map((item) => (
          <div className="product-card favorite-skeleton" key={item}>
            <div className="skeleton skeleton-product-image" />
            <div className="product-card-body">
              <div className="skeleton skeleton-line" />
              <div className="skeleton skeleton-line short" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!products.length) {
    return (
      <div className="empty-state">
        <Heart aria-hidden="true" />
        <h2>Nenhum favorito salvo</h2>
        <p>Use o coração nos produtos para guardar os modelos que você quer rever.</p>
        <Link className="primary-button" href="/produtos">
          Explorar produtos
        </Link>
      </div>
    );
  }

  return (
    <section aria-labelledby="favorites-title">
      <div className="section-heading compact-section-heading">
        <div>
          <h2 id="favorites-title">Seus favoritos</h2>
          <p>
            {products.length} {products.length === 1 ? "produto salvo" : "produtos salvos"}
          </p>
        </div>
      </div>
      <div className="favorites-grid">
        {products.map((product) => (
          <ProductCard product={product} key={product.id} />
        ))}
      </div>
    </section>
  );
}

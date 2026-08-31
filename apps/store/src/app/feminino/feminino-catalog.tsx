"use client";

import dynamic from "next/dynamic";
import Link from "next/link";

const DeferredCatalogPage = dynamic(
  () => import("@/components/catalog-page").then((module) => module.CatalogPage),
  {
    ssr: false,
    loading: () => <FemininoCatalogFallback />
  }
);

export function FemininoCatalog({ description }: { description: string }) {
  return (
    <DeferredCatalogPage
      title="Chinelos e sandálias femininas"
      description={description}
      category="Feminino"
    />
  );
}

export function FemininoCatalogFallback() {
  return (
    <div className="container page-shell catalog-page">
      <nav className="breadcrumbs" aria-label="Navegação estrutural">
        <Link href="/">curti Z</Link>
        <span>/</span>
        <span>Chinelos e sandálias femininas</span>
      </nav>
      <header className="section-heading catalog-heading">
        <div>
          <p className="eyebrow">Catálogo curti Z</p>
          <h1>Chinelos e sandálias femininas</h1>
          <p>
            Descubra chinelos e sandálias femininas curti Z com leveza, cores atuais e conforto
            para acompanhar sua rotina.
          </p>
        </div>
      </header>

      <div className="catalog-layout">
        <aside className="filter-panel" aria-hidden="true" />
        <section className="catalog-results" aria-busy="true">
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
        </section>
      </div>
    </div>
  );
}

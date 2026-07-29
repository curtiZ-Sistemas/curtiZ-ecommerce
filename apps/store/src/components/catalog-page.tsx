import { ProductCard } from "./product-card";
import { demoProducts } from "@/lib/catalog";

export function CatalogPage({
  title,
  description,
  category
}: {
  title: string;
  description: string;
  category?: string;
}) {
  const products = category
    ? demoProducts.filter((product) => product.category.toLowerCase() === category.toLowerCase())
    : demoProducts;

  return (
    <div className="container page-shell">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Catálogo Curtiz</p>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        <select aria-label="Ordenar produtos" defaultValue="relevant">
          <option value="relevant">Mais relevantes</option>
          <option value="newest">Lançamentos</option>
          <option value="low">Menor preço</option>
          <option value="high">Maior preço</option>
        </select>
      </div>
      <div className="catalog-layout">
        <aside className="filter-panel">
          <h2>Filtros</h2>
          {["Em promoção", "Disponível", "Lançamento"].map((filter) => (
            <label key={filter}>
              <input type="checkbox" /> {filter}
            </label>
          ))}
          <h2>Tamanhos</h2>
          {["33/34", "35/36", "37/38", "39/40", "41/42"].map((size) => (
            <label key={size}>
              <input type="checkbox" /> {size}
            </label>
          ))}
        </aside>
        <div className="product-grid">
          {products.map((product) => (
            <ProductCard product={product} key={product.id} />
          ))}
        </div>
      </div>
    </div>
  );
}

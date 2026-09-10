import type { Metadata } from "next";
import { Star } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { IntelligenceShelf } from "@/components/intelligence-shelf";
import { JsonLd } from "@/components/json-ld";
import { ProductPurchase } from "@/components/product-purchase";
import {
  productBreadcrumbStructuredData,
  productCategoryPath,
  productMetadata,
  productStructuredData
} from "@/lib/seo";
import { getPublicProduct } from "@/lib/storefront-data";
import { parseProductDescription } from "@/lib/product-description";

export async function generateMetadata({
  params
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const detail = await getPublicProduct(slug);
  if (!detail) notFound();
  return productMetadata(detail);
}

export default async function ProductPage({
  params,
  searchParams
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ variant?: string }>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const detail = await getPublicProduct(slug);
  if (!detail) notFound();
  const { product } = detail;
  const categoryPath = productCategoryPath(product.category);

  return (
    <div className="container page-shell product-page">
      <JsonLd data={productStructuredData(detail, query.variant)} />
      <JsonLd data={productBreadcrumbStructuredData(product)} />
      <nav className="breadcrumbs" aria-label="Navegação estrutural">
        <Link href="/">curti Z</Link> / <Link href={categoryPath}>{product.category}</Link> /{" "}
        <span>{product.name}</span>
      </nav>

      <ProductPurchase detail={detail} initialVariantId={query.variant} />

      <section className="product-information">
        <p className="eyebrow">Sobre o Produto</p>
        {detail.sizeGuide.length ? (
          <div className="product-size-guide" aria-labelledby="product-size-guide-title">
            <h2 id="product-size-guide-title">Guia de tamanhos</h2>
            <div>
              <table>
                <thead><tr><th scope="col">Tamanho</th><th scope="col">Medida</th></tr></thead>
                <tbody>{detail.sizeGuide.map((entry) => (
                  <tr key={entry.size}><th scope="row">{entry.size}</th><td>{entry.measurementCm.toLocaleString("pt-BR")} cm</td></tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        ) : null}
        <div className="product-description-section">
          <h2>Detalhes de {product.name}</h2>
          <div className="product-description-content">
            {parseProductDescription(product.description).map((block, index) =>
              block.type === "list" ? (
                <ul key={`list-${index}`}>{block.items.map((item, itemIndex) => <li key={`${index}-${itemIndex}`}>{item}</li>)}</ul>
              ) : <p key={`paragraph-${index}`}>{block.text}</p>
            )}
          </div>
        </div>
      </section>

      {detail.reviews.length > 0 && (
        <section className="section product-reviews" aria-labelledby="product-reviews-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Experiências Publicadas</p>
              <h2 id="product-reviews-title">Avaliações do Produto</h2>
            </div>
          </div>
          <div className="product-review-grid">
            {detail.reviews.map((review) => (
              <article key={review.id}>
                <div className="rating" aria-label={`${review.rating} de 5 estrelas`}>
                  <Star fill="currentColor" />
                  <strong>{review.rating}</strong>
                  {review.verified && <span>Compra verificada</span>}
                </div>
                {review.title && <h3>{review.title}</h3>}
                <p>{review.content}</p>
                <small>
                  {new Intl.DateTimeFormat("pt-BR", {
                    day: "2-digit",
                    month: "long",
                    year: "numeric",
                    timeZone: "America/Sao_Paulo"
                  }).format(new Date(review.createdAt))}
                </small>
              </article>
            ))}
          </div>
        </section>
      )}

      <IntelligenceShelf
        source="personalized"
        title="Você Também Pode Gostar"
        limit={8}
        category={product.category}
        excludeProductIds={[product.id]}
        className="product-recommendations"
      />
    </div>
  );
}

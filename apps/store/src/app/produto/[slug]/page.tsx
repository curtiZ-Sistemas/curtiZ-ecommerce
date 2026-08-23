import type { Metadata } from "next";
import { Star } from "lucide-react";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { IntelligenceShelf } from "@/components/intelligence-shelf";
import { ProductPurchase } from "@/components/product-purchase";
import { getPublicProduct } from "@/lib/storefront-data";

const productDescription = "Detalhes, variações e disponibilidade dos produtos curti Z.";

export async function generateMetadata({
  params
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const detail = await getPublicProduct(slug);
  if (!detail) notFound();
  const url = `/produto/${encodeURIComponent(slug)}`;
  const title = detail.product.name;
  const description = detail.product.description || productDescription;
  const image = detail.gallery[0]?.src;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      ...(image ? { images: [{ url: image, alt: title }] } : {})
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title,
      description,
      ...(image ? { images: [image] } : {})
    }
  };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const [{ slug }, requestHeaders] = await Promise.all([params, headers()]);
  const detail = await getPublicProduct(slug);
  if (!detail) notFound();
  const { product } = detail;
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description,
    image: detail.gallery.map((image) => image.src),
    brand: { "@type": "Brand", name: "curti Z" },
    offers: {
      "@type": "Offer",
      priceCurrency: "BRL",
      price: (product.priceInCents / 100).toFixed(2),
      availability:
        product.stock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock"
    },
    ...(product.reviews > 0
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: product.rating,
            reviewCount: product.reviews
          }
        }
      : {})
  };

  return (
    <div className="container page-shell product-page">
      <script
        type="application/ld+json"
        nonce={requestHeaders.get("x-nonce") ?? undefined}
        suppressHydrationWarning
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, "\\u003c")
        }}
      />
      <script
        type="application/ld+json"
        nonce={requestHeaders.get("x-nonce") ?? undefined}
        suppressHydrationWarning
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Início", item: "/" },
              { "@type": "ListItem", position: 2, name: "Produtos", item: "/produtos" },
              { "@type": "ListItem", position: 3, name: product.name, item: `/produto/${product.slug}` }
            ]
          }).replace(/</g, "\\u003c")
        }}
      />
      <nav className="breadcrumbs" aria-label="Navegação estrutural">
        <Link href="/">Início</Link> / <Link href="/produtos">Produtos</Link> /{" "}
        <span>{product.name}</span>
      </nav>

      <ProductPurchase detail={detail} />

      <section className="product-information">
        <div>
          <p className="eyebrow">Sobre o Produto</p>
          <h2>Detalhes de {product.name}</h2>
          <p>{product.description}</p>
        </div>
        {detail.specifications.length > 0 && (
          <dl>
            {detail.specifications.map((specification) => (
              <div key={specification.label}>
                <dt>{specification.label}</dt>
                <dd>{specification.value}</dd>
              </div>
            ))}
          </dl>
        )}
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

import type { Metadata } from "next";
import { Star } from "lucide-react";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ProductCard } from "@/components/product-card";
import { ProductPurchase } from "@/components/product-purchase";
import { getPublicProduct, queryPublicCatalog } from "@/lib/storefront-data";

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
  const relatedResult = await queryPublicCatalog({
    category: product.category,
    sort: "best_sellers",
    pageSize: 5
  }).catch((error: unknown) => {
    console.error(
      "[product-page] N\u00e3o foi poss\u00edvel carregar produtos relacionados.",
      error instanceof Error ? error.message : "Erro desconhecido."
    );
    return null;
  });
  const related = (relatedResult?.products ?? [])
    .filter((item) => item.id !== product.id)
    .slice(0, 4);

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
          <p className="eyebrow">Sobre o produto</p>
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
              <p className="eyebrow">Experiências publicadas</p>
              <h2 id="product-reviews-title">Avaliações deste produto</h2>
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

      {related.length > 0 && (
        <section className="section product-recommendations">
          <div className="section-heading">
            <h2>Você também pode gostar</h2>
          </div>
          <div className="product-grid">
            {related.map((item) => (
              <ProductCard product={item} key={item.id} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

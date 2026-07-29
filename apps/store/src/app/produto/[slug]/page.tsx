import type { Metadata } from "next";
import { formatBRL } from "@curtiz/domain";
import { PackageCheck, ShieldCheck, Star } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AddToCart } from "@/components/add-to-cart";
import { ProductCard } from "@/components/product-card";
import { demoProducts, findProduct } from "@/lib/catalog";

export async function generateMetadata({
  params
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const product = findProduct((await params).slug);
  if (!product) return {};
  return {
    title: product.name,
    description: product.description,
    alternates: { canonical: `/produto/${product.slug}` }
  };
}

export function generateStaticParams() {
  return demoProducts.map((product) => ({ slug: product.slug }));
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const product = findProduct((await params).slug);
  if (!product) notFound();

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description,
    image: product.image,
    brand: { "@type": "Brand", name: "Curtiz" },
    offers: {
      "@type": "Offer",
      priceCurrency: "BRL",
      price: (product.priceInCents / 100).toFixed(2),
      availability: "https://schema.org/InStock"
    },
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: product.rating,
      reviewCount: product.reviews
    }
  };

  return (
    <div className="container page-shell">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }}
      />
      <nav className="breadcrumbs" aria-label="Navegação estrutural">
        <Link href="/">Início</Link> / <Link href="/produtos">Produtos</Link> /{" "}
        <span>{product.name}</span>
      </nav>
      <section className="product-detail">
        <div className="product-gallery">
          <Image src={product.image} alt={product.name} width={720} height={560} priority />
        </div>
        <div className="product-summary">
          <p className="eyebrow">{product.category}</p>
          <h1>{product.name}</h1>
          <div className="rating">
            <Star fill="currentColor" />
            <strong>{product.rating}</strong>
            <span>({product.reviews.toLocaleString("pt-BR")} avaliações)</span>
          </div>
          <p className="product-description">{product.description}</p>
          <p className="product-price">
            <strong>{formatBRL(product.priceInCents)}</strong>
          </p>
          <span className="installments">ou 6x sem juros • 5% de desconto no Pix</span>
          <AddToCart product={product} />
          <div className="benefits-grid" style={{ gridTemplateColumns: "1fr 1fr", marginTop: 24 }}>
            <div className="benefit">
              <PackageCheck />
              <div>
                <strong>Em estoque</strong>
                <span>Prazo calculado pelo CEP.</span>
              </div>
            </div>
            <div className="benefit">
              <ShieldCheck />
              <div>
                <strong>Compra segura</strong>
                <span>Valores validados no servidor.</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-heading">
          <h2>Você também pode gostar</h2>
        </div>
        <div className="product-grid">
          {demoProducts
            .filter((item) => item.id !== product.id)
            .slice(0, 4)
            .map((item) => (
              <ProductCard product={item} key={item.id} />
            ))}
        </div>
      </section>
    </div>
  );
}

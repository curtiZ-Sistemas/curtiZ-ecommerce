"use client";

import { formatBRL, type Product } from "@curtiz/domain";
import { Heart, Star } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useFavorites } from "./favorites-provider";

export function ProductCard({ product }: { product: Product }) {
  const { hydrated, has, toggle } = useFavorites();
  const favorite = hydrated && has(product.id);
  const discount = product.compareAtPriceInCents
    ? Math.round((1 - product.priceInCents / product.compareAtPriceInCents) * 100)
    : null;

  return (
    <article className="product-card">
      <Link href={`/produto/${product.slug}`} className="product-image">
        {discount && <span className="discount-badge">-{discount}%</span>}
        <Image
          src={product.image}
          alt={product.name}
          width={360}
          height={280}
          sizes="(max-width: 520px) 50vw, (max-width: 900px) 33vw, 25vw"
        />
      </Link>
      <button
        className={favorite ? "favorite-button active" : "favorite-button"}
        type="button"
        onClick={() => toggle(product.id)}
        aria-label={
          favorite ? `Remover ${product.name} dos favoritos` : `Favoritar ${product.name}`
        }
        aria-pressed={favorite}
      >
        <Heart fill={favorite ? "currentColor" : "none"} />
      </button>
      <div className="product-card-body">
        <p className="eyebrow">{product.category}</p>
        <h3>
          <Link href={`/produto/${product.slug}`}>{product.name}</Link>
        </h3>
        <div
          className="rating"
          aria-label={`${product.rating} de 5, ${product.reviews} avaliações`}
        >
          <Star fill="currentColor" />
          <strong>{product.rating}</strong>
          <span>({product.reviews.toLocaleString("pt-BR")})</span>
        </div>
        <div className="price-row">
          <strong>{formatBRL(product.priceInCents)}</strong>
          {product.compareAtPriceInCents && <s>{formatBRL(product.compareAtPriceInCents)}</s>}
        </div>
        <span className="installments">ou 6x sem juros</span>
      </div>
    </article>
  );
}

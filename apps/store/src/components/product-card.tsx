"use client";

import { formatBRL, type Product } from "@curtiz/domain";
import { Heart, Star } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useFavorites } from "./favorites-provider";

export function ProductCard({
  product,
  priority = false,
  display
}: {
  product: Product;
  priority?: boolean;
  display?: {
    price?: boolean;
    rating?: boolean;
    discount?: boolean;
    installments?: boolean;
    favorite?: boolean;
    stock?: boolean;
    badge?: boolean;
    purchase?: boolean;
  };
}) {
  const { hydrated, has, toggle } = useFavorites();
  const favorite = hydrated && has(product.id);
  const unavailable = product.stock <= 0;
  const discount = product.compareAtPriceInCents
    ? Math.round((1 - product.priceInCents / product.compareAtPriceInCents) * 100)
    : null;

  return (
    <article className={unavailable ? "product-card product-card-unavailable" : "product-card"}>
      <Link href={`/produto/${product.slug}`} className="product-image" aria-label={`Ver ${product.name}`}>
        {display?.discount !== false && display?.badge !== false && discount && <span className="discount-badge">-{discount}%</span>}
        {display?.badge !== false && unavailable && <span className="availability-badge">Indisponível</span>}
        <Image
          src={product.image}
          alt={product.name}
          width={360}
          height={280}
          sizes="(max-width: 520px) 46vw, (max-width: 900px) 31vw, (max-width: 1400px) 24vw, 320px"
          priority={priority}
        />
      </Link>
      {display?.favorite !== false && <button
        className={favorite ? "favorite-button active" : "favorite-button"}
        type="button"
        onClick={() => toggle(product)}
        aria-label={
          favorite ? `Remover ${product.name} dos favoritos` : `Favoritar ${product.name}`
        }
        aria-pressed={favorite}
      >
        <Heart fill={favorite ? "currentColor" : "none"} />
      </button>}
      <div className="product-card-body">
        <p className="eyebrow">{product.category}</p>
        <h3>
          <Link href={`/produto/${product.slug}`}>{product.name}</Link>
        </h3>
        {display?.rating !== false && <div
          className="rating"
          aria-label={`${product.rating} de 5, ${product.reviews} avaliações`}
        >
          <Star fill="currentColor" />
          <strong>{product.rating}</strong>
          <span>({product.reviews.toLocaleString("pt-BR")})</span>
        </div>}
        {display?.price !== false && <div className="price-row">
          <strong>{formatBRL(product.priceInCents)}</strong>
          {display?.discount !== false && product.compareAtPriceInCents && <s>{formatBRL(product.compareAtPriceInCents)}</s>}
        </div>}
        {unavailable && <span className="product-unavailable-copy">Indisponível no momento</span>}
        {display?.installments !== false && <span className="installments">Consulte as condições no produto</span>}
        {display?.stock && <span className="product-card-stock">{product.stock.toLocaleString("pt-BR")} unidade(s) disponível(is)</span>}
        {display?.purchase && <Link className="secondary-button compact-button" href={`/produto/${product.slug}`}>Ver opções</Link>}
      </div>
    </article>
  );
}

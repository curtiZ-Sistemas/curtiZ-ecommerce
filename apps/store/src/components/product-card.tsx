"use client";

import {
  formatBRL,
  storefrontItemKey,
  storefrontProductHref,
  type Product
} from "@curtiz/domain";
import { Heart, Star } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useMemo, useRef } from "react";
import { useFavorites } from "./favorites-provider";
import { trackIntelligence } from "../lib/intelligence-client";
import { useQualifiedImpression } from "../lib/use-qualified-impression";
import { bundledProductSrcSet } from "../lib/responsive-storefront-image";

export function ProductCard({
  product,
  priority = false,
  display,
  imageSizes,
  recommendationSource
}: {
  product: Product;
  priority?: boolean;
  imageSizes?: string;
  recommendationSource?: string;
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
  const cardRef = useRef<HTMLElement>(null);
  const itemKey = storefrontItemKey(product);
  const href = storefrontProductHref(product);
  const responsiveImage = bundledProductSrcSet(product.image);
  const responsiveSizes = imageSizes ?? "(max-width: 520px) 50vw, (max-width: 900px) 33vw, 25vw";
  const impression = useMemo(() => ({ type: recommendationSource ? "recommendation_impression" as const : "product_impression" as const, productId: product.id, variantId: product.variantId, source: recommendationSource }), [product.id, product.variantId, recommendationSource]);
  useQualifiedImpression(cardRef, `${recommendationSource ?? "catalog"}:${itemKey}`, impression);
  const favorite = hydrated && has(product);
  const discount = product.compareAtPriceInCents
    ? Math.round((1 - product.priceInCents / product.compareAtPriceInCents) * 100)
    : null;

  return (
    <article className="product-card" ref={cardRef}>
      <Link href={href} prefetch={priority ? null : false} className="product-image" onClick={() => { if (recommendationSource) trackIntelligence({ type: "recommendation_click", productId: product.id, variantId: product.variantId, source: recommendationSource }); }}>
        {display?.discount !== false && display?.badge !== false && discount && <span className="discount-badge">-{discount}%</span>}
        {responsiveImage ? (
          <picture>
            <source type="image/webp" srcSet={responsiveImage} sizes={responsiveSizes} />
            <img
              src={product.image}
              srcSet={responsiveImage}
              sizes={responsiveSizes}
              alt={`${product.name} da curti Z`}
              width={720}
              height={720}
              loading={priority ? "eager" : "lazy"}
              fetchPriority={priority ? "high" : "auto"}
              decoding="async"
            />
          </picture>
        ) : (
          <Image
            src={product.image}
            alt={`${product.name} da curti Z`}
            width={360}
            height={280}
            sizes={responsiveSizes}
            priority={priority}
          />
        )}
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
          <Link href={href} prefetch={priority ? null : false} onClick={() => { if (recommendationSource) trackIntelligence({ type: "recommendation_click", productId: product.id, variantId: product.variantId, source: recommendationSource }); }}>{product.name}</Link>
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
        {display?.installments !== false && <span className="installments">Consulte as condições no produto</span>}
        {display?.stock && <span className="product-card-stock">{product.stock.toLocaleString("pt-BR")} unidade(s) disponível(is)</span>}
        {display?.purchase && <Link className="secondary-button compact-button" href={href} prefetch={priority ? null : false}>Ver opções</Link>}
      </div>
    </article>
  );
}

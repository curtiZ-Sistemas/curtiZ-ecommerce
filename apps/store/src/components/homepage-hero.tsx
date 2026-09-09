"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Product } from "@curtiz/domain";
import type { PublicBanner } from "@/lib/storefront-data";
import { bundledProductSrcSet } from "../lib/responsive-storefront-image";

/** One campaign at a time; remaining campaigns appear below the catalog. */
export function HomepageHero({ banners, product, secondary = false }: {
  banners: PublicBanner[];
  product?: Product;
  secondary?: boolean;
}) {
  const banner = banners[0];
  const [failed, setFailed] = useState(false);
  const [mobileViewport, setMobileViewport] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 700px)");
    const update = () => setMobileViewport(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  if (!banner) return null;
  const href = mobileViewport && banner.mobileHref !== undefined ? banner.mobileHref : banner.href;
  const useProduct = !secondary && product && (failed || banner.desktopImage.startsWith("/images/hero-curtiz-"));
  const desktop = useProduct ? product.image : banner.desktopImage;
  const mobile = useProduct ? product.image : banner.mobileImage;
  const picture = (
    <picture className="campaign-picture">
      <source media="(max-width: 700px)" srcSet={useProduct ? bundledProductSrcSet(mobile) ?? mobile : mobile} sizes="100vw" />
      <img src={desktop} alt={useProduct ? product.name : banner.altText}
        width={useProduct ? 720 : 2172} height={useProduct ? 720 : 724}
        srcSet={useProduct ? bundledProductSrcSet(desktop) ?? undefined : undefined}
        sizes="(max-width: 700px) 100vw, 60vw"
        loading={secondary ? "lazy" : "eager"} fetchPriority={secondary ? "auto" : "high"}
        decoding="async" onError={() => setFailed(true)} />
    </picture>
  );
  return (
    <section className={secondary ? "homepage-campaign container" : "homepage-hero container"}
      data-testid={secondary ? "homepage-secondary-campaign" : "homepage-primary-hero"}
      aria-label={secondary ? banner.title : "Encontre sua pegada"}>
      {!secondary && <div className="hero-copy">
        <p className="eyebrow">Chinelos e sandálias · curti Z</p>
        <h1>Qual pegada você vai curti hoje?</h1>
        <p>Chinelos para acompanhar o seu estilo, do seu jeito.</p>
        <div className="hero-actions">
          <Link href="/produtos" className="primary-button" data-home-item={`${banner.id}:catalog`}>Encontrar minha pegada <ArrowRight aria-hidden="true" /></Link>
          <Link href="/lancamentos" className="hero-secondary" data-home-item={`${banner.id}:newest`}>Ver novidades <span aria-hidden="true">→</span></Link>
        </div>
      </div>}
      {href ? <Link className="campaign-image-link" href={href} prefetch={false} data-home-item={banner.id}
        aria-label={banner.title} target={banner.openNewTab ? "_blank" : undefined}
        rel={banner.openNewTab ? "noopener noreferrer" : undefined}>{picture}</Link> : picture}
    </section>
  );
}

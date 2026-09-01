"use client";

import { ArrowLeft, ArrowRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { PublicBanner } from "@/lib/storefront-data";

const bundledHero = (path: string, viewport: "desktop" | "mobile") => {
  if (!path.startsWith(`/images/hero-curtiz-${viewport}`)) return null;
  return {
    avif: `/images/hero-curtiz-${viewport}.avif`,
    webp: `/images/hero-curtiz-${viewport}.webp`
  };
};

export function HomepageHero({ banners }: { banners: PublicBanner[] }) {
  const slides = banners.slice(0, 4);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [failedBannerIds, setFailedBannerIds] = useState<Set<string>>(
    () => new Set()
  );
  const pointerStart = useRef<number | null>(null);

  useEffect(() => {
    if (
      slides.length < 2 ||
      paused ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    const timer = window.setInterval(() => {
      setActive((current) => (current + 1) % slides.length);
    }, 6000);

    return () => window.clearInterval(timer);
  }, [paused, slides.length]);

  if (!slides.length) {
    return null;
  }

  const banner = slides[Math.min(active, slides.length - 1)]!;
  const useFallbackImage = failedBannerIds.has(banner.id);
  const desktopImage = useFallbackImage
    ? "/images/hero-curtiz-desktop.webp"
    : banner.desktopImage;
  const mobileImage = useFallbackImage
    ? "/images/hero-curtiz-mobile.webp"
    : banner.mobileImage;
  const bundledDesktop = bundledHero(desktopImage, "desktop");
  const bundledMobile = bundledHero(mobileImage, "mobile");

  const go = (direction: number) => {
    setPaused(true);
    setActive(
      (current) =>
        (current + direction + slides.length) % slides.length
    );
  };

  const picture = (
    <picture className="hero-picture">
      {bundledMobile ? (
        <source media="(max-width: 700px)" type="image/avif" srcSet={bundledMobile.avif} />
      ) : null}
      <source
        media="(max-width: 700px)"
        srcSet={bundledMobile?.webp ?? mobileImage}
        sizes="calc(100vw - 24px)"
        width={941}
        height={1672}
      />
      {bundledDesktop ? <source type="image/avif" srcSet={bundledDesktop.avif} /> : null}
      <img
        src={bundledDesktop?.webp ?? desktopImage}
        width={2172}
        height={724}
        sizes="(max-width: 1280px) calc(100vw - 32px), 1200px"
        className="hero-media"
        alt={banner.altText}
        fetchPriority={active === 0 ? "high" : "auto"}
        loading={active === 0 ? "eager" : "lazy"}
        decoding="async"
        onError={() => {
          if (useFallbackImage) return;
          setFailedBannerIds((current) => new Set(current).add(banner.id));
        }}
      />
    </picture>
  );

  return (
    <section
      className="hero container homepage-hero"
      data-testid="homepage-primary-hero"
      aria-label="Destaques da curti Z"
      onPointerDown={(event) => { pointerStart.current = event.clientX; setPaused(true); }}
      onPointerUp={(event) => {
        if (pointerStart.current === null) return;
        const distance = event.clientX - pointerStart.current;
        pointerStart.current = null;
        if (Math.abs(distance) >= 40) go(distance > 0 ? -1 : 1);
      }}
    >
      <h1 className="sr-only">{banner.title}</h1>

      {banner.href ? <Link className="hero-link" href={banner.href} aria-label={banner.title} target={banner.openNewTab ? "_blank" : undefined} rel={banner.openNewTab ? "noopener noreferrer" : undefined}>{picture}</Link> : <div className="hero-link">{picture}</div>}

      {slides.length > 1 && (
        <div
          className="hero-carousel-controls"
          aria-label="Controles dos banners"
        >
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label="Banner anterior"
          >
            <ArrowLeft />
          </button>

          <div role="tablist" aria-label="Escolher banner">
            {slides.map((slide, index) => (
              <button
                type="button"
                role="tab"
                aria-selected={active === index}
                aria-label={`Exibir banner ${index + 1}: ${slide.title}`}
                onClick={() => { setPaused(true); setActive(index); }}
                key={slide.id}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={() => go(1)}
            aria-label="Próximo banner"
          >
            <ArrowRight />
          </button>
        </div>
      )}
    </section>
  );
}

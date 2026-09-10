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
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(preference.matches);
    update();
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);
  const [mobileViewport, setMobileViewport] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 700px)");
    const update = () => setMobileViewport(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const [failedBannerIds, setFailedBannerIds] = useState<Set<string>>(
    () => new Set()
  );
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);

  useEffect(() => {
    setActive((current) => slides.length ? current % slides.length : 0);
  }, [slides.length]);

  useEffect(() => {
    if (
      slides.length < 2 ||
      reducedMotion
    ) {
      return;
    }

    const timer = window.setInterval(() => {
      setActive((current) => (current + 1) % slides.length);
    }, 3000);

    return () => window.clearInterval(timer);
  }, [slides.length, reducedMotion]);

  if (!slides.length) {
    return null;
  }

  const banner = slides[Math.min(active, slides.length - 1)]!;
  const href = mobileViewport && banner.mobileHref !== undefined ? banner.mobileHref : banner.href;
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
    setActive(
      (current) =>
        (current + direction + slides.length) % slides.length
    );
  };

  const picture = (
    <picture className="hero-picture">
      {bundledMobile ? (
        <source media="(max-width: 700px)" type="image/avif" srcSet={`/images/optimized/hero-mobile.430.avif 430w, /images/optimized/hero-mobile.640.avif 640w, ${bundledMobile.avif} 941w`} sizes="calc(100vw - 24px)" />
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
      aria-roledescription="carrossel"
      onPointerCancel={() => { pointerStart.current = null; }}
      onPointerDown={(event) => {
        if (!mobileViewport || (event.target as HTMLElement).closest("button")) return;
        pointerStart.current = { x: event.clientX, y: event.clientY };
      }}
      onPointerUp={(event) => {
        const start = pointerStart.current;
        if (!start) return;
        const distance = event.clientX - start.x;
        const verticalDistance = event.clientY - start.y;
        pointerStart.current = null;
        if (Math.abs(distance) >= 40 && Math.abs(distance) > Math.abs(verticalDistance)) {
          swiped.current = true;
          go(distance > 0 ? -1 : 1);
          window.setTimeout(() => { swiped.current = false; }, 0);
        }
      }}
      onClickCapture={(event) => {
        if (!swiped.current) return;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <h1 className="sr-only">{banner.title}</h1>

      {href ? <Link className="hero-link" href={href} prefetch={false} aria-label={banner.title} target={banner.openNewTab ? "_blank" : undefined} rel={banner.openNewTab ? "noopener noreferrer" : undefined}>{picture}</Link> : <div className="hero-link">{picture}</div>}

      {slides.length > 1 && (
        <div
          className="hero-carousel-controls"
          aria-label="Controles dos banners"
        >
          <button
            className="hero-carousel-arrow hero-carousel-arrow-previous"
            type="button"
            onClick={() => go(-1)}
            aria-label="Banner anterior"
          >
            <ArrowLeft />
          </button>

          <div role="group" aria-label="Escolher banner">
            {slides.map((slide, index) => (
              <button
                type="button"
                className="hero-dot"
                aria-pressed={active === index}
                aria-label={`Exibir banner ${index + 1}: ${slide.title}`}
                onClick={() => setActive(index)}
                key={slide.id}
              />
            ))}
          </div>

          <button
            className="hero-carousel-arrow hero-carousel-arrow-next"
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

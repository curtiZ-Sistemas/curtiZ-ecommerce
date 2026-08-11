"use client";

import { ArrowLeft, ArrowRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { PublicBanner } from "@/lib/storefront-data";

export function HomepageHero({ banners }: { banners: PublicBanner[] }) {
  const slides = banners.slice(0, 4);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
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

  const go = (direction: number) => {
    setPaused(true);
    setActive(
      (current) =>
        (current + direction + slides.length) % slides.length
    );
  };

  const picture = (
    <picture className="hero-picture" key={banner.id}>
      <source media="(max-width: 700px)" srcSet={banner.mobileImage} />
      <img className="hero-media" src={banner.desktopImage} alt={banner.altText} width={1600} height={560} fetchPriority="high" decoding="async" />
    </picture>
  );

  return (
    <section
      className="hero container homepage-hero"
      aria-label="Destaques da curti Z"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false);
      }}
      onPointerDown={(event) => { pointerStart.current = event.clientX; setPaused(true); }}
      onPointerUp={(event) => {
        if (pointerStart.current === null) return;
        const distance = event.clientX - pointerStart.current;
        pointerStart.current = null;
        if (Math.abs(distance) >= 40) go(distance > 0 ? -1 : 1);
      }}
      onPointerCancel={() => { pointerStart.current = null; }}
    >
      <h1 className="sr-only">{banner.title}</h1>
      <p className="sr-only" aria-live="polite">Banner {active + 1} de {slides.length}: {banner.title}</p>

      {banner.href ? <Link className="hero-link hero-slide" href={banner.href} aria-label={banner.title} target={banner.openNewTab ? "_blank" : undefined} rel={banner.openNewTab ? "noopener noreferrer" : undefined}>{picture}</Link> : <div className="hero-link hero-slide">{picture}</div>}

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

          <span className="hero-slide-count" aria-hidden="true">
            {String(active + 1).padStart(2, "0")} / {String(slides.length).padStart(2, "0")}
          </span>

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

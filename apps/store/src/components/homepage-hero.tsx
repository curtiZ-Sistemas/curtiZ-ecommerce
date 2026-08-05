"use client";

import { ArrowLeft, ArrowRight } from "lucide-react";
import Link from "next/link";
import React, { useEffect, useState } from "react";

import type { PublicBanner } from "@/lib/storefront-data";

export function HomepageHero({ banners }: { banners: PublicBanner[] }) {
  const slides = banners.slice(0, 4);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (
      slides.length < 2 ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    const timer = window.setInterval(() => {
      setActive((current) => (current + 1) % slides.length);
    }, 6000);

    return () => window.clearInterval(timer);
  }, [slides.length]);

  if (!slides.length) {
    return null;
  }

  const banner = slides[Math.min(active, slides.length - 1)]!;

  const go = (direction: number) => {
    setActive(
      (current) =>
        (current + direction + slides.length) % slides.length
    );
  };

  return (
    <section
      className="hero container homepage-hero"
      aria-label="Destaques da curti Z"
    >
      <h1 className="sr-only">{banner.title}</h1>

      <Link
        className="hero-link"
        href={banner.href}
        aria-label={banner.title}
      >
        <picture className="hero-picture">
          <source
            media="(max-width: 700px)"
            srcSet={banner.mobileImage}
          />

          <img
            src={banner.desktopImage}
            alt={banner.title}
            width={1600}
            height={560}
            fetchPriority="high"
            decoding="async"
          />
        </picture>
      </Link>

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
                onClick={() => setActive(index)}
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
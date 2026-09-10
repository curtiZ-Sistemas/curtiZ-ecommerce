"use client";

import { ArrowLeft, ArrowRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { bundledProductSrcSet } from "../lib/responsive-storefront-image";

type CategoryItem = {
  name: string;
  href: string;
  image: string;
};

type CategoryCarouselProps = {
  categories: CategoryItem[];
};

export function CategoryCarousel({
  categories
}: CategoryCarouselProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const move = useCallback((direction: -1 | 1) => {
    const node = viewport.current;
    if (!node) return;
    const maximum = node.scrollWidth - node.clientWidth;
    const atStart = node.scrollLeft <= 2;
    const atEnd = node.scrollLeft >= maximum - 2;
    const left = direction < 0 && atStart
      ? maximum
      : direction > 0 && atEnd
        ? 0
        : node.scrollLeft + direction * node.clientWidth * 0.82;
    node.scrollTo({ left, behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (paused || categories.length < 2) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reducedMotion.matches) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) move(1);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [categories.length, move, paused]);

  return (
    <div className="category-carousel">
      <div
        className="category-carousel-viewport"
        ref={viewport}
        aria-label="Carrossel de categorias"
        onPointerDown={() => setPaused(true)}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        <div className="category-carousel-track">
          {categories.map((category) => (
            <div
              className="category-carousel-slide"
              key={category.href}
            >
              <Link
                className="category-card"
                href={category.href}
                prefetch={false}
              >
                <div>
                  <h3>{category.name}</h3>

                  <span>
                    Ver produtos
                    <ArrowRight aria-hidden="true" />
                  </span>
                </div>

                {bundledProductSrcSet(category.image) ? (
                  <picture>
                    <source
                      type="image/webp"
                      srcSet={bundledProductSrcSet(category.image) ?? undefined}
                      sizes="(max-width: 700px) 50vw, 250px"
                    />
                    <img
                      src={category.image}
                      srcSet={bundledProductSrcSet(category.image) ?? undefined}
                      sizes="(max-width: 700px) 50vw, 250px"
                      alt=""
                      width={720}
                      height={720}
                      loading="lazy"
                      decoding="async"
                      aria-hidden="true"
                    />
                  </picture>
                ) : (
                  <Image
                    src={category.image}
                    alt=""
                    width={250}
                    height={140}
                    sizes="(max-width: 700px) 50vw, 250px"
                    aria-hidden="true"
                  />
                )}
              </Link>
            </div>
          ))}
        </div>
      </div>

      <div
        className="category-carousel-controls"
        aria-label="Controles das categorias"
      >
        <button
          type="button"
          onClick={() => { setPaused(true); move(-1); }}
          aria-label="Categoria anterior"
        >
          <ArrowLeft aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={() => { setPaused(true); move(1); }}
          aria-label="Próxima categoria"
        >
          <ArrowRight aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
